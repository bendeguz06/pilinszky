#!/usr/bin/env node
import { createWriteStream } from 'node:fs'
import { access, chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'

const rootDir = path.resolve(new URL('..', import.meta.url).pathname)
const platformName = process.platform
const platformBinDir = path.join(rootDir, 'resources', 'whisper', 'bin', platformName)
const latestReleaseApi = 'https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest'

function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    force: false,
    tag: process.env.WHISPER_CPP_TAG || null,
    windowsFlavor: process.env.WHISPER_WINDOWS_FLAVOR || 'cpu',
    enableCuda: process.env.WHISPER_ENABLE_CUDA === '1',
    printOnly: false
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--force') {
      options.force = true
      continue
    }
    if (arg === '--tag') {
      options.tag = args[i + 1] || null
      i += 1
      continue
    }
    if (arg === '--windows-flavor') {
      options.windowsFlavor = args[i + 1] || options.windowsFlavor
      i += 1
      continue
    }
    if (arg === '--cuda') {
      options.enableCuda = true
      continue
    }
    if (arg === '--print-only') {
      options.printOnly = true
      continue
    }
    if (arg === '--help') {
      console.log('Usage: node scripts/download-whisper-binary.mjs [--tag vX.Y.Z] [--force] [--windows-flavor cpu|blas|cublas-11.8.0|cublas-12.4.0] [--cuda] [--print-only]')
      process.exit(0)
    }
  }

  return options
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'pilinszky-whisper-setup',
      Accept: 'application/vnd.github+json'
    }
  })

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`)
  }

  return response.json()
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

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit'
    })

    child.on('error', (error) => reject(error))
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed: ${command} ${args.join(' ')}`))
        return
      }
      resolve()
    })
  })
}

function windowsAssetName(flavor) {
  if (process.arch === 'ia32') {
    if (flavor === 'blas') return 'whisper-blas-bin-Win32.zip'
    return 'whisper-bin-Win32.zip'
  }

  const map = {
    cpu: 'whisper-bin-x64.zip',
    blas: 'whisper-blas-bin-x64.zip',
    'cublas-11.8.0': 'whisper-cublas-11.8.0-bin-x64.zip',
    'cublas-12.4.0': 'whisper-cublas-12.4.0-bin-x64.zip'
  }

  return map[flavor] || map.cpu
}

async function fileExists(filePath) {
  try {
    await access(filePath, constants.R_OK)
    return true
  } catch {
    return false
  }
}

async function resolveRelease(tag) {
  if (!tag) {
    return fetchJson(latestReleaseApi)
  }

  const byTagUrl = `https://api.github.com/repos/ggml-org/whisper.cpp/releases/tags/${tag}`
  return fetchJson(byTagUrl)
}

async function collectRuntimeLibraries(rootDirPath) {
  const files = []

  async function walk(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
        continue
      }

      if (!entry.isFile() || !entry.name.includes('.so')) {
        continue
      }

      if (!entry.name.includes('whisper') && !entry.name.includes('ggml')) {
        continue
      }

      files.push(fullPath)
    }
  }

  await walk(rootDirPath)
  return files
}

async function ensureLinuxSonameLinks(libraryFilePath) {
  const fileName = path.basename(libraryFilePath)
  const match = fileName.match(/^(lib.+\.so)\.(\d+)(?:\..+)?$/)
  if (!match) {
    return
  }

  const [, soBase, major] = match
  const majorLink = path.join(path.dirname(libraryFilePath), `${soBase}.${major}`)
  const baseLink = path.join(path.dirname(libraryFilePath), soBase)

  await rm(majorLink, { force: true }).catch(() => undefined)
  await rm(baseLink, { force: true }).catch(() => undefined)

  await symlink(fileName, majorLink)
  await symlink(fileName, baseLink)
}

async function installWindowsBinary(options) {
  const release = await resolveRelease(options.tag)
  const assetName = windowsAssetName(options.windowsFlavor)
  const asset = release.assets.find((candidate) => candidate.name === assetName)

  if (!asset) {
    throw new Error(`Release ${release.tag_name} does not provide asset ${assetName}`)
  }

  if (options.printOnly) {
    console.log(`whisper.cpp tag: ${release.tag_name}`)
    console.log(`binary asset: ${asset.browser_download_url}`)
    return
  }

  await mkdir(platformBinDir, { recursive: true })
  const expectedBinary = path.join(platformBinDir, 'whisper.exe')
  if (!options.force && (await fileExists(expectedBinary))) {
    console.log(`Binary already exists, skipping: ${expectedBinary}`)
    return
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'pilinszky-whisper-win-'))
  const zipPath = path.join(tempDir, asset.name)
  const extractDir = path.join(tempDir, 'extract')

  try {
    console.log(`Downloading ${asset.name} from ${asset.browser_download_url}`)
    await downloadFile(asset.browser_download_url, zipPath)

    await mkdir(extractDir, { recursive: true })
    await runCommand('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force`], rootDir)

    const releaseDir = path.join(extractDir, 'Release')
    await cp(releaseDir, platformBinDir, { recursive: true, force: true })

    const cliPath = path.join(platformBinDir, 'whisper-cli.exe')
    const cliBuffer = await readFile(cliPath)
    await writeFile(expectedBinary, cliBuffer)

    console.log(`Installed Windows whisper binary to: ${expectedBinary}`)
    console.log(`whisper.cpp tag: ${release.tag_name}`)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function installUnixBinary(options) {
  const release = await resolveRelease(options.tag)
  const tag = release.tag_name
  const sourceUrl = `https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${tag}.tar.gz`

  if (options.printOnly) {
    console.log(`whisper.cpp tag: ${tag}`)
    console.log(`source tarball: ${sourceUrl}`)
    return
  }

  await mkdir(platformBinDir, { recursive: true })
  const expectedBinary = path.join(platformBinDir, 'whisper')
  if (!options.force && (await fileExists(expectedBinary))) {
    console.log(`Binary already exists, skipping: ${expectedBinary}`)
    return
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'pilinszky-whisper-src-'))
  const tarPath = path.join(tempDir, `${tag}.tar.gz`)

  try {
    console.log(`Downloading source from ${sourceUrl}`)
    await downloadFile(sourceUrl, tarPath)

    await runCommand('tar', ['-xzf', tarPath, '-C', tempDir], rootDir)

    const sourceDir = path.join(tempDir, `whisper.cpp-${tag.replace(/^v/, '')}`)
    const buildDir = path.join(sourceDir, 'build')

    const cmakeArgs = [
      '-S',
      sourceDir,
      '-B',
      buildDir,
      '-DCMAKE_BUILD_TYPE=Release',
      '-DWHISPER_BUILD_TESTS=OFF',
      '-DCMAKE_BUILD_WITH_INSTALL_RPATH=ON',
      '-DCMAKE_INSTALL_RPATH=$ORIGIN'
    ]
    if (platformName === 'darwin') {
      cmakeArgs.push('-DGGML_METAL=ON')
    }
    if (options.enableCuda) {
      cmakeArgs.push('-DGGML_CUDA=ON')
    }

    await runCommand('cmake', cmakeArgs, rootDir)
    await runCommand('cmake', ['--build', buildDir, '--config', 'Release', '--target', 'whisper-cli', '-j'], rootDir)

    const releaseBinary = path.join(buildDir, 'bin', 'Release', 'whisper-cli')
    const normalBinary = path.join(buildDir, 'bin', 'whisper-cli')
    const sourceBinary = (await fileExists(releaseBinary)) ? releaseBinary : normalBinary

    await cp(sourceBinary, expectedBinary, { force: true })
    await chmod(expectedBinary, 0o755)

    if (platformName === 'linux') {
      const libraries = await collectRuntimeLibraries(buildDir)
      for (const libraryPath of libraries) {
        const destinationPath = path.join(platformBinDir, path.basename(libraryPath))
        await cp(libraryPath, destinationPath, { force: true })
        await ensureLinuxSonameLinks(destinationPath)
      }
    }

    console.log(`Installed ${platformName} whisper binary to: ${expectedBinary}`)
    console.log(`whisper.cpp tag: ${tag}`)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function main() {
  const options = parseArgs()

  if (platformName === 'win32') {
    await installWindowsBinary(options)
    return
  }

  if (platformName === 'linux' || platformName === 'darwin') {
    await installUnixBinary(options)
    return
  }

  throw new Error(`Unsupported platform for auto setup: ${platformName}`)
}

main().catch((error) => {
  console.error('Binary setup failed')
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

