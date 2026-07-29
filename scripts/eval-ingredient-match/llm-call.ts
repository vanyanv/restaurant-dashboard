/**
 * One raw OpenAI round-trip for a whole pool of ambiguous/new cases, for the
 * task-6 LLM bake-off. Deliberately does NOT call src/lib/ingredient-match-llm.ts's
 * `adjudicate()` — that function calls `recordAiUsage`, which writes an
 * AiUsageEvent row, and this task's database access must be read-only. It
 * does reuse `buildAdjudicatorPrompt`/`parseAdjudicatorDrafts` from that
 * module unchanged, so the prompt and parsing are identical to production;
 * only the transport (this file) and the accounting (llm-pricing.ts) differ.
 *
 * No writes. No Math.random(). Every raw response is returned so the caller
 * can persist it to disk before any analysis runs.
 */

import OpenAI from "openai"
import type { AdjudicatorCase, AdjudicatorDraft } from "../../src/lib/ingredient-match-llm"
import { REASONING_MODELS, computeLlmCostUsd } from "./llm-pricing"

// Dynamic import: src/lib/ingredient-match-llm.ts imports
// src/lib/monitoring/ai-usage.ts, which imports src/lib/prisma.ts, which
// reads process.env.DATABASE_URL at module-eval time. A static top-level
// import here would be hoisted ahead of gold.ts's loadEnvLocal() call (run
// first in run-llm.ts's main()), crashing before .env.local is ever read —
// same class of ordering bug gold.ts's own header comment documents. Only
// the two pure functions are used; recordAiUsage/adjudicate() are not.
async function loadAdjudicatorModule() {
  return import("../../src/lib/ingredient-match-llm")
}

export type LlmCallResult = {
  model: string
  cases: AdjudicatorCase[]
  prompt: string
  rawContent: string | null
  drafts: AdjudicatorDraft[]
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  costUsd: number
  durationMs: number
  error: string | null
}

/**
 * Reasoning-effort fixed at "low" for every reasoning-capable arm. This is a
 * deliberate cost/latency control, not a default left unexamined — a batch of
 * ~90 short classification decisions doesn't need deep chain-of-thought, and
 * an unconstrained effort level on a model billing reasoning tokens as output
 * (gpt-5.5 at $30/MTok out) is exactly the failure mode the $0.50/arm budget
 * gate exists to catch. Flagged here so a reviewer can see it's chosen, not
 * defaulted.
 */
const REASONING_EFFORT = "low" as const

export async function callAdjudicatorModelOnce(
  model: string,
  cases: AdjudicatorCase[],
): Promise<LlmCallResult> {
  const { buildAdjudicatorPrompt, parseAdjudicatorDrafts } = await loadAdjudicatorModule()
  const prompt = buildAdjudicatorPrompt({ cases })
  const base: Omit<LlmCallResult, "rawContent" | "drafts" | "inputTokens" | "outputTokens" | "cachedTokens" | "costUsd" | "durationMs" | "error"> = {
    model,
    cases,
    prompt,
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return { ...base, rawContent: null, drafts: [], inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, durationMs: 0, error: "OPENAI_API_KEY not set" }
  }

  const client = new OpenAI({ apiKey, timeout: 300_000 })
  const isReasoning = REASONING_MODELS.has(model)
  const started = Date.now()

  try {
    // Output budget: ~90 drafts * ~120 tokens/draft (json + one-sentence
    // reasoning) is ~11k tokens for the visible completion alone; reasoning
    // models also bill hidden reasoning tokens against the same cap, so the
    // ceiling is set well above the visible-only estimate to avoid a
    // truncated (unparseable) response cutting off mid-JSON.
    const params: Record<string, unknown> = {
      model,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }
    if (isReasoning) {
      params.max_completion_tokens = 32_000
      params.reasoning_effort = REASONING_EFFORT
    } else {
      params.max_tokens = 16_000
      params.temperature = 0.2
    }

    const response = await client.chat.completions.create(params as never)
    const durationMs = Date.now() - started

    const inputTokens = response.usage?.prompt_tokens ?? 0
    const outputTokens = response.usage?.completion_tokens ?? 0
    const cachedTokens = response.usage?.prompt_tokens_details?.cached_tokens ?? 0
    const costUsd = computeLlmCostUsd(model, inputTokens, outputTokens, cachedTokens)

    const content = response.choices?.[0]?.message?.content ?? null
    const drafts = content ? parseAdjudicatorDrafts(content) : []

    return { ...base, rawContent: content, drafts, inputTokens, outputTokens, cachedTokens, costUsd, durationMs, error: null }
  } catch (err) {
    const durationMs = Date.now() - started
    const message = err instanceof Error ? err.message : String(err)
    return { ...base, rawContent: null, drafts: [], inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, durationMs, error: message }
  }
}
