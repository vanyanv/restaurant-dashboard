// LLM layer for the Act I verdict line on /dashboard/decisions.
//
// The model's job is narration and nothing else: it receives a block of
// already-computed, already-formatted figures and writes one sentence out of
// them. It never sees a raw float, never sees history, and is never asked what
// will happen — the forecast has already answered that.
//
// The guard is `parseVerdictLine`, which rebuilds its allowlist from the same
// fact block the prompt was built from and rejects any digit-run that isn't in
// it. That makes design principle #7 ("the LLM narrates; it never predicts")
// mechanical rather than aspirational. Anything rejected falls back to
// `composeVerdict`, so the page always has a verdict and never has a wrong one.

import OpenAI from "openai"
import { logger } from "@/lib/logger"
import {
  VERDICT_MAX_CHARS,
  composeVerdict,
  fnv1a,
  verdictFactBlock,
  type VerdictFacts,
} from "@/lib/decisions/verdict-copy"

export const VERDICT_MODEL = "gpt-4.1-mini"

// Owned by verdict-copy so the composer can respect the same budget without a
// circular import. Re-exported here because the guard is its main consumer.
export { VERDICT_MAX_CHARS } from "@/lib/decisions/verdict-copy"

/**
 * The budget the PROMPT asks for. Deliberately below VERDICT_MAX_CHARS, which
 * is what the guard enforces.
 *
 * A language model cannot count characters. Quoting it the guard's own limit
 * puts the mean of its length distribution on the limit and roughly half the
 * mass over it — the golden-set run measured 171 and 172 characters on two of
 * eight cases with the limit stated as 170, both silently rejected, both pages
 * falling back to the composed sentence with nothing but a logger.warn to show
 * for it. The gap is the headroom that absorbs a sentence the model misjudged.
 *
 * Only the prompt moves. The guard still accepts anything up to
 * VERDICT_MAX_CHARS, so a good sentence at 165 characters still reaches the
 * page; this makes the model aim lower, it does not make the product tighter.
 */
export const VERDICT_PROMPT_MAX_CHARS = 150

/**
 * ## The two rules about SHAPE, and what they are answering
 *
 * The fact block is an allowlist, and a model handed nine keys under a
 * character budget spends the budget enumerating them. Measured on the live
 * page, that produced:
 *
 *     This week peak day SUN forecasts $9,004 with 7 days with no schedule
 *     and top action to drop price on Signature Double Patty & Cheese Slider
 *     by $0.25.
 *
 * — three facts welded together on "with" and "and", missing the possessive
 * that would make the first clause grammatical, and worse than what
 * `composeVerdict` would have written from the same facts ("SUN is the week's
 * biggest day at $9,004, and there is no schedule published to judge it
 * against."). A narrator that loses to its own fallback is not earning the
 * call.
 *
 * The rules say to CHOOSE and to speak, because neither was previously asked
 * for: every other rule here is about which figures may appear, and none was
 * about the sentence being one.
 */
export function buildVerdictPrompt(facts: VerdictFacts): string {
  return verdictPromptTemplate(JSON.stringify(verdictFactBlock(facts), null, 2))
}

/**
 * The prompt with the facts left as a parameter — everything the model is told
 * EXCEPT what this week happens to be.
 *
 * Split out so `VERDICT_NARRATION_VERSION` can hash the instructions without a
 * set of pretend facts to render them around.
 */
function verdictPromptTemplate(blockJson: string): string {
  return `You write the single opening sentence of a restaurant owner's weekly decisions page. The owner is closing books late and wants to know what this week asks of them.

Here are the only facts you may use. They are already computed and already formatted:

${blockJson}

Rules:
- Write ONE sentence, at most ${VERDICT_PROMPT_MAX_CHARS} characters.
- Use only figures that appear verbatim above. Copy them exactly, including the dollar sign and commas.
- Do not compute anything. Do not add, subtract, average, project, or round any figure. Do not infer a number that is not listed.
- Do not predict, promise, or speculate about outcomes. State what the week is.
- Plain operator English. No greeting, no preamble, no markdown, no quotation marks, no emoji.
- Lead with whatever a working owner would act on first — usually the biggest day, or the gap between what the week earns and what is scheduled for it.
- Say ONE thing. You are given more facts than will fit; most of them are there so you can choose, not so you can include them. Two clauses at most, and the second only if it changes what the owner does.
- It has to read as something a person would say out loud, with the articles and possessives that implies. Facts strung together on "with" and "and" are a list, not a sentence, and a list is a rejected answer.

Return only the sentence.`
}

/**
 * THE WORDS WE ASKED FOR, AND WHO WE ASKED — as a cache key component.
 *
 * `DecisionVerdict` keys a stored sentence on (scope, day) plus
 * `verdictInputsHash`, which is taken over the FACTS. That is half a key. A
 * completion is a function of the facts *and* the prompt *and* the model, and
 * the other half was missing: rewriting these instructions changed nothing on
 * screen, because every store kept serving the sentence the old prompt wrote
 * until the date rolled over.
 *
 * That is not hypothetical. The rules below gained "say ONE thing" and "it has
 * to read as something a person would say out loud" precisely because the page
 * was printing "This week peak day SUN forecasts $9,004 with 7 days with no
 * schedule and top action to drop price on ... by $0.25." The new prompt was
 * measured at 8/8 on the golden set and the page went on printing the old
 * sentence, because nothing in the key had moved.
 *
 * Hashing the TEMPLATE rather than a rendered prompt is the same choice
 * `scripts/eval-llm/fingerprint.ts` makes and for the same reason: this
 * component tracks the instructions, and the facts are already tracked by the
 * component beside it. The model name is in it because a model swap
 * invalidates a stored sentence exactly as thoroughly as a rewrite.
 */
export const VERDICT_NARRATION_VERSION = fnv1a(
  `${VERDICT_MODEL}\n${verdictPromptTemplate("<facts>")}`,
)

/** Digit-runs, normalised so "$9,240" and "9240" compare equal. */
function digitRuns(s: string): string[] {
  return (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""))
}

const REFUSAL = /\b(i'?m sorry|i can'?t|i cannot|as an ai|language model|i'?m unable)\b/i

/**
 * Narrow an untrusted completion to a sentence the page can print, or null.
 *
 * Null is not a failure worth surfacing — the caller renders the deterministic
 * sentence instead, which says the same thing in fixed words.
 */
export function parseVerdictLine(raw: string, facts: VerdictFacts): string | null {
  if (!raw) return null

  // First line only: a chatty model appends "Let me know if..." on line 3.
  let line = raw.split(/\r?\n/)[0] ?? ""
  line = line.trim()
  // Wrapping quotes, straight and curly.
  line = line.replace(/^["'“”‘’]+/, "").replace(/["'“”‘’]+$/, "")
  // Markdown emphasis and code fences the prompt asked for and won't always get.
  line = line.replace(/\*\*|\*|`|_{2,}/g, "")
  line = line.replace(/\s+/g, " ").trim()

  if (line.length === 0) return null
  if (line.length > VERDICT_MAX_CHARS) return null
  if (REFUSAL.test(line)) return null

  // The guard. Every figure must be one the page itself computed.
  const allowed = new Set(Object.values(verdictFactBlock(facts)).flatMap(digitRuns))
  for (const n of digitRuns(line)) {
    if (!allowed.has(n)) return null
  }

  return line
}

export interface VerdictResult {
  line: string
  /** Null when the sentence came from the deterministic composer. */
  model: string | null
}

/**
 * One narrated sentence, or the deterministic one.
 *
 * Callers are expected to cache on the fact block's hash — see
 * `getVerdictLine` in the decisions view — so this runs at most once per store
 * per day no matter how often the page is opened.
 */
export async function generateVerdictLine(
  facts: VerdictFacts,
  opts: { storeId?: string | null; userId?: string | null } = {},
): Promise<VerdictResult> {
  const fallback: VerdictResult = { line: composeVerdict(facts), model: null }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return fallback

  const client = new OpenAI({ apiKey, timeout: 20_000 })
  const started = Date.now()

  try {
    const response = await client.chat.completions.create({
      model: VERDICT_MODEL,
      messages: [{ role: "user", content: buildVerdictPrompt(facts) }],
      // Narration, not invention. Low temperature keeps it close to the facts.
      temperature: 0.2,
      max_tokens: 120,
    })

    // Imported lazily: @/lib/monitoring/ai-usage pulls in Prisma, which throws
    // without DATABASE_URL. The prompt builder and the guard above must stay
    // importable — and unit-testable — without a database behind them.
    const { recordAiUsage } = await import("@/lib/monitoring/ai-usage")
    await recordAiUsage({
      feature: "decision-verdict",
      provider: "openai",
      model: VERDICT_MODEL,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      storeId: opts.storeId ?? null,
      userId: opts.userId ?? null,
      durationMs: Date.now() - started,
    })

    const content = response.choices[0]?.message?.content ?? ""
    const line = parseVerdictLine(content, facts)
    if (!line) {
      logger.warn("[decision-verdict] narration rejected by guard, using composed line")
      return fallback
    }
    return { line, model: VERDICT_MODEL }
  } catch (err) {
    logger.error("[decision-verdict] LLM call failed:", err)
    return fallback
  }
}
