#!/usr/bin/env node
import { createWriteStream } from 'node:fs'
import { mkdir, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

const rootDir = path.resolve(new URL('..', import.meta.url).pathname)
const modelsDir = path.join(rootDir, 'resources', 'whisper', 'models')
const modelScriptUrl = 'https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/models/download-ggml-model.sh'

function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    force: false,
    model: process.env.WHISPER_MODEL_NAME || null
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--force') {
      options.force = true
      continue
    }

    if (arg === '--model') {
      options.model = args[i + 1] || null
      i += 1
      continue
    }

    if (arg === '--help') {
      console.log('Usage: node scripts/download-whisper-model.mjs [--model <name>] [--force]')
      process.exit(0)
    }
  }

  return options
}

function resolveModelName(explicitModel) {
  if (explicitModel) {
    return explicitModel
  }

  const modelFile = process.env.WHISPER_MODEL_FILE
  if (modelFile) {
    const match = modelFile.match(/^ggml-(.+)\.bin$/)
    if (match) {
      return match[1]
    }
  }

  return 'small'
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'pilinszky-whisper-setup',
      Accept: 'text/plain'
    }
  })

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`)
  }

  return response.text()
}

function parseSupportedModels(scriptText) {
  const match = scriptText.match(/models="([\s\S]*?)"/m)
  if (!match) {
    throw new Error('Failed to parse model list from upstream script')
  }

  return new Set(match[1].split(/\s+/).map((item) => item.trim()).filter(Boolean))
}

function modelDownloadUrl(model) {
  if (model.includes('tdrz')) {
    return `https://huggingface.co/akashmjn/tinydiarize-whisper.cpp/resolve/main/ggml-${model}.bin`
  }

  return `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`
}

async function ensureReadable(filePath) {
  await access(filePath, constants.R_OK)
}

async function downloadFile(url, destinationPath) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'pilinszky-whisper-setup'
    }
  })

  if (!response.ok || !response.body) {
    throw new Error(`Failed download (${response.status}) from ${url}`)
  }

  await pipeline(response.body, createWriteStream(destinationPath))
}

async function main() {
  const options = parseArgs()
  const model = resolveModelName(options.model)

  const scriptText = await fetchText(modelScriptUrl)
  const supportedModels = parseSupportedModels(scriptText)

  if (!supportedModels.has(model)) {
    throw new Error(`Unsupported model '${model}'. Upstream models script does not list it.`)
  }

  await mkdir(modelsDir, { recursive: true })

  const targetFile = path.join(modelsDir, `ggml-${model}.bin`)
  if (!options.force) {
    try {
      await ensureReadable(targetFile)
      console.log(`Model already exists, skipping: ${targetFile}`)
      return
    } catch {
      // continue
    }
  }

  const downloadUrl = modelDownloadUrl(model)
  console.log(`Downloading model '${model}' from: ${downloadUrl}`)
  await downloadFile(downloadUrl, targetFile)
  console.log(`Saved model to: ${targetFile}`)
}

main().catch((error) => {
  console.error('Model download failed')
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

