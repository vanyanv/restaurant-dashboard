import { shortStoreName } from "@/lib/checks/names"
import { money } from "@/lib/counter/format"
import type { Statement, StatementLines } from "@/lib/counter/statement"
import { serializeWeekWindow, type SerializedWeekWindow, type WeekWindow } from "@/lib/counter/date-range"
import type { ElapsedCompare } from "@/lib/counter/elapsed-compare"
import { foodGapParts, pctWords, uncostedShare } from "@/lib/counter/food-coverage"

/**
 * The P&L "made plain" — the owner-approved redesign of 2026-11-03 (thread
 * "Make P&L clearer with day drill-down"; mock
 * https://claude.ai/artifact/EjD7D1265pyAu9PS8zz4xf).
 *
 * One function turns the statements the page already loads into what the top
 * of the page prints: the kept figure and its move against the prior period,
 * the eight weeks as a picker, the status of each input in words, the gaps
 * grouped into three to-dos, where each dollar went, every day of the range,
 * and one card per store.
 *
 * Nothing here computes a P&L. Every dollar is a line of a `Statement`
 * (`statement.ts`, which reads `getAllStoresPnL`), so the figure on this page
 * and the figure in the full statement below it are the same number. What
 * this module adds is the READING: which inputs are incomplete, and saying so
 * instead of letting a missing day of labor print as $0.
 *
 * The rule it keeps: **an incomplete figure is labelled, never filled in.**
 * Every input the rollup counted as $0 for want of data makes the kept figure
 * an upper bound, so it is marked `atMost`, the page prints "at most", and
 * the line beside the figure names each cause (`upperBoundCauses`):
 *
 * - a store-day that sold with no Harri labor (`laborMissingDays`);
 * - a store-day that sold with no recipe-cost rows (`cogsMissingDays`);
 * - sales on items with no recipe or unpriced ingredients (`uncostedSales`);
 * - a fixed cost not on the store file (rent, cleaning, towels);
 * - app orders with no recorded fee and no rate on file (`unknownOrders`).
 *
 * What the rollup ESTIMATED rather than read — labor days filled from the
 * monthly budget, app fees at the store's rates — is not an upper bound, but
 * it is said as an estimate beside the figure (owner, 2026-11-03: "only use
 * real, verifiable numbers"; 2026-11-19: estimates must say they are).
 */

export type PlainTone = "ok" | "warn" | "bad"

export type PlainKey = "fees" | "food" | "labor" | "fixed" | "kept"

/** One slice of the dollar. `amount` is positive for costs; `kept` may be negative. */
export interface PlainLine {
  key: PlainKey
  label: string
  amount: number
  /** `amount / sales`, or null with no sales. */
  share: number | null
  /** Change in points of sales against the prior period, or null with none. */
  changePts: number | null
  /** How the line was worked out, in words. */
  how: string
  tone: PlainTone
}

export interface PlainStatus {
  tone: PlainTone
  text: string
}

export interface PlainTodo {
  tone: Exclude<PlainTone, "ok">
  title: string
  items: string[]
  action: { label: string; href: string }
}

export interface PlainWeek {
  window: SerializedWeekWindow
  /** "10/26" */
  label: string
  sales: number
  kept: number
  keptPct: number | null
  /** An input is missing (labor, food cost, app fees), so `kept` is an upper bound. */
  atMost: boolean
  /** The running week, clipped to today: its figures are "so far". */
  running: boolean
}

export interface PlainDayStore {
  storeId: string
  name: string
  sales: number
  kept: number
  laborMissing: boolean
}

export interface PlainDay {
  /** `YYYY-MM-DD` */
  date: string
  /** "Mon 10/26" */
  label: string
  /** "Mon" */
  short: string
  sales: number
  kept: number
  keptPct: number | null
  atMost: boolean
  /** A gap of this day's own (labor, food, fees), so it cannot be the best day. */
  ownGap: boolean
  best: boolean
  /** Short names of the stores that sold this day with no labor reading. */
  laborMissing: string[]
  lines: PlainLine[]
  stores: PlainDayStore[]
}

export interface PlainStore {
  storeId: string
  name: string
  sales: number
  kept: number
  keptPct: number | null
  /** Kept against the prior period; null with no prior sales, or while the last day is incomplete (a part-day's kept is not comparable). */
  keptChange: number | null
  /** Sales against the same store's prior period, or null with no prior sales. */
  salesChange: number | null
  /** The prior sales `salesChange` is measured against, so a percent divides by the right base. Null with `salesChange`. */
  salesPrior: number | null
  /** Days this store sold with no Harri labor reading. */
  laborMissingDays: number
  /** Days this store sold with no Harri reading, labor filled from its budget. */
  laborEstimatedDays: number
  food: number | null
  labor: number | null
  fees: number | null
  atMost: boolean
  /** "2 days of labor missing", "cleaning not on file" — empty when every input is on file. */
  flags: string[]
}

export interface PnlPlain {
  sales: number
  kept: number
  keptPct: number | null
  /** "at most · 2 Glendale days of labor missing", or null when nothing is missing. */
  atMost: string | null
  /**
   * The line printed beside the figure: `atMost`, plus what in it is an
   * estimate ("… · 3 days of labor estimated from your labor budget"), or
   * "estimated · …" when nothing is missing but something is estimated. Null
   * when every input is a reading.
   */
  keptNote: string | null
  /** The counts behind `atMost` and `keptNote`, for surfaces that say them differently. */
  gaps: PlainGaps
  /**
   * The move against the prior period. While the last day of the range is
   * still trading or syncing it is the hour-for-hour sales comparison
   * (`elapsed-compare.ts`): `kept` and `pts` are null, since a part-day's kept
   * has nothing fair to stand against, and `against` says what is compared.
   */
  vsPrior: {
    label: string
    kept: number | null
    pts: number | null
    sales: number
    /** The prior sales `sales` is measured against. */
    salesPrior: number
    /** Words for the comparison when it is not the plain "vs <label>". */
    against?: string
  } | null
  /**
   * Said in place of, or beside, the comparison while the last day is
   * incomplete: "So far today, through 11 am, …" or "… waits until the day is
   * complete." Null when the range is complete and compares in full.
   */
  compareNote: string | null
  sentence: string
  statuses: PlainStatus[]
  todos: PlainTodo[]
  lines: PlainLine[]
  weeks: PlainWeek[]
  /** Every day of the range, or null when the range is too long to list by day. */
  days: PlainDay[] | null
  stores: PlainStore[]
}

export interface PlainGaps {
  laborMissingDays: number
  laborEstimatedDays: number
  cogsMissingDays: number
  /** `uncostedSales / sales`, or null with no sales. */
  uncostedShare: number | null
  /** App orders with no recorded fee and no rate on file: $0 counted. */
  unknownOrders: number
  /** Share of app orders whose fee was worked out from the store's rates, or null with none. */
  rateShare: number | null
  /** Fixed costs not on the store file; null when the store file did not load. */
  fixedNotOnFile: number | null
}

/** The store file fields this reading looks at. A full `Store` row satisfies it. */
export interface PlainStoreFile {
  id: string
  name: string
  fixedMonthlyRent: number | null
  fixedMonthlyCleaning: number | null
  fixedMonthlyTowels: number | null
}

export interface PlainInput {
  statement: Statement
  /** The prior period of the same length (`comparisonWindows(range, "prev")`), or null. */
  prior: Statement | null
  /** Its words: "Oct 19 – 25". */
  priorLabel: string | null
  weekWindows: WeekWindow[]
  weeks: Statement[] | null
  /** A daily load of the range (`periods` are days), or null when not loaded. */
  daily: Statement | null
  files: PlainStoreFile[]
  storeId: string | null
  /**
   * Set when the range's last day is still trading or syncing
   * (`loadElapsedCompare`): the sales comparison is then hour for hour and
   * the full-day prior is not compared against. Absent or null: in full.
   */
  elapsed?: ElapsedCompare | null
}

/** Longest range listed day by day. Past this the page says "pick a week". */
export const PLAIN_MAX_DAYS = 31

const LABEL: Record<PlainKey, string> = {
  fees: "App fees",
  food: "Food",
  labor: "Labor",
  fixed: "Rent & fixed",
  kept: "Kept",
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

const share = (v: number, sales: number): number | null => (sales > 0 ? v / sales : null)

/** The five slices of a statement. `fixed` is every fixed line that is not labor. */
export function slices(l: StatementLines): Record<PlainKey, number> {
  return {
    fees: l.commissions,
    food: l.cogsValue,
    labor: l.laborValue,
    fixed: l.occupancy + l.otherOperating,
    kept: l.bottomLine,
  }
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function list(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? ""
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`
}

/** "12¢" */
function cents(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}¢`
}

/** Missing fixed lines on the files in scope, as "Van Nuys cleaning". */
export function fixedNotOnFile(files: PlainStoreFile[]): { storeId: string; store: string; what: string }[] {
  const out: { storeId: string; store: string; what: string }[] = []
  for (const f of files) {
    const store = shortStoreName(f.name)
    if (f.fixedMonthlyRent == null) out.push({ storeId: f.id, store, what: "rent" })
    if (f.fixedMonthlyCleaning == null) out.push({ storeId: f.id, store, what: "cleaning" })
    if (f.fixedMonthlyTowels == null) out.push({ storeId: f.id, store, what: "towels" })
  }
  return out
}

/**
 * Share of marketplace orders whose fee was worked out from the store's rate.
 * Orders with no rate at all (`unknownOrders`) are NOT in it: nothing was
 * worked out for them, they count $0 and make the figure an upper bound.
 */
function rateShare(l: StatementLines): number | null {
  const c = l.commission
  return c.orders > 0 ? c.ordersEstimated / c.orders : null
}

/** Above this share of app orders at the store's rates, the fee line is called estimated. */
export const FEES_ESTIMATED_WARN = 0.1


/**
 * The inputs counted as $0 for want of data, in the words the line beside
 * the figure prints. Empty when the figure is whole. The ONE place a kept
 * figure is judged an upper bound: headline, weeks, days and stores all ask it.
 */
export function upperBoundCauses(
  l: StatementLines,
  opts: { laborMissing?: string[]; fixedNotOnFile?: number | null } = {},
): string[] {
  const out: string[] = []
  if (opts.laborMissing) out.push(...opts.laborMissing)
  else if (l.laborMissingDays > 0) out.push(`${plural(l.laborMissingDays, "day")} of labor missing`)
  // The food half's words are the shared rule's, so the P&L, Overview and
  // Analytics label a partial food cost exactly as this line does.
  out.push(...foodGapParts(l))
  if (opts.fixedNotOnFile === null) out.push("store settings did not load")
  else if (opts.fixedNotOnFile) out.push(`${plural(opts.fixedNotOnFile, "fixed cost")} not on file`)
  if (l.commission.unknownOrders > 0) out.push(`${plural(l.commission.unknownOrders, "app order")} with no fee`)
  return out
}

/** What in a kept figure is an estimate rather than a reading, in words. */
export function estimateParts(l: StatementLines): string[] {
  const out: string[] = []
  if (l.laborEstimatedDays > 0) out.push(`${plural(l.laborEstimatedDays, "day")} of labor estimated from your labor budget`)
  const r = rateShare(l)
  if (r !== null && r > FEES_ESTIMATED_WARN) out.push(`${pctWords(r)} of app fees estimated from your rates`)
  return out
}

function noteFor(causes: string[], estimates: string[]): { atMost: string | null; note: string | null } {
  const atMost = causes.length > 0 ? `at most · ${causes.join(" · ")}` : null
  const note =
    atMost !== null
      ? [atMost, ...estimates].join(" · ")
      : estimates.length > 0
        ? `estimated · ${estimates.join(" · ")}`
        : null
  return { atMost, note }
}

/** The fee line's words and tone: real fees, estimated at your rates, or missing. */
function feesHow(l: StatementLines): [string, PlainTone] {
  const c = l.commission
  if (c.orders === 0) return ["no app orders", "ok"]
  const r = rateShare(l) ?? 0
  if (c.unknownOrders > 0) {
    return [`${plural(c.unknownOrders, "order")} with no fee or rate, counted as nothing`, "bad"]
  }
  if (r === 0) return ["real fees from the apps", "ok"]
  return [`${pctWords(1 - r)} real fees, ${pctWords(r)} estimated from your rates`, r > FEES_ESTIMATED_WARN ? "warn" : "ok"]
}

/** The food line's words and tone: whole, or how much of what sold has no cost behind it. */
function foodHow(l: StatementLines): [string, PlainTone] {
  const gap = foodGapParts(l)
  if (gap.length === 0) return ["recipe cost of what sold", "ok"]
  return [gap[0], l.cogsMissingDays > 0 ? "bad" : "warn"]
}

function lineSet(l: StatementLines, prior: StatementLines | null, how: Record<PlainKey, [string, PlainTone]>): PlainLine[] {
  const now = slices(l)
  const then = prior && prior.grossSales > 0 ? slices(prior) : null
  return (Object.keys(LABEL) as PlainKey[]).map((key) => {
    const s = share(now[key], l.grossSales)
    const p = then && prior ? share(then[key], prior.grossSales) : null
    return {
      key,
      label: LABEL[key],
      amount: now[key],
      share: s,
      changePts: s !== null && p !== null ? (s - p) * 100 : null,
      how: how[key][0],
      tone: how[key][1],
    }
  })
}

function missingByStore(stmt: Statement, names: Map<string, string>): { store: string; days: number }[] {
  return stmt.perStore
    .filter((p) => p.laborMissingDays > 0)
    .map((p) => ({ store: names.get(p.storeId) ?? shortStoreName(p.storeName), days: p.laborMissingDays }))
}

export function buildPlain(input: PlainInput): PnlPlain {
  const { statement: s, prior, files, storeId } = input
  const scopeFiles = storeId === null ? files : files.filter((f) => f.id === storeId)
  const names = new Map(files.map((f) => [f.id, shortStoreName(f.name)]))
  const sales = s.grossSales
  const keptPct = share(s.bottomLine, sales)
  const missing = missingByStore(s, names)
  const nof = fixedNotOnFile(scopeFiles)
  // No store file came back (load failed or empty): unknown, never "all on file".
  const filesKnown = scopeFiles.length > 0
  const est = rateShare(s)
  const unknown = s.commission.unknownOrders
  const uncosted = uncostedShare(s)
  const foodGap = s.cogsMissingDays > 0 || (uncosted !== null && uncosted > 0)
  const estDays = s.laborEstimatedDays

  const { atMost, note: keptNote } = noteFor(
    upperBoundCauses(s, {
      laborMissing:
        missing.length > 0
          ? [list(missing.map((m) => `${plural(m.days, `${m.store} day`)} of labor missing`))]
          : [],
      fixedNotOnFile: filesKnown ? nof.length : null,
    }),
    estimateParts(s),
  )

  // A part-day is never read against a whole one: while the last day is
  // incomplete the prior statement is not compared against at all, and the
  // sales move is the hour-for-hour reading instead.
  const elapsed = input.elapsed ?? null
  const priorOk = elapsed === null && prior !== null && prior.grossSales > 0 && !prior.storeNotFound
  const vsPrior: PnlPlain["vsPrior"] = elapsed
    ? elapsed.current !== null && elapsed.prior !== null && elapsed.prior > 0
      ? {
          label: elapsed.label,
          kept: null,
          pts: null,
          sales: elapsed.current - elapsed.prior,
          salesPrior: elapsed.prior,
          against: elapsed.against,
        }
      : null
    : priorOk && input.priorLabel
      ? {
          label: input.priorLabel,
          kept: s.bottomLine - prior.bottomLine,
          pts:
            keptPct === null ? null : (keptPct - prior.bottomLine / prior.grossSales) * 100,
          sales: sales - prior.grossSales,
          salesPrior: prior.grossSales,
        }
      : null

  /* ── the sentence ── */
  const parts: string[] = []
  if (sales > 0) {
    parts.push(
      `You ${s.bottomLine >= 0 ? "kept" : "lost"} ${cents(Math.abs(keptPct ?? 0))} of every dollar on ${money(sales)} in sales.`,
    )
    if (priorOk) {
      const now = slices(s)
      const then = slices(prior)
      const moved = (["fees", "food", "labor", "fixed"] as PlainKey[])
        .map((k) => ({ k, a: now[k] / sales, b: then[k] / prior.grossSales }))
        .sort((x, y) => Math.abs(y.a - y.b) - Math.abs(x.a - x.b))[0]
      if (moved && Math.abs(moved.a - moved.b) >= 0.005) {
        parts.push(
          `The biggest change from the period before was ${LABEL[moved.k].toLowerCase()}, ${cents(moved.b)} → ${cents(moved.a)} per dollar.`,
        )
      }
    }
    if (storeId === null) {
      const trading = s.perStore.filter((p) => p.grossSales > 500)
      if (trading.length > 1) {
        const low = [...trading].sort((a, b) => a.bottomLine / a.grossSales - b.bottomLine / b.grossSales)[0]
        parts.push(
          `${names.get(low.storeId) ?? shortStoreName(low.storeName)} kept the least, ${cents(low.bottomLine / low.grossSales)}.`,
        )
      }
    }
    if (missing.length > 0) parts.push("Some labor is missing, so the true number is lower.")
    else if (atMost !== null) parts.push("Some costs are not on file, so the true number is lower.")
    if (keptNote !== null && atMost === null) parts.push("Part of it is estimated.")
  }

  /* ── statuses, in words ── */
  const missDays = missing.reduce((a, m) => a + m.days, 0)
  const uncostedText = uncosted !== null && uncosted > 0 ? `Food: ${pctWords(uncosted)} of sales not fully costed` : null
  const estText = estDays > 0 ? `Labor: ${plural(estDays, "day")} estimated from your labor budget` : null
  const statuses: PlainStatus[] = [
    { tone: "ok", text: "Sales: from Otter" },
    s.cogsMissingDays > 0
      ? { tone: "bad", text: `Food: ${plural(s.cogsMissingDays, "store-day")} with no food cost` }
      : uncostedText
        ? { tone: "warn", text: uncostedText }
        : { tone: "ok", text: "Food: from your recipes" },
    ...(s.cogsMissingDays > 0 && uncostedText ? [{ tone: "warn" as const, text: uncostedText }] : []),
    missDays > 0
      ? { tone: "bad", text: `Labor: ${plural(missDays, "store-day")} missing` }
      : estText
        ? { tone: "warn", text: estText }
        : { tone: "ok", text: "Labor: every day from Harri" },
    ...(missDays > 0 && estText ? [{ tone: "warn" as const, text: estText }] : []),
    !filesKnown
      ? { tone: "warn", text: "Fixed costs: store settings did not load" }
      : nof.length > 0
        ? { tone: "warn", text: `Fixed costs: ${nof.length} not on file` }
        : { tone: "ok", text: "Fixed costs: all on file" },
  ]
  if (unknown > 0) {
    statuses.push({ tone: "bad", text: `App fees: ${plural(unknown, "order")} with no fee and no rate on file` })
  }
  if (est !== null) {
    statuses.push(
      est > FEES_ESTIMATED_WARN
        ? { tone: "warn", text: `App fees: ${pctWords(est)} estimated from your rates` }
        : est > 0
          ? { tone: "ok", text: "App fees: mostly from the apps" }
          : { tone: "ok", text: "App fees: from the apps" },
    )
  }

  /* ── Needs you, one group per kind of gap ── */
  const todos: PlainTodo[] = []
  if (missing.length > 0) {
    todos.push({
      tone: "bad",
      title: "Labor is missing",
      items: missing.map(
        (m) =>
          `${m.store}: no Harri labor on ${plural(m.days, "day")} with sales. Those days count no labor, so profit reads high.`,
      ),
      action: { label: "Open Labor", href: "/dashboard/labor" },
    })
  }
  if (foodGap) {
    todos.push({
      tone: s.cogsMissingDays > 0 ? "bad" : "warn",
      title: "Food cost is incomplete",
      items: [
        ...(s.cogsMissingDays > 0
          ? [`${plural(s.cogsMissingDays, "store-day")} sold with no food cost worked out. Those days count no food.`]
          : []),
        ...(uncosted !== null && uncosted > 0
          ? [
              `${pctWords(uncosted)} of sales are items with no recipe or with ingredients that have no price. Their cost counts as nothing or only in part, so profit reads high.`,
            ]
          : []),
      ],
      action: { label: "Open food cost", href: "/dashboard/cogs" },
    })
  }
  if (nof.length > 0) {
    const first = nof[0]
    todos.push({
      tone: "warn",
      title: "Fill in store settings",
      items: [
        `Not on file: ${list(nof.map((n) => `${n.store} ${n.what}`))}.`,
        "Each counts as nothing until it is entered. If a store has no such cost, enter $0 so this stops asking.",
      ],
      action: {
        label: "Open store settings",
        href: new Set(nof.map((n) => n.storeId)).size === 1 ? `/dashboard/stores/${first.storeId}` : "/dashboard/stores",
      },
    })
  }
  const feesEstimated = est !== null && est > FEES_ESTIMATED_WARN
  if (unknown > 0 || feesEstimated) {
    const perStore = s.perStore
      .map((p) => ({ name: names.get(p.storeId) ?? shortStoreName(p.storeName), e: rateShare(p) }))
      .filter((p): p is { name: string; e: number } => p.e !== null)
    todos.push({
      tone: unknown > 0 ? "bad" : "warn",
      title: unknown > 0 ? "App fees are missing" : "App fees are estimated",
      items: [
        ...(unknown > 0
          ? [
              `${plural(unknown, "app order")} came with no fee and no commission rate on file, so they count no fee and profit reads high.`,
            ]
          : []),
        ...(feesEstimated
          ? [`${pctWords(est)} of app orders came without their real fee, so it is estimated from each store's commission rates.`]
          : []),
        ...(perStore.length > 1 && feesEstimated
          ? [perStore.map((p) => `${p.name} ${pctWords(p.e)}`).join(" · ")]
          : []),
      ],
      action: {
        label: "Check commission rates",
        href: storeId ? `/dashboard/stores/${storeId}` : "/dashboard/stores",
      },
    })
  }

  /* ── where each dollar went ── */
  const lines = lineSet(s, priorOk ? prior : null, {
    fees: feesHow(s),
    food: foodHow(s),
    labor: [
      missDays > 0
        ? `${plural(missDays, "day")} missing`
        : estDays > 0
          ? `${plural(estDays, "day")} estimated from your labor budget`
          : "from Harri",
      missDays > 0 ? "bad" : estDays > 0 ? "warn" : "ok",
    ],
    fixed: !filesKnown
      ? ["store settings did not load", "warn"]
      : [nof.length > 0 ? `${nof.length} not on file` : "monthly, charged per day", nof.length > 0 ? "warn" : "ok"],
    kept: [atMost !== null ? "at most" : keptNote !== null ? "estimated" : "what is left", "ok"],
  })

  /* ── the eight weeks ── */
  const weeks: PlainWeek[] =
    input.weeks === null
      ? []
      : input.weekWindows.map((w, i) => {
          const st = input.weeks![i]
          return {
            window: serializeWeekWindow(w),
            label: `${w.start.getUTCMonth() + 1}/${w.start.getUTCDate()}`,
            sales: st?.grossSales ?? 0,
            kept: st?.bottomLine ?? 0,
            keptPct: st ? share(st.bottomLine, st.grossSales) : null,
            // The week's own gaps. A fixed cost not on file is said once, on the headline.
            atMost: st ? upperBoundCauses(st).length > 0 : false,
            running: w.partial,
          }
        })

  /* ── every day ── */
  let days: PlainDay[] | null = null
  const d = input.daily
  if (d && d.periodLines && d.periodLines.length === d.periods.length && d.periods.length <= PLAIN_MAX_DAYS) {
    const storesIn = storeId === null ? d.allStores : d.allStores.filter((p) => p.storeId === storeId)
    days = d.periods.map((p, i) => {
      const l = d.periodLines![i]
      const date = p.startDate.toISOString().slice(0, 10)
      const stores: PlainDayStore[] = storesIn.map((st) => {
        const sl = st.periodLines?.[i]
        return {
          storeId: st.storeId,
          name: names.get(st.storeId) ?? shortStoreName(st.storeName),
          sales: sl?.grossSales ?? 0,
          kept: sl?.bottomLine ?? 0,
          laborMissing: (sl?.laborMissingDays ?? 0) > 0,
        }
      })
      const laborMissing = stores.filter((x) => x.laborMissing).map((x) => x.name)
      const dayCauses = upperBoundCauses(l, {
        laborMissing: laborMissing.length > 0 ? [`no labor for ${list(laborMissing)}`] : [],
        fixedNotOnFile: filesKnown ? nof.length : null,
      })
      return {
        date,
        label: `${WEEKDAY[p.startDate.getUTCDay()]} ${p.startDate.getUTCMonth() + 1}/${p.startDate.getUTCDate()}`,
        short: WEEKDAY[p.startDate.getUTCDay()],
        sales: l.grossSales,
        kept: l.bottomLine,
        keptPct: share(l.bottomLine, l.grossSales),
        atMost: dayCauses.length > 0,
        // Gaps that make THIS day read high against the others. A fixed cost
        // not on file is the same every day, so it does not rule out a best day.
        ownGap:
          laborMissing.length > 0 ||
          l.cogsMissingDays > 0 ||
          (uncostedShare(l) ?? 0) > 0 ||
          l.commission.unknownOrders > 0,
        best: false,
        laborMissing,
        lines: lineSet(l, null, {
          fees: [
            l.commission.orders === 0
              ? "no app orders"
              : `${l.commission.ordersRecorded} of ${l.commission.orders} app orders had a real fee`,
            feesHow(l)[1],
          ],
          food: foodHow(l),
          labor: [
            laborMissing.length > 0
              ? `no Harri labor for ${list(laborMissing)}`
              : l.laborEstimatedDays > 0
                ? "estimated from your labor budget"
                : "from Harri",
            laborMissing.length > 0 ? "bad" : l.laborEstimatedDays > 0 ? "warn" : "ok",
          ],
          fixed: [nof.length > 0 ? `not on file: ${list(nof.map((n) => `${n.store} ${n.what}`))}` : "one day of the month", nof.length > 0 ? "warn" : "ok"],
          kept: [
            dayCauses.length > 0 ? "at most" : estimateParts(l).length > 0 ? "estimated" : "what is left",
            "ok",
          ],
        }),
        stores,
      }
    })
    // A day with a gap of its own cannot be the best one: its kept is high BECAUSE an input is missing.
    const traded = days.filter((x) => x.sales > 0 && !x.ownGap)
    if (traded.length > 1) {
      const best = traded.reduce((a, b) => (b.kept > a.kept ? b : a))
      best.best = true
    }
  }

  /* ── one card per store ── */
  const stores: PlainStore[] =
    storeId !== null
      ? []
      : s.allStores.map((st) => {
          const p = priorOk ? prior.allStores.find((x) => x.storeId === st.storeId) : undefined
          const e = elapsed && elapsed.current !== null ? elapsed.perStore[st.storeId] : undefined
          const eOk = e !== undefined && e.prior > 0
          const file = files.find((f) => f.id === st.storeId)
          const nf = file ? fixedNotOnFile([file]).map((n) => n.what) : []
          const own = upperBoundCauses(st)
          const flags = [
            ...own,
            nf.length > 0 ? `${list(nf)} not on file` : null,
            st.laborEstimatedDays > 0 ? `${plural(st.laborEstimatedDays, "day")} of labor estimated` : null,
          ].filter((x): x is string => x !== null)
          return {
            storeId: st.storeId,
            name: names.get(st.storeId) ?? shortStoreName(st.storeName),
            sales: st.grossSales,
            kept: st.bottomLine,
            keptPct: share(st.bottomLine, st.grossSales),
            keptChange: p && p.grossSales > 0 ? st.bottomLine - p.bottomLine : null,
            salesChange: elapsed
              ? eOk ? e.current - e.prior : null
              : p && p.grossSales > 0 ? st.grossSales - p.grossSales : null,
            salesPrior: elapsed ? (eOk ? e.prior : null) : p && p.grossSales > 0 ? p.grossSales : null,
            laborMissingDays: st.laborMissingDays,
            laborEstimatedDays: st.laborEstimatedDays,
            food: share(st.cogsValue, st.grossSales),
            labor: share(st.laborValue, st.grossSales),
            fees: share(st.commissions, st.grossSales),
            atMost: own.length > 0 || nf.length > 0,
            flags,
          }
        })

  return {
    sales,
    kept: s.bottomLine,
    keptPct,
    atMost,
    keptNote,
    gaps: {
      laborMissingDays: missDays,
      laborEstimatedDays: estDays,
      cogsMissingDays: s.cogsMissingDays,
      uncostedShare: uncosted,
      unknownOrders: unknown,
      rateShare: est,
      fixedNotOnFile: filesKnown ? nof.length : null,
    },
    vsPrior,
    compareNote: elapsed?.note ?? null,
    sentence: parts.join(" "),
    statuses,
    todos,
    lines,
    weeks,
    days,
    stores,
  }
}
