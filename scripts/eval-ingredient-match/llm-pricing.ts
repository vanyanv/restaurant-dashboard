/**
 * USD/1M-token pricing for the LLM adjudicator arms (task 6). Kept local to
 * this eval rather than added to src/lib/monitoring/ai-usage.ts's
 * PRICING_PER_MTOK — none of these five models besides gpt-4.1-mini are used
 * in production, and this eval must never write to AiUsageEvent (database is
 * read-only for this task), so it cannot reuse recordAiUsage/computeCostUsd
 * either. Verified against https://developers.openai.com/api/docs/pricing on
 * 2026-07-28; gpt-4.1-mini's numbers match ai-usage.ts's table exactly,
 * which is the cross-check that the fetched page is trustworthy.
 */

export type ModelPricing = { in: number; cachedIn: number; out: number }

export const LLM_PRICING_PER_MTOK: Record<string, ModelPricing> = {
  "gpt-4.1-mini": { in: 0.4, cachedIn: 0.1, out: 1.6 },
  "gpt-5.4-nano": { in: 0.2, cachedIn: 0.02, out: 1.25 },
  "gpt-5.4-mini": { in: 0.75, cachedIn: 0.075, out: 4.5 },
  "gpt-5.5": { in: 5.0, cachedIn: 0.5, out: 30.0 },
  "o4-mini": { in: 1.1, cachedIn: 0.275, out: 4.4 },
}

/** Models that reject `temperature`/`max_tokens` on Chat Completions and
 * instead take `max_completion_tokens` (+ optional `reasoning_effort`). Every
 * arm besides gpt-4.1-mini in this bake-off is a reasoning model. */
export const REASONING_MODELS = new Set(["gpt-5.4-nano", "gpt-5.4-mini", "gpt-5.5", "o4-mini"])

export function computeLlmCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
): number {
  const p = LLM_PRICING_PER_MTOK[model]
  if (!p) {
    console.warn(`[llm-pricing] missing pricing for model "${model}" — reporting $0`)
    return 0
  }
  const uncachedIn = Math.max(0, inputTokens - cachedTokens)
  return (uncachedIn * p.in + cachedTokens * p.cachedIn + outputTokens * p.out) / 1_000_000
}

/** Rough pre-call estimate from character count (~4 chars/token), used only
 * to print a heads-up before spending — the actual, billed figure always
 * comes from the API response's `usage` block, never this estimate. */
export function estimateCostUsd(model: string, promptText: string, assumedOutputTokens: number): number {
  const estInputTokens = Math.ceil(promptText.length / 4)
  return computeLlmCostUsd(model, estInputTokens, assumedOutputTokens, 0)
}
