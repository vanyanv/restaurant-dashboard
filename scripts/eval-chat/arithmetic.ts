/**
 * The arithmetic half of the golden set.
 *
 * The rest of this harness asks whether the assistant ANSWERED. This file asks
 * whether the answer was TRUE, which is the only question that matters about a
 * number an owner is going to act on. It checks in two layers, because there
 * are two independent ways for a figure to come out wrong:
 *
 *   Layer 1 — tool vs SQL. Every sales tool is recomputed here from its OWN
 *     arguments, in raw SQL, against the same rows. No Prisma, no `groupBy`,
 *     no shared helper: a second implementation, so that a bug in the first one
 *     has somewhere to show up. This is the layer that would have caught the
 *     three arithmetic failures already on this project's record — Otter's
 *     negative discounts added instead of subtracted, `ForecastDailyRevenue`
 *     summed across model generations at 12.7x, and the pack-metadata spike
 *     that put an ingredient's cost 200x over.
 *
 *   Layer 2 — answer vs tool. Every dollar figure in the prose must be
 *     traceable to a number a tool actually returned (or a plain roll-up of
 *     them: a column total, a per-row average). A figure that traces to
 *     nothing was invented, and an invented figure is the worst thing this
 *     product can do, because it is indistinguishable from a real one.
 *
 * Layer 2 is why the 28 questions whose tables are EMPTY are worth running.
 * With no rows behind it, the honest answer is "we don't have that", and the
 * explainable set is empty — so any dollar figure at all is a fabrication, and
 * says so. Without this file the harness passed those questions for the sole
 * reason that the model said something.
 *
 * Tolerance is $0.02 absolute or 0.5% relative, whichever is looser. The slack
 * is for rounding in prose ("$44.9k", "$44,908"), and it is far tighter than
 * any of the failure modes above, all of which are wrong by multiples.
 */

import type pg from "pg"
import type { ToolCallRecord } from "./stream"

/** One figure the tool reported, and what the database independently says. */
export interface FigureDiff {
  tool: string
  label: string
  reported: number
  actual: number
  ok: boolean
}

/** A dollar figure in the prose that no tool result accounts for. */
export interface UnexplainedFigure {
  token: string
  value: number
  /** The legitimate value it came closest to, for the report. */
  nearest: number | null
  /**
   * `fabricated` — the tools returned no number this could have come from, or
   * one an order of magnitude away. Nothing defensible produces it. Gated.
   *
   * `underived` — the tools returned data in this figure's range and it is not
   * one of them or a whole-set roll-up. Usually a legitimate derivation this
   * file cannot reconstruct (see `unexplainedFigures`). Reported, not gated.
   */
  verdict: "fabricated" | "underived"
}

const ABS_TOLERANCE = 0.02
const REL_TOLERANCE = 0.005

export function withinTolerance(a: number, b: number): boolean {
  if (Math.abs(a - b) <= ABS_TOLERANCE) return true
  const scale = Math.max(Math.abs(a), Math.abs(b))
  if (scale === 0) return false
  return Math.abs(a - b) / scale <= REL_TOLERANCE
}

// ───────────────────────── Layer 1: tool vs SQL ─────────────────────────

interface Totals {
  gross: number
  net: number
  fees: number
  tax: number
  tips: number
  count: number
}

const TOTALS_SQL = `
  SELECT
    COALESCE(SUM(COALESCE("fpGrossSales",0) + COALESCE("tpGrossSales",0)), 0)::float   AS gross,
    COALESCE(SUM(COALESCE("fpNetSales",0)   + COALESCE("tpNetSales",0)), 0)::float     AS net,
    COALESCE(SUM(COALESCE("fpFees",0)       + COALESCE("tpFees",0)), 0)::float         AS fees,
    COALESCE(SUM(COALESCE("fpTaxCollected",0) + COALESCE("tpTaxCollected",0)), 0)::float AS tax,
    COALESCE(SUM(COALESCE("fpTips",0)       + COALESCE("tpTipForRestaurant",0)), 0)::float AS tips,
    COALESCE(SUM(COALESCE("fpOrderCount",0) + COALESCE("tpOrderCount",0)), 0)::int     AS count
  FROM "OtterDailySummary"
  WHERE "storeId" = ANY($1) AND date >= $2::date AND date <= $3::date
`

async function totalsFor(
  db: pg.Client,
  storeIds: string[],
  from: string,
  to: string,
): Promise<Totals> {
  const { rows } = await db.query(TOTALS_SQL, [storeIds, from, to])
  const r = rows[0] ?? {}
  return {
    gross: Number(r.gross ?? 0),
    net: Number(r.net ?? 0),
    fees: Number(r.fees ?? 0),
    tax: Number(r.tax ?? 0),
    tips: Number(r.tips ?? 0),
    count: Number(r.count ?? 0),
  }
}

/** The store ids a call was scoped to: its own, or every store the owner runs. */
function scopeOf(input: unknown, allStoreIds: string[]): string[] {
  const ids = (input as { storeIds?: unknown })?.storeIds
  return Array.isArray(ids) && ids.length > 0 ? (ids as string[]) : allStoreIds
}

function rangeOf(input: unknown, key = "dateRange"): { from: string; to: string } | null {
  const r = (input as Record<string, unknown>)?.[key] as
    | { from?: unknown; to?: unknown }
    | undefined
  if (typeof r?.from !== "string" || typeof r?.to !== "string") return null
  return { from: r.from, to: r.to }
}

/** Unwraps `withSidecar`'s `{ rows, asOf, present }` envelope. */
function rowsOf(output: unknown): unknown[] | null {
  if (Array.isArray(output)) return output
  const rows = (output as { rows?: unknown })?.rows
  return Array.isArray(rows) ? rows : null
}

function sumColumn(rows: unknown[], key: string): number {
  let total = 0
  for (const row of rows) {
    const v = (row as Record<string, unknown>)?.[key]
    if (typeof v === "number") total += v
  }
  return total
}

function compare(
  tool: string,
  label: string,
  reported: number,
  actual: number,
): FigureDiff {
  return { tool, label, reported, actual, ok: withinTolerance(reported, actual) }
}

/**
 * Recomputes one tool call in SQL and diffs it against what the tool returned.
 * Returns [] for tools this file has no second implementation of — silence
 * here means "not checked", never "checked and fine", and the report says so.
 */
export async function recomputeCall(
  call: ToolCallRecord,
  db: pg.Client,
  allStoreIds: string[],
): Promise<FigureDiff[]> {
  if (call.error) return []
  const stores = scopeOf(call.input, allStoreIds)

  switch (call.toolName) {
    case "getDailySales":
    case "getPlatformBreakdown": {
      const range = rangeOf(call.input)
      const rows = rowsOf(call.output)
      if (!range || !rows) return []
      const truth = await totalsFor(db, stores, range.from, range.to)
      const t = call.toolName
      // Whatever the grouping, the columns must sum to the window's totals.
      return [
        compare(t, "net sales (sum of rows)", sumColumn(rows, "net"), truth.net),
        compare(t, "gross sales (sum of rows)", sumColumn(rows, "gross"), truth.gross),
        compare(t, "order count (sum of rows)", sumColumn(rows, "count"), truth.count),
      ]
    }

    case "getStoreBreakdown": {
      const range = rangeOf(call.input)
      const rows = rowsOf(call.output)
      if (!range || !rows) return []
      const truth = await totalsFor(db, stores, range.from, range.to)
      const diffs = [
        compare("getStoreBreakdown", "net sales (sum of stores)", sumColumn(rows, "net"), truth.net),
        compare("getStoreBreakdown", "order count (sum of stores)", sumColumn(rows, "count"), truth.count),
      ]
      // Each store's own row, against that store alone — a per-store total
      // that is right only in aggregate is still wrong.
      for (const row of rows) {
        const r = row as { storeId?: string; storeName?: string; net?: number }
        if (typeof r.storeId !== "string" || typeof r.net !== "number") continue
        const one = await totalsFor(db, [r.storeId], range.from, range.to)
        diffs.push(
          compare("getStoreBreakdown", `net sales · ${r.storeName ?? r.storeId}`, r.net, one.net),
        )
      }
      return diffs
    }

    case "compareSales": {
      const a = rangeOf(call.input, "periodA")
      const b = rangeOf(call.input, "periodB")
      const out = call.output as
        | {
            periodA?: Partial<Totals>
            periodB?: Partial<Totals>
            delta?: { net?: number; netPctChange?: number | null }
          }
        | undefined
      if (!a || !b || !out?.periodA || !out?.periodB) return []
      const [truthA, truthB] = await Promise.all([
        totalsFor(db, stores, a.from, a.to),
        totalsFor(db, stores, b.from, b.to),
      ])
      const diffs = [
        compare("compareSales", "period A net", out.periodA.net ?? NaN, truthA.net),
        compare("compareSales", "period A count", out.periodA.count ?? NaN, truthA.count),
        compare("compareSales", "period B net", out.periodB.net ?? NaN, truthB.net),
        compare("compareSales", "period B count", out.periodB.count ?? NaN, truthB.count),
      ]
      if (typeof out.delta?.net === "number") {
        diffs.push(compare("compareSales", "delta net", out.delta.net, truthA.net - truthB.net))
      }
      if (typeof out.delta?.netPctChange === "number" && truthB.net !== 0) {
        diffs.push(
          compare(
            "compareSales",
            "delta net %",
            out.delta.netPctChange,
            (truthA.net - truthB.net) / truthB.net,
          ),
        )
      }
      return diffs
    }

    case "getHourlyTrend": {
      const range = rangeOf(call.input)
      const rows = rowsOf(call.output)
      if (!range || !rows) return []
      // Hourly rolls up from a different table; the day filter makes a total
      // comparison unsound, so check only the unfiltered case.
      if ((call.input as { dayOfWeek?: unknown })?.dayOfWeek !== undefined) return []
      const { rows: got } = await db.query(
        `SELECT COALESCE(SUM("orderCount"),0)::int AS count,
                COALESCE(SUM("netSales"),0)::float AS net
           FROM "OtterHourlySummary"
          WHERE "storeId" = ANY($1) AND date >= $2::date AND date <= $3::date`,
        [stores, range.from, range.to],
      )
      return [
        compare("getHourlyTrend", "orders (sum of hours)", sumColumn(rows, "count"), Number(got[0]?.count ?? 0)),
        compare("getHourlyTrend", "net sales (sum of hours)", sumColumn(rows, "netSales"), Number(got[0]?.net ?? 0)),
      ]
    }

    default:
      return []
  }
}

/** The tools this file can recompute. Anything else is reported unchecked. */
export const RECOMPUTED_TOOLS = [
  "getDailySales",
  "getPlatformBreakdown",
  "getStoreBreakdown",
  "compareSales",
  "getHourlyTrend",
] as const

// ────────────────────── Layer 2: answer vs tool ──────────────────────

/**
 * `$1,234.56`, `$44.9k`, `$1.2M`. Bare numbers are ignored — too ambiguous.
 *
 * The suffix must not run into a word. Written with `\s?([kKmM])?` this read
 * "$157,627 kept after commissions" as $157,627 THOUSAND and reported a real
 * figure as a thousand-fold invention. The magnitude letter has to be attached
 * to the digits and followed by a non-word character to count.
 */
const MONEY = /\$\s?(-?\d[\d,]*(?:\.\d+)?)([kKmM])?(?![\w])/g

function collectNumbers(value: unknown, into: Set<number>, depth = 0): void {
  if (depth > 8) return
  if (typeof value === "number" && Number.isFinite(value)) {
    into.add(value)
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) collectNumbers(v, into, depth + 1)
    return
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectNumbers(v, into, depth + 1)
  }
}

/**
 * Every value the answer is entitled to state: each number any tool returned,
 * plus the roll-ups a person would naturally write — a column total and its
 * per-row average. Anything outside this set was not read off the data.
 *
 * Held as MAGNITUDES, because prose carries a decline's direction in the verb
 * and not in the digits: `compareSales` returns `delta.net: -6743.60` and the
 * answer correctly writes "net sales fell $6,743.60". Comparing signed values
 * flagged every honest decline in the set as an invention. Sign is checked
 * where it can be checked exactly — layer 1, against SQL — which is also the
 * layer that owns Otter's negative discounts and fees.
 */
function explainableValues(calls: ToolCallRecord[]): Set<number> {
  const signed = new Set<number>()
  for (const call of calls) {
    if (call.output === undefined) continue
    collectNumbers(call.output, signed)

    const rows = rowsOf(call.output)
    if (!rows || rows.length === 0) continue
    const keys = new Set<string>()
    for (const row of rows) {
      if (row && typeof row === "object") {
        for (const [k, v] of Object.entries(row)) {
          if (typeof v === "number") keys.add(k)
        }
      }
    }
    for (const key of keys) {
      const total = sumColumn(rows, key)
      signed.add(total)
      signed.add(total / rows.length)
    }
  }
  const magnitudes = new Set<number>()
  for (const v of signed) magnitudes.add(Math.abs(v))
  return magnitudes
}

/**
 * WHAT THIS CAN AND CANNOT SEE.
 *
 * It is a fabrication detector, not an arithmetic verifier. Layer 1 is the
 * arithmetic verifier, and it is exact; this layer answers the narrower
 * question of whether a figure could have come from the data at all.
 *
 * Two limits, both found by running it:
 *
 * - A figure derived over a SUBSET is not reconstructible here. Asked whether
 *   weekends beat weekdays, the model correctly reported an average ticket of
 *   $21.24 for weekend days — net over orders, across 8 of the 28 rows. Every
 *   input was returned by the tool; the quotient was not, and enumerating the
 *   subsets a question might slice is not a thing this file can do.
 * - A match is not proof. `getDailySales` over 28 days returns ~170 numbers in
 *   a narrow band, so a 0.5% window around a mid-range figure has a real
 *   chance of landing on an unrelated one. In the same answer, the per-day
 *   averages $8,529 and $6,636 passed — plausibly by coincidence.
 *
 * Both limits vanish in the case the check exists for. When the tables are
 * empty the tools return no numbers, the set is empty, nothing can match by
 * accident, and any dollar figure at all is an invention. That is what the 28
 * questions against empty tables are for, and it is why `fabricated` is gated
 * while `underived` is only reported.
 */
export function unexplainedFigures(
  text: string,
  calls: ToolCallRecord[],
): UnexplainedFigure[] {
  const values = [...explainableValues(calls)]
  const out: UnexplainedFigure[] = []
  const seen = new Set<string>()

  for (const match of text.matchAll(MONEY)) {
    const token = match[0].trim()
    if (seen.has(token)) continue
    seen.add(token)

    const magnitude = match[2]?.toLowerCase() === "k" ? 1_000 : match[2]?.toLowerCase() === "m" ? 1_000_000 : 1
    const value = Math.abs(Number(match[1].replace(/,/g, "")) * magnitude)
    if (!Number.isFinite(value)) continue
    // $0 is always defensible: it is what "we have none of that" looks like.
    if (value === 0) continue
    if (values.some((v) => withinTolerance(v, value))) continue

    let nearest: number | null = null
    let best = Infinity
    for (const v of values) {
      const d = Math.abs(v - value)
      if (d < best) {
        best = d
        nearest = v
      }
    }

    // A derivation lands inside the envelope of what the tools returned; an
    // invention need not. Ten times outside it, or nothing returned at all,
    // and there is no arithmetic on this data that reaches the figure.
    const magnitudes = values.filter((v) => v > 0)
    const low = magnitudes.length > 0 ? Math.min(...magnitudes) : 0
    const high = magnitudes.length > 0 ? Math.max(...magnitudes) : 0
    const verdict: UnexplainedFigure["verdict"] =
      nearest === null || value > high * 10 || value < low / 10
        ? "fabricated"
        : "underived"

    out.push({ token, value, nearest, verdict })
  }
  return out
}
