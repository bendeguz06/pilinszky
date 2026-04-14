export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ChatPayload {
  message: string
  history: Message[]
}

export interface ChatResponse {
  reply: string
  audio: string // base64-encoded WAV, no data URI prefix
}
