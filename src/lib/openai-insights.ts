import OpenAI from "openai"

/**
 * Generator-side LLM client for the AI analytics pipeline. We use OpenAI
 * `gpt-4.1-mini` for the generator because copy-fidelity on structured JSON
 * output is materially better than the equivalent-priced open-source models
 * on Groq. The critic still runs on Groq's free `llama-3.3-70b-versatile`
 * (see `src/lib/groq.ts`) — point-in-time review doesn't need verbatim copy.
 */

let cachedClient: OpenAI | null = null

function getOpenAIClient(): OpenAI {
  if (cachedClient) return cachedClient
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set")
  cachedClient = new OpenAI({ apiKey, timeout: 60_000 })
  return cachedClient
}

export const OPENAI_GENERATOR_MODEL = "gpt-4.1-mini"
export const OPENAI_CRITIC_MODEL = "gpt-4.1-mini"

export interface OpenAIUsage {
  promptTokens: number
  completionTokens: number
}

export interface OpenAIJsonResult<T> {
  data: T
  usage: OpenAIUsage
  rawContent: string
}

export interface GenerateInsightsArgs {
  systemPrompt: string
  userPrompt: string
  temperature?: number
  maxTokens?: number
}

async function callJson<T>(opts: {
  model: string
  systemPrompt: string
  userPrompt: string
  temperature: number
  maxTokens: number
}): Promise<OpenAIJsonResult<T>> {
  const client = getOpenAIClient()
  const response = await client.chat.completions.create({
    model: opts.model,
    response_format: { type: "json_object" },
    temperature: opts.temperature,
    max_tokens: opts.maxTokens,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userPrompt },
    ],
  })

  const choice = response.choices[0]
  const content = choice?.message?.content
  if (!content) {
    throw new Error(`OpenAI returned empty content (model=${opts.model})`)
  }

  let parsed: T
  try {
    parsed = JSON.parse(content) as T
  } catch (err) {
    throw new Error(
      `OpenAI returned non-JSON content (model=${opts.model}): ${(err as Error).message}\nContent: ${content.slice(0, 500)}`,
    )
  }

  return {
    data: parsed,
    rawContent: content,
    usage: {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
    },
  }
}

export async function generateInsights<T>(
  args: GenerateInsightsArgs,
): Promise<OpenAIJsonResult<T>> {
  return callJson<T>({
    model: OPENAI_GENERATOR_MODEL,
    systemPrompt: args.systemPrompt,
    userPrompt: args.userPrompt,
    temperature: args.temperature ?? 0,
    maxTokens: args.maxTokens ?? 2500,
  })
}

export interface CriticReviewArgs {
  systemPrompt: string
  userPrompt: string
  temperature?: number
  maxTokens?: number
}

export async function criticReview<T>(
  args: CriticReviewArgs,
): Promise<OpenAIJsonResult<T>> {
  return callJson<T>({
    model: OPENAI_CRITIC_MODEL,
    systemPrompt: args.systemPrompt,
    userPrompt: args.userPrompt,
    temperature: args.temperature ?? 0.2,
    maxTokens: args.maxTokens ?? 2500,
  })
}
