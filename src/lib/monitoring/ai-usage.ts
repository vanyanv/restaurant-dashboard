import { prisma } from "@/lib/prisma"

/**
 * USD per 1M tokens. Update when providers change pricing.
 * Last verified: 2026-04-30.
 *
 * gpt-5-mini added 2026-08-21: the CHAT_ROUTING_MODEL default
 * (src/lib/chat/openai-client.ts). It had never had a row, so every chat turn
 * — the heaviest LLM call in the product, up to 15 tool steps against a
 * 58-tool catalogue — has been booking $0 in AiUsageEvent since the feature
 * shipped. The pricing-miss fallback below is what made it silent. Surfaced by
 * the golden-set runner (scripts/eval-llm), which reports its own spend and
 * had to print the model as "unpriced"; tests/lib/ai-usage.test.ts now fails
 * on any shipped model constant without a rate, so there is no fourth time.
 * Rate read from https://developers.openai.com/api/docs/pricing on 2026-08-21.
 *
 * gpt-5.4-nano added 2026-07-29: THRESHOLDS-certified ADJUDICATOR_MODEL
 * (src/lib/ingredient-match-llm.ts) — without a pricing row here,
 * recordAiUsage's pricing-miss fallback (see computeCostUsd below) would
 * silently persist $0 for every production adjudicator call, making the
 * feature's real spend invisible in AiUsageEvent from day one. Rate taken
 * from scripts/eval-ingredient-match/llm-pricing.ts#LLM_PRICING_PER_MTOK
 * (verified there against https://developers.openai.com/api/docs/pricing
 * on 2026-07-28, cross-checked against this table's own gpt-4.1-mini row),
 * not re-derived from memory.
 */
export const PRICING_PER_MTOK = {
  "gpt-4.1-mini":     { in: 0.40, cachedIn: 0.10,  out: 1.60 },
  "gpt-4o-mini":      { in: 0.15, cachedIn: 0.075, out: 0.60 },
  "gemini-2.5-flash": { in: 0.30, cachedIn: 0.075, out: 2.50 },
  "gpt-5.4-nano":     { in: 0.20, cachedIn: 0.02,  out: 1.25 },
  "gpt-5-mini":       { in: 0.25, cachedIn: 0.025, out: 2.00 },
} as const

/**
 * The rate an UNPRICED model is booked at: the dearest known rate for each
 * kind of token. Not a price — a ceiling, so the spend cap counts the call.
 * The real price must be added to `PRICING_PER_MTOK`.
 */
export const UNKNOWN_MODEL_RATE = (() => {
  const rows = Object.values(PRICING_PER_MTOK)
  return {
    in: Math.max(...rows.map((r) => r.in)),
    cachedIn: Math.max(...rows.map((r) => r.cachedIn)),
    out: Math.max(...rows.map((r) => r.out)),
  }
})()

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
  /**
   * A cost the caller already knows, for a call that is not priced by token
   * — transcription is billed per minute of audio. When given it is recorded
   * as-is and the token table is not consulted.
   */
  costUsd?: number
}

/** Per minute of audio, USD — the transcription models' own unit. */
export const PRICING_PER_MINUTE = {
  "gpt-4o-mini-transcribe": 0.003,
  "gpt-4o-transcribe": 0.006,
} as const

export function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
): number {
  let p = (PRICING_PER_MTOK as Record<string, { in: number; cachedIn: number; out: number }>)[model]
  if (!p) {
    /*
     * A PRICING MISS IS LOUD AND NEVER $0.
     *
     * It used to warn and record $0, which made the call invisible to the
     * daily spend cap (it sums this column) as well as to the ledger — twice
     * a shipped model booked nothing for weeks. The rate here is the dearest
     * known one per token kind, so the cap over-counts an unpriced model
     * rather than ignoring it, and the error names the model so its real
     * price can be added to the table above.
     */
    console.error(
      `[ai-usage] missing pricing for model "${model}" — recording at the most expensive known rate; add its price to PRICING_PER_MTOK`,
    )
    p = UNKNOWN_MODEL_RATE
  }
  const uncachedIn = Math.max(0, inputTokens - cachedTokens)
  return (uncachedIn * p.in + cachedTokens * p.cachedIn + outputTokens * p.out) / 1_000_000
}

/**
 * Record one AI call. Returns the created event id so callers (e.g. /api/chat)
 * can FK it from ChatTurn.aiUsageEventId. Never throws — a pricing miss logs an
 * error and books the most expensive known rate; DB error logs and returns `null`.
 */
export async function recordAiUsage(input: AiUsageInput): Promise<string | null> {
  try {
    const cached = input.cachedTokens ?? 0
    const cost =
      input.costUsd ?? computeCostUsd(input.model, input.inputTokens, input.outputTokens, cached)
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
