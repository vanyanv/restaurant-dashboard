import OpenAI from "openai"

let cachedClient: OpenAI | null = null

export function getChatOpenAIClient(): OpenAI {
  if (cachedClient) return cachedClient
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set")
  cachedClient = new OpenAI({ apiKey, timeout: 60_000 })
  return cachedClient
}

export const CHAT_ROUTING_MODEL = "gpt-4.1-mini"
export const CHAT_EMBEDDING_MODEL = "text-embedding-3-small"
export const CHAT_EMBEDDING_DIMS = 1536
