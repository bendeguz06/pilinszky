#!/usr/bin/env node
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const platform = process.platform
const binaryName = platform === 'win32' ? 'whisper.exe' : 'whisper'

const binaryPath = process.env.WHISPER_BIN_PATH ?? path.join(root, 'resources', 'whisper', 'bin', platform, binaryName)
const modelPath = process.env.WHISPER_MODEL_PATH ?? path.join(root, 'resources', 'whisper', 'models', process.env.WHISPER_MODEL_FILE ?? 'ggml-small.bin')
const binaryDir = path.dirname(binaryPath)

async function ensureReadable(filePath) {
  await access(filePath, constants.R_OK)
}

function runHelp(binary) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }

    if (platform === 'linux') {
      const existingPath = env.LD_LIBRARY_PATH ?? ''
      env.LD_LIBRARY_PATH = existingPath ? `${binaryDir}:${existingPath}` : binaryDir
    }

    if (platform === 'darwin') {
      const existingPath = env.DYLD_LIBRARY_PATH ?? ''
      env.DYLD_LIBRARY_PATH = existingPath ? `${binaryDir}:${existingPath}` : binaryDir
    }

    const child = spawn(binary, ['--help'], { stdio: ['ignore', 'pipe', 'pipe'], env })
    let out = ''
    let err = ''

    child.stdout.on('data', (chunk) => {
      out += chunk.toString('utf8')
    })

    child.stderr.on('data', (chunk) => {
      err += chunk.toString('utf8')
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`whisper --help exited with code ${code}. ${err}`))
        return
      }

      resolve(out)
    })
  })
}

function runLdd(binary) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    const existingPath = env.LD_LIBRARY_PATH ?? ''
    env.LD_LIBRARY_PATH = existingPath ? `${binaryDir}:${existingPath}` : binaryDir

    const child = spawn('ldd', [binary], { stdio: ['ignore', 'pipe', 'pipe'], env })
    let out = ''
    let err = ''

    child.stdout.on('data', (chunk) => {
      out += chunk.toString('utf8')
    })

    child.stderr.on('data', (chunk) => {
      err += chunk.toString('utf8')
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`ldd failed with code ${code}. ${err}`))
        return
      }

      resolve(out)
    })
  })
}

try {
  await ensureReadable(binaryPath)
  await ensureReadable(modelPath)

  if (platform === 'linux') {
    const lddOutput = await runLdd(binaryPath)
    if (/not found/.test(lddOutput)) {
      throw new Error(`Missing shared library dependency:\n${lddOutput}`)
    }
  }

  const helpOutput = await runHelp(binaryPath)

  console.log('Whisper runtime check OK')
  console.log(`Binary: ${binaryPath}`)
  console.log(`Model:  ${modelPath}`)
  console.log(helpOutput.split('\n')[0] ?? 'whisper --help returned output')
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error('Whisper runtime check FAILED')
  console.error(message)
  process.exit(1)
}

