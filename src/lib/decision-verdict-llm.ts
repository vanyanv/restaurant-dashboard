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
  verdictFactBlock,
  type VerdictFacts,
} from "@/app/dashboard/decisions/lib/verdict-copy"

export const VERDICT_MODEL = "gpt-4.1-mini"

// Owned by verdict-copy so the composer can respect the same budget without a
// circular import. Re-exported here because the guard is its main consumer.
export { VERDICT_MAX_CHARS } from "@/app/dashboard/decisions/lib/verdict-copy"

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

export function buildVerdictPrompt(facts: VerdictFacts): string {
  const block = verdictFactBlock(facts)
  return `You write the single opening sentence of a restaurant owner's weekly decisions page. The owner is closing books late and wants to know what this week asks of them.

Here are the only facts you may use. They are already computed and already formatted:

${JSON.stringify(block, null, 2)}

Rules:
- Write ONE sentence, at most ${VERDICT_PROMPT_MAX_CHARS} characters.
- Use only figures that appear verbatim above. Copy them exactly, including the dollar sign and commas.
- Do not compute anything. Do not add, subtract, average, project, or round any figure. Do not infer a number that is not listed.
- Do not predict, promise, or speculate about outcomes. State what the week is.
- Plain operator English. No greeting, no preamble, no markdown, no quotation marks, no emoji.
- Lead with whatever a working owner would act on first — usually the biggest day, or the gap between what the week earns and what is scheduled for it.

Return only the sentence.`
}

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
