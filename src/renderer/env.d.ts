import type { Message } from '../shared/types'

declare global {
  interface Window {
    pilinszky: {
      chat(message: string, history: Message[]): Promise<string>
      speak(text: string): Promise<string>
    }
  }
}
