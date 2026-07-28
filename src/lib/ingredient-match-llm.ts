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

export const ADJUDICATOR_MODEL = "gpt-4.1-mini"

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
 * One OpenAI round-trip: all ambiguous cases batched into a single request,
 * each shipping only its own shortlist as vocabulary. Records the spend to
 * AiUsageEvent. Never throws — a missing key, a rejected call, or a bad
 * response all resolve to `{ drafts: [], model }` so an invoice sync never
 * fails because a model call did.
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

  const client = new OpenAI({ apiKey, timeout: 60_000 })
  const prompt = buildAdjudicatorPrompt({ cases: input.cases })
  const started = Date.now()

  try {
    const response = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 4000,
    })

    await recordAiUsage({
      feature: "ingredient-match-adjudicator",
      provider: "openai",
      model,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      storeId: input.storeId ?? null,
      userId: input.userId ?? null,
      durationMs: Date.now() - started,
    })

    const content = response.choices[0]?.message?.content
    return { drafts: content ? parseAdjudicatorDrafts(content) : [], model }
  } catch (err) {
    logger.error("[ingredient-match-llm] adjudicate LLM call failed:", err)
    return { drafts: [], model }
  }
}
