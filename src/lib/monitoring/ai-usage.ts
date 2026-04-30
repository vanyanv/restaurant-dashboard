import { prisma } from "@/lib/prisma"

/**
 * USD per 1M tokens. Update when providers change pricing.
 * Last verified: 2026-04-30.
 */
export const PRICING_PER_MTOK = {
  "gpt-4.1-mini":     { in: 0.40, cachedIn: 0.10,  out: 1.60 },
  "gpt-4o-mini":      { in: 0.15, cachedIn: 0.075, out: 0.60 },
  "gemini-2.5-flash": { in: 0.30, cachedIn: 0.075, out: 2.50 },
} as const

export type AiUsageInput = {
  feature: string
  provider: "openai" | "google"
  model: string
  inputTokens: number
  outputTokens: number
  cachedTokens?: number
  storeId?: string | null
  userId?: string | null
  durationMs?: number
}

export function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
): number {
  const p = (PRICING_PER_MTOK as Record<string, { in: number; cachedIn: number; out: number }>)[model]
  if (!p) {
    console.warn(`[ai-usage] missing pricing for model "${model}" — recording $0`)
    return 0
  }
  const uncachedIn = Math.max(0, inputTokens - cachedTokens)
  return (uncachedIn * p.in + cachedTokens * p.cachedIn + outputTokens * p.out) / 1_000_000
}

/**
 * Record one AI call. Returns the created event id so callers (e.g. /api/chat)
 * can FK it from ChatTurn.aiUsageEventId. Never throws — pricing miss logs a
 * warning and writes 0; DB error logs and returns `null`.
 */
export async function recordAiUsage(input: AiUsageInput): Promise<string | null> {
  try {
    const cached = input.cachedTokens ?? 0
    const cost = computeCostUsd(input.model, input.inputTokens, input.outputTokens, cached)
    const row = await prisma.aiUsageEvent.create({
      data: {
        feature: input.feature,
        provider: input.provider,
        model: input.model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        cachedTokens: cached,
        estimatedCostUsd: cost,
        storeId: input.storeId ?? null,
        userId: input.userId ?? null,
        durationMs: input.durationMs ?? null,
      },
      select: { id: true },
    })
    return row.id
  } catch (err) {
    console.error("[ai-usage] write failed", err)
    return null
  }
}
