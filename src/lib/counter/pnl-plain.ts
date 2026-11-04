import { shortStoreName } from "@/lib/checks/names"
import { money } from "@/lib/counter/format"
import type { Statement, StatementLines } from "@/lib/counter/statement"
import { serializeWeekWindow, type SerializedWeekWindow, type WeekWindow } from "@/lib/counter/date-range"

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
 * A store-day that sold with no Harri labor (`laborMissingDays`) makes the
 * kept figure an upper bound, so it is marked `atMost` and the page prints
 * "at most". Fixed costs not on the store file and app fees worked out from
 * the store's rates are named in the to-dos. No estimate is invented for any
 * of them (owner, 2026-11-03: "only use real, verifiable numbers").
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
  /** Some labor is missing, so `kept` is an upper bound. */
  atMost: boolean
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
  keptChange: number | null
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
  vsPrior: { label: string; kept: number; pts: number | null; sales: number } | null
  sentence: string
  statuses: PlainStatus[]
  todos: PlainTodo[]
  lines: PlainLine[]
  weeks: PlainWeek[]
  /** Every day of the range, or null when the range is too long to list by day. */
  days: PlainDay[] | null
  stores: PlainStore[]
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

/** Share of marketplace orders whose fee was worked out from the store's rate. */
function estimatedShare(l: StatementLines): number | null {
  const c = l.commission
  return c.orders > 0 ? (c.ordersEstimated + c.unknownOrders) / c.orders : null
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
  const est = estimatedShare(s)

  const atMost =
    missing.length === 0
      ? null
      : `at most · ${list(missing.map((m) => `${plural(m.days, `${m.store} day`)} of labor missing`))}`

  const priorOk = prior !== null && prior.grossSales > 0 && !prior.storeNotFound
  const vsPrior =
    priorOk && input.priorLabel
      ? {
          label: input.priorLabel,
          kept: s.bottomLine - prior.bottomLine,
          pts:
            keptPct === null ? null : (keptPct - prior.bottomLine / prior.grossSales) * 100,
          sales: sales - prior.grossSales,
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
  }

  /* ── statuses, in words ── */
  const missDays = missing.reduce((a, m) => a + m.days, 0)
  const statuses: PlainStatus[] = [
    { tone: "ok", text: "Sales: from Otter" },
    { tone: "ok", text: "Food: from your recipes" },
    missDays > 0
      ? { tone: "bad", text: `Labor: ${plural(missDays, "store-day")} missing` }
      : { tone: "ok", text: "Labor: every day from Harri" },
    nof.length > 0
      ? { tone: "warn", text: `Fixed costs: ${nof.length} not on file` }
      : { tone: "ok", text: "Fixed costs: all on file" },
  ]
  if (est !== null) {
    statuses.push(
      est > 0.5
        ? { tone: "warn", text: `App fees: ${Math.round(est * 100)}% worked out from your rates` }
        : { tone: "ok", text: "App fees: mostly from the apps" },
    )
  }

  /* ── Needs you, three groups at most ── */
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
  if (est !== null && est > 0.5) {
    const perStore = s.perStore
      .map((p) => ({ name: names.get(p.storeId) ?? shortStoreName(p.storeName), e: estimatedShare(p) }))
      .filter((p): p is { name: string; e: number } => p.e !== null)
    todos.push({
      tone: "warn",
      title: "App fees are mostly estimated",
      items: [
        `${Math.round(est * 100)}% of app orders came without their real fee, so it is worked out from each store's commission rates.`,
        ...(perStore.length > 1
          ? [perStore.map((p) => `${p.name} ${Math.round(p.e * 100)}%`).join(" · ")]
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
    fees: [
      est === null ? "no app orders" : `${Math.round((1 - est) * 100)}% real fees, the rest at your rates`,
      est !== null && est > 0.5 ? "warn" : "ok",
    ],
    food: ["recipe cost of what sold", "ok"],
    labor: [missDays > 0 ? `${plural(missDays, "day")} missing` : "from Harri", missDays > 0 ? "bad" : "ok"],
    fixed: [nof.length > 0 ? `${nof.length} not on file` : "monthly, charged per day", nof.length > 0 ? "warn" : "ok"],
    kept: [missDays > 0 ? "at most" : "what is left", "ok"],
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
            atMost: (st?.laborMissingDays ?? 0) > 0,
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
      const dEst = estimatedShare(l)
      return {
        date,
        label: `${WEEKDAY[p.startDate.getUTCDay()]} ${p.startDate.getUTCMonth() + 1}/${p.startDate.getUTCDate()}`,
        short: WEEKDAY[p.startDate.getUTCDay()],
        sales: l.grossSales,
        kept: l.bottomLine,
        keptPct: share(l.bottomLine, l.grossSales),
        atMost: laborMissing.length > 0,
        best: false,
        laborMissing,
        lines: lineSet(l, null, {
          fees: [
            l.commission.orders === 0
              ? "no app orders"
              : `${l.commission.ordersRecorded} of ${l.commission.orders} app orders had a real fee`,
            dEst !== null && dEst > 0.5 ? "warn" : "ok",
          ],
          food: ["recipe cost of what sold", "ok"],
          labor: [
            laborMissing.length > 0 ? `no Harri labor for ${list(laborMissing)}` : "from Harri",
            laborMissing.length > 0 ? "bad" : "ok",
          ],
          fixed: [nof.length > 0 ? `not on file: ${list(nof.map((n) => `${n.store} ${n.what}`))}` : "one day of the month", nof.length > 0 ? "warn" : "ok"],
          kept: [laborMissing.length > 0 ? "at most" : "what is left", "ok"],
        }),
        stores,
      }
    })
    // An "at most" day cannot be the best one: its kept is high BECAUSE labor is missing.
    const traded = days.filter((x) => x.sales > 0 && !x.atMost)
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
          const file = files.find((f) => f.id === st.storeId)
          const nf = file ? fixedNotOnFile([file]).map((n) => n.what) : []
          const flags = [
            st.laborMissingDays > 0 ? `${plural(st.laborMissingDays, "day")} of labor missing` : null,
            nf.length > 0 ? `${list(nf)} not on file` : null,
          ].filter((x): x is string => x !== null)
          return {
            storeId: st.storeId,
            name: names.get(st.storeId) ?? shortStoreName(st.storeName),
            sales: st.grossSales,
            kept: st.bottomLine,
            keptPct: share(st.bottomLine, st.grossSales),
            keptChange: p && p.grossSales > 0 ? st.bottomLine - p.bottomLine : null,
            food: share(st.cogsValue, st.grossSales),
            labor: share(st.laborValue, st.grossSales),
            fees: share(st.commissions, st.grossSales),
            atMost: st.laborMissingDays > 0,
            flags,
          }
        })

  return {
    sales,
    kept: s.bottomLine,
    keptPct,
    atMost,
    vsPrior,
    sentence: parts.join(" "),
    statuses,
    todos,
    lines,
    weeks,
    days,
    stores,
  }
}
