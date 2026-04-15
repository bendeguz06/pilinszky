export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ChatPayload {
  message: string
  history: Message[]
}

export interface TranscriptionPayload {
  audioBase64: string
  mimeType: string
}

export interface ChatResponse {
  reply: string
  audio: string // base64-encoded WAV, no data URI prefix
}

export type ChatStreamServerEvent =
  | { type: 'text'; data: string }
  | { type: 'audio'; data: string }
  | { type: 'done'; reply: string }
  | { type: 'error'; error: string }

export type ChatStreamIpcEvent =
  | { requestId: string; type: 'text'; data: string }
  | { requestId: string; type: 'audio'; data: string }
  | { requestId: string; type: 'done'; reply: string }
  | { requestId: string; type: 'error'; error: string }
