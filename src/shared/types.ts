export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ChatPayload {
  message: string
  history: Message[]
}
