/// <reference types="vite/client" />

import type { Message } from '../shared/types'

declare global {
  interface Window {
    pilinszky: {
      chat(message: string, history: Message[]): Promise<{ reply: string; audioSrc: string }>
    }
  }
}
