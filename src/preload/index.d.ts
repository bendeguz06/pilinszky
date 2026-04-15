import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    pilinszky: {
      chat(
        message: string,
        history: import('../shared/types').Message[]
      ): Promise<{ reply: string; audioSrc: string }>
      chatStream(
        message: string,
        history: import('../shared/types').Message[],
        onEvent: (
          event:
            | { type: 'text'; data: string }
            | { type: 'audio'; data: string }
            | { type: 'done'; reply: string }
            | { type: 'error'; error: string }
        ) => void
      ): Promise<string>
      cancelActiveChatStream(): Promise<boolean>
      transcribe(audio: ArrayBuffer, mimeType: string): Promise<string>
    }
  }
}
