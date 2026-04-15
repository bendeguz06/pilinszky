import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  ChatStreamClientEvent,
  ChatStreamIpcEvent,
  Message,
  TranscriptionPayload
} from '../shared/types'

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
    const requestId = await ipcRenderer.invoke('chat-stream-start', { message, history })

    return await new Promise<string>((resolve, reject) => {
      const listener = (_: Electron.IpcRendererEvent, event: ChatStreamIpcEvent) => {
        if (event.requestId !== requestId) return

        if (event.type === 'error') {
          ipcRenderer.removeListener('chat-stream-event', listener)
          onEvent({ type: 'error', error: event.error })
          reject(new Error(event.error))
          return
        }

        if (event.type === 'done') {
          ipcRenderer.removeListener('chat-stream-event', listener)
          onEvent({ type: 'done', reply: event.reply })
          resolve(event.reply)
          return
        }

        onEvent(event)
      }

      ipcRenderer.on('chat-stream-event', listener)
    })
  },

  transcribe: (audio: ArrayBuffer, mimeType: string) => {
    const payload: TranscriptionPayload = {
      audioBase64: Buffer.from(new Uint8Array(audio)).toString('base64'),
      mimeType
    }

    return ipcRenderer.invoke('transcribe', payload)
  }
})
