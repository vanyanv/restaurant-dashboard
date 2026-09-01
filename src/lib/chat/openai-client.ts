import OpenAI from "openai"

let cachedClient: OpenAI | null = null

export function getChatOpenAIClient(): OpenAI {
  if (cachedClient) return cachedClient
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set")
  cachedClient = new OpenAI({ apiKey, timeout: 60_000 })
  return cachedClient
}

export const CHAT_ROUTING_MODEL =
  process.env.CHAT_ROUTING_MODEL ?? "gpt-5-mini"

/**
 * How hard the routing model thinks before it acts. See the long note at the
 * `streamText` call in `src/app/api/chat/route.ts` for the measurements that
 * chose `low` — briefly: the unset default is `medium`, and medium cost the
 * owner roughly fifteen seconds a question for tool choices `low` made
 * identically.
 *
 * Only meaningful for a reasoning model. If `CHAT_ROUTING_MODEL` is ever
 * pointed back at a non-reasoning model (gpt-4.1-mini is in this account's
 * history), the provider ignores it.
 */
export const CHAT_REASONING_EFFORT =
  process.env.CHAT_REASONING_EFFORT ?? "low"
export const CHAT_TITLE_MODEL =
  process.env.CHAT_TITLE_MODEL ?? "gpt-4.1-nano"
export const CHAT_EMBEDDING_MODEL = "text-embedding-3-small"
export const CHAT_EMBEDDING_DIMS = 1536
