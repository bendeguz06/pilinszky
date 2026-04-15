/// <reference types="vite/client" />

import type { Message } from '../shared/types'

declare global {
  interface SpeechRecognitionAlternative {
    readonly transcript: string
    readonly confidence: number
  }

  interface SpeechRecognitionResult {
    readonly isFinal: boolean
    readonly length: number
    readonly [index: number]: SpeechRecognitionAlternative
  }

  interface SpeechRecognitionResultList {
    readonly length: number
    readonly [index: number]: SpeechRecognitionResult
  }

  interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number
    readonly results: SpeechRecognitionResultList
  }

  interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string
    readonly message: string
  }

  interface SpeechRecognition {
    lang: string
    continuous: boolean
    interimResults: boolean
    maxAlternatives: number
    onstart: ((this: SpeechRecognition, ev: Event) => unknown) | null
    onend: ((this: SpeechRecognition, ev: Event) => unknown) | null
    onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => unknown) | null
    onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => unknown) | null
    start(): void
    stop(): void
    abort(): void
  }

  interface SpeechRecognitionConstructor {
    new (): SpeechRecognition
  }

  interface Window {
    pilinszky: {
      chat(message: string, history: Message[]): Promise<{ reply: string; audioSrc: string }>
      chatStream(
        message: string,
        history: Message[],
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
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}
