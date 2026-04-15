import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  ChatStreamClientEvent,
  ChatStreamIpcEvent,
  Message,
  TranscriptionPayload
} from '../shared/types'

const CHAT_STREAM_CANCELLED = 'CHAT_STREAM_CANCELLED'
let activeChatStreamRequestId: string | null = null
let activeChatStreamReject: ((reason?: unknown) => void) | null = null
let activeChatStreamListener: ((_: Electron.IpcRendererEvent, event: ChatStreamIpcEvent) => void) | null = null

function cleanupActiveChatStreamListener() {
  if (activeChatStreamListener) {
    ipcRenderer.removeListener('chat-stream-event', activeChatStreamListener)
  }
  activeChatStreamListener = null
  activeChatStreamRequestId = null
  activeChatStreamReject = null
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
}

contextBridge.exposeInMainWorld('pilinszky', {
  chat: (message: string, history: Message[]) => ipcRenderer.invoke('chat', { message, history }),

  chatStream: async (
    message: string,
    history: Message[],
    onEvent: (event: ChatStreamClientEvent) => void
  ) => {
    if (activeChatStreamRequestId) {
      await ipcRenderer.invoke('chat-stream-cancel', activeChatStreamRequestId)
      activeChatStreamReject?.(new Error(CHAT_STREAM_CANCELLED))
      cleanupActiveChatStreamListener()
    }

    const requestId = await ipcRenderer.invoke('chat-stream-start', { message, history })
    activeChatStreamRequestId = requestId

    return await new Promise<string>((resolve, reject) => {
      activeChatStreamReject = reject

      const listener = (_: Electron.IpcRendererEvent, event: ChatStreamIpcEvent) => {
        if (event.requestId !== requestId) return

        if (event.type === 'error') {
          cleanupActiveChatStreamListener()
          onEvent({ type: 'error', error: event.error })
          reject(new Error(event.error))
          return
        }

        if (event.type === 'done') {
          cleanupActiveChatStreamListener()
          onEvent({ type: 'done', reply: event.reply })
          resolve(event.reply)
          return
        }

        onEvent(event)
      }

      activeChatStreamListener = listener
      ipcRenderer.on('chat-stream-event', listener)
    })
  },

  cancelActiveChatStream: async () => {
    if (!activeChatStreamRequestId) {
      return false
    }

    const requestId = activeChatStreamRequestId
    const cancelled = await ipcRenderer.invoke('chat-stream-cancel', requestId)
    activeChatStreamReject?.(new Error(CHAT_STREAM_CANCELLED))
    cleanupActiveChatStreamListener()
    return Boolean(cancelled)
  },

  transcribe: (audio: ArrayBuffer, mimeType: string) => {
    const payload: TranscriptionPayload = {
      audioBase64: Buffer.from(new Uint8Array(audio)).toString('base64'),
      mimeType
    }

    return ipcRenderer.invoke('transcribe', payload)
  }
})
