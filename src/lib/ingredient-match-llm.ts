// LLM adjudicator for the ambiguous middle band of vendor invoice line item
// -> canonical pantry ingredient matching. Vector similarity
// (ingredient-match-scoring.ts) already auto-links high-confidence matches
// with no observed errors; everything below that gate lands here as an
// "ambiguous" case with up to 5 candidates. This module asks the model to
// pick the exact candidate by name, or say none of them apply and propose a
// new ingredient instead.
//
// The prompt's load-bearing rule: each case ships ONLY its own shortlist as
// vocabulary, never the whole pantry. That keeps the prompt flat as the
// pantry grows and stops the model reaching for ingredients it was never
// shown for that case.
//
// Everything the model returns is untrusted: parseAdjudicatorDrafts narrows
// the JSON defensively and never throws. It does NOT check matchName against
// that case's shortlist — the caller re-resolves every name against the DB
// (and that case's actual candidates) before storing anything, so a
// hallucinated name is the caller's problem to reject, not the parser's to
// silently rewrite.

import OpenAI from "openai"
import { recordAiUsage } from "@/lib/monitoring/ai-usage"
import { logger } from "@/lib/logger"

// Certified 2026-07-28 by the 5-model bake-off in
// scripts/eval-ingredient-match/runs/2026-07-28-1646-llm.md (gpt-5.4-nano
// vs. gpt-4.1-mini, gpt-5.4-mini, o4-mini, gpt-5.5). No arm demonstrated a
// clean zero-error coverage gain over vector-only alone; gpt-5.4-nano was
// chosen as the best available tradeoff — the highest-coverage arm at a
// narrow, disclosed knife-edge (cross-validated, excl. known-corrupted gold
// labels, same 253-case denominator both sides: 234/253 auto-linked,
// 1 wrong, 92.5% coverage vs. vector-only-alone's 167/253, 0 wrong, 66.0%
// — runs/2026-07-28-1646-llm.md:547; see ingredient-match-scoring.ts
// THRESHOLDS.LLM_ACCEPT for the exact figures and the fixed-threshold
// reading) — and it was also the cheapest arm run of the five ($0.0143,
// vs. $0.0145-$0.2836 for the others). Do not swap this without a new
// certified bake-off.
export const ADJUDICATOR_MODEL = "gpt-5.4-nano"

/**
 * Reasoning-capable OpenAI models reject `temperature`/`max_tokens` on Chat
 * Completions and require `max_completion_tokens` (+ optional
 * `reasoning_effort`) instead. `ADJUDICATOR_MODEL` (gpt-5.4-nano) is one of
 * these — same set the bake-off's harness used
 * (scripts/eval-ingredient-match/llm-pricing.ts#REASONING_MODELS, not
 * imported here since that module is eval-only). Getting this branch wrong
 * doesn't error loudly: `adjudicate()` below never throws, so a rejected
 * reasoning-model call would silently resolve to zero drafts on every
 * invoice sync. `reasoning_effort: "low"` mirrors the eval's own deliberate
 * cost/latency control, not a default left unexamined.
 */
const REASONING_MODELS = new Set(["gpt-5.4-nano", "gpt-5.4-mini", "gpt-5.5", "o4-mini"])

/**
 * Ceiling, not a reservation — there is no cost argument for setting this
 * below what the bake-off measured. The eval's own budgeting
 * (scripts/eval-ingredient-match/llm-call.ts) computes ~11k tokens for the
 * *visible* completion alone at ~90 drafts and sets 32,000 specifically
 * because reasoning models bill hidden reasoning tokens against this same
 * cap. Measured for gpt-5.4-nano on the certified run
 * (scripts/eval-ingredient-match/runs/2026-07-28-1646-llm.md): 9,474 output
 * tokens for 88 cases. A prior version of this file set this to 12,000
 * (79% consumed already, before any pool growth) — corrected to match the
 * eval's own value exactly, so this module is never running a
 * configuration smaller than what was actually validated.
 */
const MAX_COMPLETION_TOKENS = 32_000

/**
 * Max ambiguous cases sent in a single adjudicator request. THRESHOLDS.FLOOR
 * (ingredient-match-scoring.ts) folds the entire former `new` bucket into
 * `ambiguous`, so a real invoice sync can hand this module more cases than
 * the 88-case pool the bake-off validated an unchunked request against.
 * Chunking keeps every individual request inside the shape the bake-off
 * actually measured (88 cases, 9,474 output tokens, 54.3s for gpt-5.4-nano)
 * instead of extrapolating a single giant request past it.
 */
const MAX_CASES_PER_REQUEST = 80

export type AdjudicatorDraft = {
  caseId: string
  /** Exact canonical name from THAT case's shortlist, or null for "none of these". */
  matchName: string | null
  confidence: number
  reasoning: string
  /** Populated only when matchName is null. */
  newIngredient?: { name: string; category: string; recipeUnit: string }
}

export type AdjudicatorCase = {
  caseId: string
  productName: string
  vendorName: string
  unit: string | null
  candidates: Array<{ name: string; score: number }>
}

export function buildAdjudicatorPrompt(input: { cases: AdjudicatorCase[] }): string {
  const { cases } = input
  return `You are a restaurant inventory analyst matching vendor invoice line items to canonical pantry ingredients at Chris N Eddy's, a slider restaurant. Vector search has already narrowed each line item down to a short list of the most similar pantry ingredients — decide, for each case, whether one of them IS the product, or whether none of them are and it's a new ingredient.

## Cases
Each case's candidates are the ONLY ingredients that exist for that case — never suggest a match from outside a case's own list, and never mix candidates across cases.

${cases
    .map(
      (c) => `### Case ${c.caseId}
Product: "${c.productName}"
Vendor: "${c.vendorName}"
Unit: ${c.unit ?? "unknown"}
Candidates:
${c.candidates.map((cand) => `- ${cand.name} (similarity ${cand.score.toFixed(2)})`).join("\n")}`
    )
    .join("\n\n")}

Return JSON:
{
  "drafts": [
    {
      "caseId": "exact case id from above",
      "matchName": "exact candidate name from THAT case's list, or null if none of them match",
      "confidence": 0.0-1.0,
      "reasoning": "one sentence",
      "newIngredient": { "name": "proposed canonical name", "category": "pantry category", "recipeUnit": "oz|lb|each|qt|gal|..." }
    }
  ]
}

Rules:
- matchName must be copied verbatim from that case's own candidate list, or null. Never invent a name, never borrow a candidate from a different case.
- Only include "newIngredient" when matchName is null.
- One draft per case, using that case's exact caseId.
- confidence: how sure you are in the decision (a match, or "none of these") — 0.9+ obvious, 0.7-0.9 reasonable, below 0.7 uncertain.`
}

/** Defensively narrow the model's JSON into AdjudicatorDrafts. Never throws. */
export function parseAdjudicatorDrafts(content: string): AdjudicatorDraft[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return []
  }

  const draftsRaw = (parsed as { drafts?: unknown })?.drafts
  if (!Array.isArray(draftsRaw)) return []

  const drafts: AdjudicatorDraft[] = []
  for (const d of draftsRaw) {
    if (typeof d !== "object" || d === null) continue
    const raw = d as Record<string, unknown>

    if (typeof raw.caseId !== "string" || raw.caseId.length === 0) continue
    if (typeof raw.confidence !== "number" || !isFinite(raw.confidence)) continue

    // Note: matchName is NOT checked against any shortlist here — the parser
    // is only responsible for shape, not membership. The caller does that.
    const matchName = typeof raw.matchName === "string" ? raw.matchName : null

    let newIngredient: AdjudicatorDraft["newIngredient"]
    if (
      matchName === null &&
      typeof raw.newIngredient === "object" &&
      raw.newIngredient !== null
    ) {
      const ni = raw.newIngredient as Record<string, unknown>
      if (
        typeof ni.name === "string" &&
        ni.name.length > 0 &&
        typeof ni.category === "string" &&
        ni.category.length > 0 &&
        typeof ni.recipeUnit === "string" &&
        ni.recipeUnit.length > 0
      ) {
        newIngredient = { name: ni.name, category: ni.category, recipeUnit: ni.recipeUnit }
      }
    }

    drafts.push({
      caseId: raw.caseId,
      matchName,
      confidence: Math.min(1, Math.max(0, raw.confidence)),
      reasoning: typeof raw.reasoning === "string" ? raw.reasoning : "",
      newIngredient,
    })
  }
  return drafts
}

/**
 * One OpenAI round-trip for a single chunk (at most MAX_CASES_PER_REQUEST
 * cases), each case shipping only its own shortlist as vocabulary. Records
 * the spend to AiUsageEvent regardless of what the response contains — the
 * call still cost money even if the content is truncated. Never throws: a
 * rejected call, a bad response, or a truncated (finish_reason==="length")
 * response all resolve to `[]` so a batch failure never fails the whole
 * invoice sync, and never gets silently misread as "the model abstained."
 */
async function adjudicateOneRequest(input: {
  client: OpenAI
  cases: AdjudicatorCase[]
  model: string
  storeId: string | null
  userId: string | null
}): Promise<AdjudicatorDraft[]> {
  const { client, cases, model, storeId, userId } = input
  const prompt = buildAdjudicatorPrompt({ cases })
  const started = Date.now()

  try {
    const params: Record<string, unknown> = {
      model,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }
    if (REASONING_MODELS.has(model)) {
      params.max_completion_tokens = MAX_COMPLETION_TOKENS
      params.reasoning_effort = "low"
    } else {
      params.max_tokens = 4000
      params.temperature = 0.2
    }

    const response = await client.chat.completions.create(params as never)

    await recordAiUsage({
      feature: "ingredient-match-adjudicator",
      provider: "openai",
      model,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      storeId,
      userId,
      durationMs: Date.now() - started,
    })

    // finish_reason==="length" means the response was cut off mid-JSON.
    // parseAdjudicatorDrafts would throw inside its own try and quietly
    // return [] anyway — but silently, indistinguishable from ordinary
    // abstention, and it's all-or-nothing: 79 good drafts plus one
    // truncated one still yields zero. Surface it instead.
    const choice = response.choices[0]
    if (choice?.finish_reason === "length") {
      logger.error(
        `[ingredient-match-llm] adjudicate response truncated (finish_reason=length) for ${cases.length} cases — drafts for this batch discarded, not partially trusted`
      )
      return []
    }

    const content = choice?.message?.content
    return content ? parseAdjudicatorDrafts(content) : []
  } catch (err) {
    logger.error("[ingredient-match-llm] adjudicate LLM call failed:", err)
    return []
  }
}

/**
 * Adjudicates every ambiguous case, chunking into batches of at most
 * MAX_CASES_PER_REQUEST so no single request runs past the shape the
 * bake-off validated. Chunks are sent sequentially and their drafts merged;
 * one chunk's failure (rejected call, truncation) does not stop the others.
 * Never throws — see adjudicateOneRequest.
 */
export async function adjudicate(input: {
  cases: AdjudicatorCase[]
  model?: string
  storeId?: string | null
  userId?: string | null
}): Promise<{ drafts: AdjudicatorDraft[]; model: string }> {
  const model = input.model ?? ADJUDICATOR_MODEL

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    logger.error("[ingredient-match-llm] OPENAI_API_KEY env var is required")
    return { drafts: [], model }
  }

  if (input.cases.length === 0) return { drafts: [], model }

  const client = new OpenAI({ apiKey, timeout: 300_000 })
  const storeId = input.storeId ?? null
  const userId = input.userId ?? null

  const drafts: AdjudicatorDraft[] = []
  for (let i = 0; i < input.cases.length; i += MAX_CASES_PER_REQUEST) {
    const chunk = input.cases.slice(i, i + MAX_CASES_PER_REQUEST)
    const chunkDrafts = await adjudicateOneRequest({ client, cases: chunk, model, storeId, userId })
    drafts.push(...chunkDrafts)
  }

  return { drafts, model }
}
