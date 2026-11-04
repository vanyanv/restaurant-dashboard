import type { FiledReturn, ReturnPart } from "./return"

/**
 * THE ANSWER CHECK.
 *
 * Every dollar amount and percentage the answer prints — in the figures, the
 * verdict and the paragraph — has to be a number one of this turn's lookups
 * returned, or one plainly worked out from them. Whatever is not gets named
 * under the answer as unchecked, so a figure the model made up (or summed
 * wrongly) can never pass as one the dashboard reported.
 *
 * Pure and deterministic: no model call, no clock, no database. It runs on the
 * parts the stream already delivered, the same way `selectFiledReturn` does,
 * so a live turn and a reopened thread get the same verdict.
 *
 * What counts as "from the data", for a claimed value v shown at some
 * precision (tolerance t, half its last shown digit):
 *   - any number a tool returned, as is, ×100 (a 0.253 fraction shown as
 *     25.3%) or ÷100 (cents shown as dollars);
 *   - a column total — every value under one key across an array of rows,
 *     which is how "the week's total" is read off seven day rows;
 *   - the difference of two numbers that sit together — fields of one row,
 *     or one field across rows or lookups ("$120 more than last week");
 *   - one of those as a percent of another, or the percent change between two.
 * Signs are ignored: "down $120" is a claim about 120.
 *
 * It does not catch a number taken from the wrong row. It catches the
 * number that is in no row at all, which is the failure that matters for
 * "only real numbers".
 */

const FILE_RETURN = "fileReturn"

export interface NumberCheck {
  /** Per filed figure, in order: true when its value could not be matched. */
  figures: boolean[]
  /** The unmatched amounts as the answer printed them, deduped, in reading order. */
  unchecked: string[]
}

interface Claim {
  text: string
  value: number
  tol: number
  percent: boolean
}

const CLAIM_RE = /(\$\s?-?\d[\d,]*(?:\.\d+)?\s?[kKmM]?\b)|(-?\d[\d,]*(?:\.\d+)?\s?%)/g
const NUM_RE = /-?\d[\d,]*(?:\.\d+)?/g

function parseNumber(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ""))
  return Number.isFinite(n) ? n : null
}

/** Half the last digit shown: "$48,912" → 0.5, "66.2%" → 0.05, "$49,000" → 500, "$48.9k" → 50. */
function toleranceFor(digits: string, scale: number): number {
  const clean = digits.replace(/,/g, "").replace(/^-/, "")
  const dot = clean.indexOf(".")
  if (dot >= 0) return 0.5 * 10 ** -(clean.length - dot - 1) * scale
  const zeros = clean.match(/0+$/)?.[0].length ?? 0
  // "$100" and "$1,000" read as exact amounts as often as rounded ones; only
  // three or more trailing zeros on a larger figure count as rounding.
  const rounded = zeros >= 3 && clean.length > zeros ? zeros : 0
  return 0.5 * 10 ** rounded * scale
}

export function claimsIn(text: string): Claim[] {
  const out: Claim[] = []
  for (const m of text.matchAll(CLAIM_RE)) {
    const token = (m[1] ?? m[2]).trim()
    const percent = Boolean(m[2])
    const digits = token.replace(/[$%\s]/g, "").replace(/[kKmM]$/, "")
    const suffix = token.match(/[kKmM]$/)?.[0]?.toLowerCase()
    const scale = suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : 1
    const n = parseNumber(digits)
    if (n === null) continue
    const value = Math.abs(n) * scale
    // 0 and 100% match almost anything and say nothing worth checking.
    if (value === 0 || (percent && value === 100)) continue
    out.push({ text: token, value, tol: toleranceFor(digits, scale), percent })
  }
  return out
}

export interface Sources {
  /** Every number returned, plus each array-of-rows column total. */
  all: number[]
  /**
   * Sets a two-number working-out may draw from: the numeric fields of one
   * object (cost beside sales), and the values of one key wherever it occurs
   * (this week's net sales and last week's). Pairing across ALL numbers would
   * match nearly any percentage by chance once a turn has read a few hundred
   * of them, which would make the check say nothing.
   */
  groups: number[][]
}

const GROUP_CAP = 80

/** What one turn's lookups returned, read for checking. */
export function sourceNumbers(outputs: readonly unknown[]): Sources {
  const seen = new Set<number>()
  const groups: number[][] = []
  const byKey = new Map<string, number[]>()
  const add = (n: number) => {
    if (Number.isFinite(n) && n !== 0) seen.add(Math.abs(n))
  }
  const walk = (v: unknown, depth: number): void => {
    if (depth > 12 || v == null) return
    if (typeof v === "number") return add(v)
    if (typeof v === "string") {
      for (const m of v.matchAll(NUM_RE)) {
        const n = parseNumber(m[0])
        if (n !== null) add(n)
      }
      return
    }
    if (Array.isArray(v)) {
      const sums = new Map<string, number>()
      for (const item of v) {
        walk(item, depth + 1)
        if (item && typeof item === "object" && !Array.isArray(item)) {
          for (const [k, x] of Object.entries(item)) {
            if (typeof x === "number" && Number.isFinite(x)) sums.set(k, (sums.get(k) ?? 0) + x)
          }
        }
      }
      if (v.length > 1) {
        for (const [k, s] of sums) {
          add(s)
          const list = byKey.get(`\u03a3${k}`) ?? []
          list.push(Math.abs(s))
          byKey.set(`\u03a3${k}`, list)
        }
      }
      return
    }
    if (typeof v === "object") {
      const siblings: number[] = []
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (typeof x === "number" && Number.isFinite(x) && x !== 0) {
          siblings.push(Math.abs(x))
          const list = byKey.get(k) ?? []
          list.push(Math.abs(x))
          byKey.set(k, list)
        }
        walk(x, depth + 1)
      }
      if (siblings.length > 1) groups.push(siblings.slice(0, GROUP_CAP))
    }
  }
  for (const o of outputs) walk(o, 0)
  for (const list of byKey.values()) if (list.length > 1) groups.push([...new Set(list)].slice(0, GROUP_CAP))
  return { all: [...seen], groups }
}

function near(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol + 1e-9
}

export function matches(claim: Claim, sources: Sources): boolean {
  const { value: v, tol } = claim
  for (const s of sources.all) {
    if (near(s, v, tol) || near(s * 100, v, tol) || near(s / 100, v, tol)) return true
  }
  // Worked out from two numbers that sit together. Only reached for the few
  // claims a direct lookup missed.
  for (const g of sources.groups) {
    for (let i = 0; i < g.length; i++) {
      const a = g[i]
      for (let j = 0; j < g.length; j++) {
        if (i === j) continue
        const b = g[j]
        if (!claim.percent && near(Math.abs(a - b), v, tol)) return true
        if (claim.percent) {
          if (near((a / b) * 100, v, tol)) return true
          if (near((Math.abs(a - b) / b) * 100, v, tol)) return true
        }
      }
    }
  }
  return false
}

function partName(p: ReturnPart): string {
  return p.toolName ?? p.type.replace(/^tool-/, "")
}

const cache = new WeakMap<readonly ReturnPart[], Map<string, NumberCheck>>()

/**
 * Check one answer against the lookups that produced it.
 *
 * A turn that called no data tool is not checked: a refusal or a clarifying
 * question has nothing to check against, and flagging every number in it
 * would bury the one place the reader is told why there is no answer.
 */
export function checkAnswerNumbers(
  parts: readonly ReturnPart[],
  filed: FiledReturn | null,
  body: string,
): NumberCheck {
  const key = `${filed?.verdict ?? ""}\u0000${(filed?.figures ?? []).map((f) => f.value).join("\u0001")}\u0000${body}`
  const hit = cache.get(parts)?.get(key)
  if (hit) return hit

  const outputs = parts
    .filter((p) => p && typeof p.type === "string" && p.state === "output-available" && partName(p) !== FILE_RETURN)
    .map((p) => p.output)
  const figures = (filed?.figures ?? []).map(() => false)
  let result: NumberCheck = { figures, unchecked: [] }

  if (outputs.length > 0) {
    const sources = sourceNumbers(outputs)
    const unchecked: string[] = []
    const flag = (c: Claim) => {
      if (!unchecked.includes(c.text)) unchecked.push(c.text)
    }
    ;(filed?.figures ?? []).forEach((f, i) => {
      const bad = claimsIn(f.value).filter((c) => !matches(c, sources))
      if (bad.length > 0) {
        figures[i] = true
        bad.forEach(flag)
      }
    })
    for (const c of claimsIn(`${filed?.verdict ?? ""}\n${body}`)) if (!matches(c, sources)) flag(c)
    result = { figures, unchecked }
  }

  const byKey = cache.get(parts) ?? new Map<string, NumberCheck>()
  byKey.set(key, result)
  cache.set(parts, byKey)
  return result
}

/** The line printed under an answer with unchecked amounts, or null when everything matched. */
export function uncheckedLine(unchecked: readonly string[]): string | null {
  if (unchecked.length === 0) return null
  const list = unchecked.slice(0, 6).join(", ")
  const more = unchecked.length > 6 ? ` and ${unchecked.length - 6} more` : ""
  return unchecked.length === 1
    ? `Not checked: ${list} doesn't match any number the chat looked up. Treat it as unverified.`
    : `Not checked: ${list}${more} don't match any number the chat looked up. Treat them as unverified.`
}
