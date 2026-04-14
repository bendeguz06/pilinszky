import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { Message, TranscriptionPayload } from '../shared/types'

// Custom APIs for renderer
const api = {}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

contextBridge.exposeInMainWorld('pilinszky', {
  chat: (message: string, history: Message[]) => ipcRenderer.invoke('chat', { message, history }),

  speak: (text: string) => ipcRenderer.invoke('speak', text),

  transcribe: (audio: ArrayBuffer, mimeType: string) => {
    const payload: TranscriptionPayload = {
      audioBase64: Buffer.from(new Uint8Array(audio)).toString('base64'),
      mimeType
    }

    return ipcRenderer.invoke('transcribe', payload)
  }
})
