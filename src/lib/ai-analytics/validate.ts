/**
 * Programmatic validator for AI-generated insights. The single non-negotiable
 * rule for the AI analytics surface is: every dollar figure and percentage in
 * a saved insight must reconcile against the real source data we fed into the
 * prompt. This file enforces that rule.
 *
 * Scope of v1 validation:
 *  - All numbers ($ and %) extracted from headline/body text must appear in
 *    the precomputed `allowedNumbers` set within tolerance.
 *  - Named entities (item names, vendor names, ingredient names) listed by
 *    the caller in `allowedEntities` must match — any quoted string in the
 *    insight body that doesn't match any entity is flagged.
 *
 * Things explicitly NOT validated (acceptable in v1):
 *  - Derived numbers (sums, ratios) — the generator is told to use only
 *    values in the source dataset; if it derives, the critic pass catches
 *    bad logic. Adding derivation support balloons false positives.
 *  - Free-form prose claims ("ordering increased dramatically"). These are
 *    judgement calls handled by the critic LLM pass, not the validator.
 */

export interface ValidationResult {
  ok: boolean
  failures: string[]
}

const DOLLAR_RE = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)/g
const PERCENT_RE = /([+-]?\d+(?:\.\d+)?)\s?%/g

const DOLLAR_TOLERANCE = 0.51 // half-cent rounding plus pennies on display
const PERCENT_TOLERANCE = 0.11 // 0.1pp tolerance covers most rounding paths

function parseDollar(match: string): number {
  return Number(match.replace(/,/g, ""))
}

/** Extracts every dollar amount and percentage from a JSON-serializable
 * object. Numbers that look like Postgres IDs or timestamps are excluded by
 * walking the structure rather than regex-scanning the JSON string. */
export function extractAllowedNumbers(source: unknown): {
  dollars: number[]
  percents: number[]
} {
  const dollars: number[] = []
  const percents: number[] = []

  function walk(value: unknown): void {
    if (value === null || value === undefined) return
    if (typeof value === "number" && Number.isFinite(value)) {
      // We don't know whether a raw number is a dollar or percent; allow it
      // to satisfy either bucket. Validator checks both pools.
      dollars.push(value)
      percents.push(value)
      return
    }
    if (typeof value === "string") {
      // Extract any numbers embedded in pre-formatted strings (e.g. "$4.20").
      let m: RegExpExecArray | null
      const dollarRe = new RegExp(DOLLAR_RE.source, "g")
      while ((m = dollarRe.exec(value)) !== null) {
        dollars.push(parseDollar(m[1]))
      }
      const percentRe = new RegExp(PERCENT_RE.source, "g")
      while ((m = percentRe.exec(value)) !== null) {
        percents.push(Number(m[1]))
      }
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (typeof value === "object") {
      for (const v of Object.values(value as Record<string, unknown>)) walk(v)
    }
  }

  walk(source)
  return { dollars, percents }
}

interface ValidateOpts {
  /** All dollar/percent values that the AI may legitimately reference,
   * derived from the source data dict we fed into the prompt. */
  allowedNumbers: { dollars: number[]; percents: number[] }
  /** Entity names (items, vendors, ingredients, store names) the AI may
   * reference. Compared case-insensitively as substrings of insight text. */
  allowedEntities?: string[]
  /** Quoted strings extracted from the insight body must be a substring of at
   * least one allowed entity. Disable for routes that don't reference named
   * entities (e.g. the Overview narrative). */
  validateEntities?: boolean
}

export interface ValidatableInsight {
  headline: string
  body: string
}

function withinTolerance(claimed: number, allowed: number[], tolerance: number): boolean {
  for (const value of allowed) {
    if (Math.abs(claimed - value) <= tolerance) return true
    // Also accept if the claim matches the absolute tolerance scaled to the
    // magnitude of the value (e.g. $250 vs $250.01).
    if (Math.abs(value) > 1 && Math.abs((claimed - value) / value) < 0.005) return true
  }
  return false
}

export function validateInsight(
  insight: ValidatableInsight,
  opts: ValidateOpts,
): ValidationResult {
  const failures: string[] = []
  const text = `${insight.headline}\n${insight.body}`

  let m: RegExpExecArray | null
  const dollarRe = new RegExp(DOLLAR_RE.source, "g")
  while ((m = dollarRe.exec(text)) !== null) {
    const claimed = parseDollar(m[1])
    if (!withinTolerance(claimed, opts.allowedNumbers.dollars, DOLLAR_TOLERANCE)) {
      failures.push(`Dollar claim "$${m[1]}" not present in source data`)
    }
  }

  const percentRe = new RegExp(PERCENT_RE.source, "g")
  while ((m = percentRe.exec(text)) !== null) {
    const claimed = Number(m[1])
    if (!withinTolerance(claimed, opts.allowedNumbers.percents, PERCENT_TOLERANCE)) {
      failures.push(`Percent claim "${m[1]}%" not present in source data`)
    }
  }

  if (opts.validateEntities && opts.allowedEntities && opts.allowedEntities.length > 0) {
    const lower = opts.allowedEntities.map((e) => e.toLowerCase())
    const quoted = [...text.matchAll(/["“]([^"”]{2,80})["”]/g)].map((x) => x[1].toLowerCase())
    for (const claim of quoted) {
      if (!lower.some((e) => e.includes(claim) || claim.includes(e))) {
        failures.push(`Quoted entity "${claim}" not present in source data`)
      }
    }
  }

  return { ok: failures.length === 0, failures }
}

export function validateInsightBatch(
  insights: ValidatableInsight[],
  opts: ValidateOpts,
): ValidationResult {
  const failures: string[] = []
  for (const [i, insight] of insights.entries()) {
    const result = validateInsight(insight, opts)
    for (const f of result.failures) failures.push(`[insight ${i}] ${f}`)
  }
  return { ok: failures.length === 0, failures }
}
