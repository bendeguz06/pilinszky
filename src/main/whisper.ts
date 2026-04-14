import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { app } from 'electron'
import type { LocalTranscriptionPayload } from '../shared/types'

function getResourceBasePath(): string {
  return app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources')
}

function defaultWhisperBinaryPath(): string {
  const binaryName = process.platform === 'win32' ? 'whisper.exe' : 'whisper'
  return path.join(getResourceBasePath(), 'whisper', 'bin', process.platform, binaryName)
}

function defaultWhisperModelPath(): string {
  const modelFile = process.env.WHISPER_MODEL_FILE ?? 'ggml-small.bin'
  return path.join(getResourceBasePath(), 'whisper', 'models', modelFile)
}

function extensionFromMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase()
  if (normalized.includes('wav')) return '.wav'
  if (normalized.includes('ogg')) return '.ogg'
  if (normalized.includes('mp4') || normalized.includes('m4a')) return '.m4a'
  return '.webm'
}

function sanitizeWhisperOutput(raw: string): string {
  return raw
    .replace(/\[[^]]+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function runFfmpegConvertToWav(inputPath: string, outputPath: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpegPath = process.env.WHISPER_FFMPEG_PATH ?? 'ffmpeg'
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      inputPath,
      '-ar',
      '16000',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      outputPath
    ]

    const child = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'ignore', 'pipe']
    })

    let stderr = ''
    let isSettled = false

    const timeout = setTimeout(() => {
      if (isSettled) return
      isSettled = true
      child.kill('SIGKILL')
      reject(new Error(`Audio conversion timed out after ${timeoutMs} ms`))
    }, timeoutMs)

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    child.on('error', (err) => {
      if (isSettled) return
      isSettled = true
      clearTimeout(timeout)

      if ('code' in err && err.code === 'ENOENT') {
        reject(
          new Error(
            'ffmpeg was not found. Install ffmpeg or set WHISPER_FFMPEG_PATH to the executable path.'
          )
        )
        return
      }

      reject(new Error(`Failed to launch ffmpeg: ${err.message}`))
    })

    child.on('exit', (code) => {
      if (isSettled) return
      isSettled = true
      clearTimeout(timeout)

      if (code !== 0) {
        reject(new Error(`ffmpeg conversion failed with code ${code}. ${stderr.trim()}`.trim()))
        return
      }

      resolve()
    })
  })
}

function runWhisper(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const binaryPath = process.env.WHISPER_BIN_PATH ?? defaultWhisperBinaryPath()
    const binaryDir = path.dirname(binaryPath)
    const env = { ...process.env }

    // Keep colocated whisper/ggml shared libraries discoverable when running from Electron.
    if (process.platform === 'linux') {
      const existingPath = env.LD_LIBRARY_PATH ?? ''
      env.LD_LIBRARY_PATH = existingPath ? `${binaryDir}:${existingPath}` : binaryDir
    }

    if (process.platform === 'darwin') {
      const existingPath = env.DYLD_LIBRARY_PATH ?? ''
      env.DYLD_LIBRARY_PATH = existingPath ? `${binaryDir}:${existingPath}` : binaryDir
    }

    const child = spawn(binaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env
    })

    let stdout = ''
    let stderr = ''
    let isSettled = false

    const timeout = setTimeout(() => {
      if (isSettled) return
      isSettled = true
      child.kill('SIGKILL')
      reject(new Error(`Local Whisper timed out after ${timeoutMs} ms`))
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    child.on('error', (err) => {
      if (isSettled) return
      isSettled = true
      clearTimeout(timeout)
      reject(new Error(`Failed to launch whisper binary: ${err.message}`))
    })

    child.on('exit', (code) => {
      if (isSettled) return
      isSettled = true
      clearTimeout(timeout)

      if (code !== 0) {
        reject(new Error(`Whisper exited with code ${code}. ${stderr.trim()}`.trim()))
        return
      }

      resolve({ stdout, stderr })
    })
  })
}

export async function transcribeWithLocalWhisper(payload: LocalTranscriptionPayload): Promise<string> {
  console.time("init whisper")
  const binaryPath = process.env.WHISPER_BIN_PATH ?? defaultWhisperBinaryPath()
  const modelPath = process.env.WHISPER_MODEL_PATH ?? defaultWhisperModelPath()
  const language = process.env.WHISPER_LANGUAGE ?? 'hu'
  const timeoutMs = Number(process.env.WHISPER_TIMEOUT_MS ?? '45000')

  await fs.access(binaryPath)
  await fs.access(modelPath)

  const audioBuffer = Buffer.from(payload.audioBase64, 'base64')
  const suffix = extensionFromMimeType(payload.mimeType)
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pilinszky-whisper-'))
  const sourceAudioPath = path.join(tempDir, `input${suffix}`)
  const wavAudioPath = path.join(tempDir, 'input.wav')
  const outputPrefix = path.join(tempDir, 'output')
  const outputTextPath = `${outputPrefix}.txt`

  await fs.writeFile(sourceAudioPath, audioBuffer)

  try {
    console.timeEnd("init whisper")
    const whisperInputPath = suffix === '.wav' ? sourceAudioPath : wavAudioPath
    if (whisperInputPath === wavAudioPath) {
      console.time("ffmpeg")
      await runFfmpegConvertToWav(sourceAudioPath, wavAudioPath, timeoutMs)
      console.timeEnd("ffmpeg")
    }

    console.time("whisper")
    const args = [
      '-m',
      modelPath,
      '-f',
      whisperInputPath,
      '--language',
      language,
      '--no-timestamps',
      '--temperature',
      '0',
      '-otxt',
      '-of',
      outputPrefix
    ]


    const { stdout } = await runWhisper(args, timeoutMs)

    const transcript = await fs.readFile(outputTextPath, 'utf8').catch(() => stdout)

    console.timeEnd('whisper')

    return sanitizeWhisperOutput(transcript)
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}


