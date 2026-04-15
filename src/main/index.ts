import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import axios from 'axios'
import { SpeechClient } from '@google-cloud/speech'
import { autoUpdater } from 'electron-updater'
import type {
  ChatStreamIpcEvent,
  ChatStreamServerEvent,
  Message,
  TranscriptionPayload
} from '../shared/types'
import * as dotenv from 'dotenv'
dotenv.config()

const POD_URL = process.env.POD_URL
let speechClient: SpeechClient | null = null

function getSpeechClient(): SpeechClient {
  if (speechClient) {
    return speechClient
  }

  speechClient = new SpeechClient()
  return speechClient
}

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

  throw new Error(
    `Unsupported audio mime type for Google STT: ${mimeType}. Supported types: webm, ogg, wav, flac`
  )
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

  autoUpdater.checkForUpdatesAndNotify()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('chat', async (_, payload: { message: string; history: Message[] }) => {
    const res = await axios.post<{ reply: string; audio: string }>(`${POD_URL}/chat`, payload)
    const { reply, audio } = res.data
    return { reply, audioSrc: `data:audio/wav;base64,${audio}` }
  })

  ipcMain.handle('chat-stream-start', async (event, payload: { message: string; history: Message[] }) => {
    const requestId = randomUUID()
    const sender = event.sender

    void (async () => {
      try {
        const response = await fetch(`${POD_URL}/chat/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })

        if (!response.ok || !response.body) {
          throw new Error(`Streaming request failed with status ${response.status}`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue

            const chunk = JSON.parse(trimmed) as ChatStreamServerEvent
            const payload: ChatStreamIpcEvent = {
              requestId,
              type: chunk.type
            }

            if (chunk.type === 'text' && chunk.data) {
              payload.data = chunk.data
            } else if (chunk.type === 'audio' && chunk.data) {
              payload.data = `data:audio/wav;base64,${chunk.data}`
            } else if (chunk.type === 'done') {
              payload.reply = chunk.reply ?? ''
            } else if (chunk.type === 'error') {
              payload.error = chunk.error ?? 'Unknown streaming error'
            }

            sender.send('chat-stream-event', payload)
          }
        }

        const tail = buffer.trim()
        if (tail) {
          const chunk = JSON.parse(tail) as ChatStreamServerEvent
          sender.send('chat-stream-event', {
            requestId,
            type: chunk.type,
            data:
              chunk.type === 'audio'
                ? chunk.data
                  ? `data:audio/wav;base64,${chunk.data}`
                  : undefined
                : chunk.data,
            reply: chunk.type === 'done' ? chunk.reply : undefined,
            error: chunk.type === 'error' ? chunk.error : undefined
          } satisfies ChatStreamIpcEvent)
        }
      } catch (error) {
        sender.send('chat-stream-event', {
          requestId,
          type: 'error',
          error:
            error instanceof Error ? error.message : 'Unexpected error while streaming chat response'
        } satisfies ChatStreamIpcEvent)
      }
    })()

    return requestId
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
      const configuredSampleRateHertz = Number(process.env.STT_SAMPLE_RATE_HZ)
      const hasValidConfiguredSampleRate =
        Number.isFinite(configuredSampleRateHertz) && configuredSampleRateHertz > 0
      const [response] = await getSpeechClient().recognize({
        audio: {
          content: payload.audioBase64
        },
        config: {
          encoding,
          languageCode: process.env.STT_LANGUAGE_CODE ?? 'hu-HU',
          model: process.env.STT_MODEL ?? 'latest_long',
          enableAutomaticPunctuation: true,
          ...(hasValidConfiguredSampleRate ? { sampleRateHertz: configuredSampleRateHertz } : {})
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
