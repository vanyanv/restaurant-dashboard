// LLM layer for AI recipe-mapping proposals (new combos / renamed items).
//
// The prompt's load-bearing rule: combos must COMPOSE existing recipes by
// exact name ("2 Slider Combo" = 2 × "Double Slider" + 1 × "Fries") rather
// than re-listing raw ingredients. Composition rides the RecipeIngredient
// componentRecipeId self-relation, so a slider price change flows into every
// combo automatically — the flattened-duplicate problem the seed data has.
//
// Everything the model returns is untrusted: parseProposalDrafts narrows the
// JSON defensively, and the action layer re-resolves every component name
// against the DB before anything is stored.

import OpenAI from "openai"
import { recordAiUsage } from "@/lib/monitoring/ai-usage"
import { logger } from "@/lib/logger"
import { stripCategoryBracket } from "@/lib/item-name-normalize"

export const PROPOSAL_MODEL = "gpt-4.1-mini"

export type ProposalDraftComponent = {
  type: "recipe" | "ingredient"
  name: string
  quantity: number
  unit: string
}

export type ProposalDraftKind = "MATCH" | "COMBO_DECOMPOSITION" | "NEW_RECIPE"

export type ProposalDraft = {
  itemName: string
  kind: ProposalDraftKind
  /** kind=MATCH: the existing recipe this item IS (exact name). */
  matchRecipeName?: string
  suggestedName?: string
  suggestedCategory?: string
  components: ProposalDraftComponent[]
  reasoning: string
  confidence: number
}

export function buildProposalPrompt(input: {
  items: { itemName: string; category: string; qty30d: number }[]
  recipeVocab: { itemName: string; category: string }[]
  ingredientVocab: string[]
  /** Human-confirmed (POS name → recipe) pairs — teaches house naming patterns. */
  confirmedExamples?: { itemName: string; recipeName: string }[]
}): string {
  const { items, recipeVocab, ingredientVocab, confirmedExamples } = input
  const examplesSection =
    confirmedExamples && confirmedExamples.length > 0
      ? `\n## Already-confirmed mappings at this restaurant (follow these naming patterns)
${confirmedExamples.map((e) => `- sold "${e.itemName}" → recipe "${e.recipeName}"`).join("\n")}\n`
      : ""
  return `You are a restaurant recipe analyst for Chris N Eddy's, a slider restaurant. The POS reports sold items below that have no recipe mapping yet — usually new combos or renamed items. Propose how to map each one.

## Existing recipes (the ONLY recipes that exist — reference them by exact name)
${recipeVocab.map((r) => `- ${r.itemName} [${r.category}]`).join("\n")}
${examplesSection}

## Canonical ingredients available (for NEW_RECIPE fallback only)
${ingredientVocab.join(", ")}

## Sold items needing a mapping
${items.map((i) => `- ${i.itemName} [${i.category}] — ${i.qty30d} sold in the last 30 days`).join("\n")}

For each item return one proposal. Return JSON:
{
  "proposals": [
    {
      "itemName": "exact item name from above",
      "kind": "MATCH" | "COMBO_DECOMPOSITION" | "NEW_RECIPE",
      "matchRecipeName": "exact existing recipe name (MATCH only)",
      "suggestedName": "recipe name to create (non-MATCH)",
      "suggestedCategory": "category to create under (non-MATCH)",
      "components": [
        { "type": "recipe" | "ingredient", "name": "exact name from the lists above", "quantity": number, "unit": "each|oz|lb|leaf|slice|portion" }
      ],
      "reasoning": "one sentence",
      "confidence": 0.0-1.0
    }
  ]
}

Rules:
- Return every name WITHOUT the bracketed category tag: never append the [category] shown in the lists above to itemName, matchRecipeName, or component names. Echo itemName exactly as written otherwise.
- MATCH when the sold item IS an existing recipe under a different POS spelling (e.g. "Straight Cut Fries " → recipe "Straight-Cut Fries").
- If an existing recipe already represents the whole combo/bundle (e.g. sold "2 Sliders and Fries" and recipe "2 Slider Combo" exists), prefer MATCH over COMBO_DECOMPOSITION — check the recipe list before decomposing.
- COMBO_DECOMPOSITION for combos/bundles with no matching recipe: compose EXISTING recipes by exact name (e.g. "2 Slider Combo" = 2 × "Double Slider" + 1 × "Fries" + 1 × "Fountain Drink"). Never re-list a recipe's raw ingredients.
- NEW_RECIPE only when no existing recipe covers a component — then use canonical ingredient names from the list.
- Quantities are per one sold unit of the item.
- confidence: 0.9+ obvious, 0.7–0.9 reasonable, below 0.7 uncertain.`
}

/** Defensively narrow the model's JSON into ProposalDrafts. Never throws. */
export function parseProposalDrafts(content: string): ProposalDraft[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return []
  }
  const proposals = (parsed as { proposals?: unknown })?.proposals
  if (!Array.isArray(proposals)) return []

  const drafts: ProposalDraft[] = []
  for (const p of proposals) {
    if (typeof p !== "object" || p === null) continue
    const raw = p as Record<string, unknown>
    const kind = raw.kind
    if (
      kind !== "MATCH" &&
      kind !== "COMBO_DECOMPOSITION" &&
      kind !== "NEW_RECIPE"
    )
      continue
    if (typeof raw.itemName !== "string" || raw.itemName.length === 0) continue

    const components: ProposalDraftComponent[] = []
    if (Array.isArray(raw.components)) {
      for (const c of raw.components) {
        if (typeof c !== "object" || c === null) continue
        const rc = c as Record<string, unknown>
        if (rc.type !== "recipe" && rc.type !== "ingredient") continue
        if (typeof rc.name !== "string" || rc.name.length === 0) continue
        if (typeof rc.quantity !== "number" || !isFinite(rc.quantity) || rc.quantity <= 0)
          continue
        components.push({
          type: rc.type,
          name: stripCategoryBracket(rc.name),
          quantity: rc.quantity,
          unit: typeof rc.unit === "string" && rc.unit ? rc.unit : "each",
        })
      }
    }

    const confidenceRaw = typeof raw.confidence === "number" ? raw.confidence : 0
    drafts.push({
      itemName: stripCategoryBracket(raw.itemName),
      kind,
      matchRecipeName:
        typeof raw.matchRecipeName === "string"
          ? stripCategoryBracket(raw.matchRecipeName)
          : undefined,
      suggestedName:
        typeof raw.suggestedName === "string" ? raw.suggestedName : undefined,
      suggestedCategory:
        typeof raw.suggestedCategory === "string" ? raw.suggestedCategory : undefined,
      components,
      reasoning: typeof raw.reasoning === "string" ? raw.reasoning : "",
      confidence: Math.min(1, Math.max(0, confidenceRaw)),
    })
  }
  return drafts
}

/**
 * One OpenAI round-trip: unmapped items + vocabulary in, narrowed drafts out.
 * Records the spend to AiUsageEvent. Returns [] on any model failure — the
 * caller treats that as "no proposals this run", never an exception surface.
 */
export async function generateProposalDrafts(input: {
  items: { itemName: string; category: string; qty30d: number }[]
  recipeVocab: { itemName: string; category: string }[]
  ingredientVocab: string[]
  confirmedExamples?: { itemName: string; recipeName: string }[]
  storeId?: string | null
  userId?: string | null
}): Promise<{ drafts: ProposalDraft[]; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY env var is required")
  const client = new OpenAI({ apiKey, timeout: 60_000 })

  const prompt = buildProposalPrompt(input)
  const started = Date.now()
  try {
    const response = await client.chat.completions.create({
      model: PROPOSAL_MODEL,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 3000,
    })

    await recordAiUsage({
      feature: "mapping-proposals",
      provider: "openai",
      model: PROPOSAL_MODEL,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      storeId: input.storeId ?? null,
      userId: input.userId ?? null,
      durationMs: Date.now() - started,
    })

    const content = response.choices[0]?.message?.content
    return { drafts: content ? parseProposalDrafts(content) : [], model: PROPOSAL_MODEL }
  } catch (err) {
    logger.error("[mapping-proposals] LLM call failed:", err)
    return { drafts: [], model: PROPOSAL_MODEL }
  }
}
