import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    pilinszky: {
      chat(message: string, history: import('../shared/types').Message[]): Promise<string>
      speak(text: string): Promise<string>
      transcribe(audio: ArrayBuffer, mimeType: string): Promise<string>
    }
  }
}
