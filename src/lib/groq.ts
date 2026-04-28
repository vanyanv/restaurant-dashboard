import Groq from "groq-sdk"

let cachedClient: Groq | null = null

function getGroqClient(): Groq {
  if (cachedClient) return cachedClient
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set")
  }
  cachedClient = new Groq({ apiKey })
  return cachedClient
}

export const GROQ_GENERATOR_MODEL = "llama-3.3-70b-versatile"
export const GROQ_CRITIC_MODEL = "llama-3.3-70b-versatile"

export interface GroqUsage {
  promptTokens: number
  completionTokens: number
}

export interface GroqJsonResult<T> {
  data: T
  usage: GroqUsage
  rawContent: string
}

interface GroqJsonOpts {
  model: string
  systemPrompt: string
  userPrompt: string
  temperature?: number
  maxTokens?: number
}

async function callJson<T>(opts: GroqJsonOpts): Promise<GroqJsonResult<T>> {
  const client = getGroqClient()
  const response = await client.chat.completions.create({
    model: opts.model,
    response_format: { type: "json_object" },
    temperature: opts.temperature ?? 0.5,
    max_tokens: opts.maxTokens ?? 2500,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userPrompt },
    ],
  })

  const choice = response.choices[0]
  const content = choice?.message?.content
  if (!content) {
    throw new Error(`Groq returned empty content (model=${opts.model})`)
  }

  let parsed: T
  try {
    parsed = JSON.parse(content) as T
  } catch (err) {
    throw new Error(
      `Groq returned non-JSON content (model=${opts.model}): ${(err as Error).message}\nContent: ${content.slice(0, 500)}`,
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

export interface GenerateInsightsArgs {
  systemPrompt: string
  userPrompt: string
  temperature?: number
  maxTokens?: number
}

export async function generateInsights<T>(
  args: GenerateInsightsArgs,
): Promise<GroqJsonResult<T>> {
  return callJson<T>({
    model: GROQ_GENERATOR_MODEL,
    systemPrompt: args.systemPrompt,
    userPrompt: args.userPrompt,
    temperature: args.temperature ?? 0.5,
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
): Promise<GroqJsonResult<T>> {
  return callJson<T>({
    model: GROQ_CRITIC_MODEL,
    systemPrompt: args.systemPrompt,
    userPrompt: args.userPrompt,
    temperature: args.temperature ?? 0.2,
    maxTokens: args.maxTokens ?? 2500,
  })
}
