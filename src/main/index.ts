import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import axios from 'axios'
import { SpeechClient } from '@google-cloud/speech'
import type { Message, TranscriptionPayload } from '../shared/types'
import * as dotenv from 'dotenv'
dotenv.config()

const POD_URL = process.env.POD_URL
const speechClient = new SpeechClient()

function getGoogleAudioEncodingFromMimeType(mimeType: string) {
  const normalized = mimeType.toLowerCase()

  if (normalized.includes('webm')) {
    return 'WEBM_OPUS' as const
  }

  if (normalized.includes('ogg')) {
    return 'OGG_OPUS' as const
  }

  if (normalized.includes('wav')) {
    return 'LINEAR16' as const
  }

  if (normalized.includes('flac')) {
    return 'FLAC' as const
  }

  throw new Error(`Unsupported audio mime type for Google STT: ${mimeType}`)
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    fullscreen: !is.dev,
    kiosk: !is.dev,
    show: false,
    autoHideMenuBar: !is.dev,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true // renderer can't access Node, don't remove.
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' }
  }) // no need for shell.openExternal in a kiosk

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.bb.pilinszky')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('chat', async (_, payload: { message: string; history: Message[] }) => {
    const res = await axios.post(`${POD_URL}/chat`, payload)
    return res.data.reply as string
  })

  // Get TTS audio → return as base64 so renderer can play it
  ipcMain.handle('speak', async (_, text: string) => {
    const res = await axios.post(
      `${POD_URL}/tts`,
      { text },
      {
        responseType: 'arraybuffer'
      }
    )
    const base64 = Buffer.from(res.data).toString('base64')
    return `data:audio/wav;base64,${base64}`
  })

  ipcMain.handle('transcribe', async (_, payload: TranscriptionPayload) => {
    try {
      const encoding = getGoogleAudioEncodingFromMimeType(payload.mimeType)
      const sampleRateHertz = Number(process.env.STT_SAMPLE_RATE_HZ)
      const [response] = await speechClient.recognize({
        audio: {
          content: payload.audioBase64
        },
        config: {
          encoding,
          languageCode: process.env.STT_LANGUAGE_CODE ?? 'hu-HU',
          model: process.env.STT_MODEL ?? 'latest_short',
          ...(Number.isFinite(sampleRateHertz) && sampleRateHertz > 0 ? { sampleRateHertz } : {})
        }
      })

      return (
        response.results
          ?.map((result) => result.alternatives?.[0]?.transcript?.trim())
          .filter((text): text is string => Boolean(text))
          .join(' ') ?? ''
      )
    } catch (error) {
      throw new Error(
        `Failed to transcribe audio via Google Cloud STT: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
