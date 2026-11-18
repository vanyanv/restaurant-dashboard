import type { PnlPlain, PlainWeek } from "@/lib/counter/pnl-plain"
import { money, plural } from "@/lib/counter/format"
import { alertGroupWords, countByTarget } from "@/lib/counter/alert-groups"

/**
 * The Overview "made plain" (owner's go, 2026-11-18; mock
 * https://claude.ai/artifact/8ZrnRsGAYWc2WV6tg6wb5D): one sentence that says
 * how the period went, the sales figure with the period before, the kept
 * figure, status in words, one card per store and Needs you in a few groups.
 *
 * It computes no money of its own. Sales, kept, "at most", the eight weeks
 * and every store's sales and labor come from the P&L's own reading
 * (`buildPlain` in `pnl-plain.ts`), so the Overview and the P&L can never
 * print two different numbers for one week. Orders come from the Overview's
 * store cards (the channel mix), and the alert groups from the alert inbox.
 */

export type OverviewTone = "good" | "warn" | "bad"

export interface OverviewStatus {
  tone: OverviewTone
  text: string
}

export interface OverviewStore {
  storeId: string
  name: string
  sales: number
  /** Sales change against the period before, as a fraction; null with no earlier sales. */
  salesChangePct: number | null
  /** Null when the orders did not load: unknown, never 0. */
  orders: number | null
  /** Labor as a share of sales; null when any labor is missing, so it is never read low. */
  laborPct: number | null
  laborMissingDays: number
}

export interface OverviewNeed {
  key: string
  tone: Exclude<OverviewTone, "good">
  what: string
  why: string | null
  action: { label: string; href: string }
}

export interface OverviewPlain {
  sentence: string
  sales: number
  /** Against the period before; null when there is none to compare. */
  salesVs: { amount: number; pct: number | null; label: string } | null
  kept: number
  keptPct: number | null
  /** "at most · 2 Glendale days of labor missing", or null when nothing is missing. */
  keptAtMost: string | null
  weeks: PlainWeek[]
  statuses: OverviewStatus[]
  stores: OverviewStore[]
  needs: OverviewNeed[]
}

/** An open alert, as much of it as the grouping reads. */
export interface OverviewAlert {
  target: string
  storeId: string
}

export interface OverviewPlainInput {
  pnl: PnlPlain
  /** The single store's name when the page is scoped to one. */
  storeName: string | null
  /** Orders per store id, or null when they did not load. */
  orders: Record<string, number> | null
  /** Open alerts as loaded (the inbox returns the newest 100), and how many are open in all. Null when the inbox did not load. */
  alerts: { rows: OverviewAlert[]; open: number } | null
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]
const inWords = (n: number) => WORDS[n] ?? String(n)

const share = (part: number, whole: number) => (whole > 0 ? part / whole : null)
const pctWords = (v: number) => `${(Math.abs(v) * 100).toFixed(1).replace(/\.0$/, "")}%`

export function buildOverviewPlain(input: OverviewPlainInput): OverviewPlain {
  const { pnl: p } = input
  const v = p.vsPrior
  const salesVs = v ? { amount: v.sales, pct: share(v.sales, p.sales - v.sales), label: v.label } : null

  /* ── one card per store, from the P&L's own store reading ── */
  const stores: OverviewStore[] = p.stores.map((s) => ({
    storeId: s.storeId,
    name: s.name,
    sales: s.sales,
    salesChangePct: s.salesChange === null ? null : share(s.salesChange, s.sales - s.salesChange),
    // A store the mix has no reading for is unknown, not zero orders.
    orders: input.orders && Object.hasOwn(input.orders, s.storeId) ? input.orders[s.storeId] : null,
    laborPct: s.laborMissingDays > 0 ? null : s.labor,
    laborMissingDays: s.laborMissingDays,
  }))

  /* ── the sentence ── */
  const parts: string[] = []
  if (p.sales <= 0) {
    parts.push("No sales came in for this period yet.")
  } else {
    // Counted from the stores that sold, which are the cards under it.
    const selling = stores.filter((s) => s.sales > 0).length
    const who =
      input.storeName ??
      (selling === 1 ? "Your store" : selling > 1 ? `Your ${inWords(selling)} stores` : "Your stores")
    const change = salesVs
      ? `, ${salesVs.amount >= 0 ? "up" : "down"} ${money(Math.abs(salesVs.amount))}${
          salesVs.pct === null ? "" : ` (${pctWords(salesVs.pct)})`
        } on ${salesVs.label},`
      : ""
    const kept =
      p.kept >= 0
        ? `kept ${p.atMost ? "at most " : ""}${money(p.kept)}`
        : `lost ${money(Math.abs(p.kept))}`
    parts.push(`${who} sold ${money(p.sales)}${change} and ${kept} after app fees, food, labor and rent.`)

    const compared = stores.filter((s) => s.salesChangePct !== null)
    const slipped = compared.filter((s) => (s.salesChangePct ?? 0) < 0)
    const grew = compared.filter((s) => (s.salesChangePct ?? 0) > 0)
    if (compared.length > 1 && salesVs) {
      if (slipped.length === 1) parts.push(`${slipped[0].name} was the one store that sold less.`)
      else if (slipped.length === 0) parts.push(grew.length === compared.length ? "Every store sold more." : "No store sold less.")
      else if (slipped.length < compared.length) parts.push(`${listNames(slipped.map((s) => s.name))} sold less.`)
      else parts.push("Every store sold less.")
    }
    if (p.atMost) parts.push("Some labor is missing, so the true kept figure is lower.")
  }

  /* ── status in words ── */
  const statuses: OverviewStatus[] = []
  if (salesVs && p.sales > 0) {
    statuses.push(
      salesVs.amount >= 0
        ? { tone: "good", text: `Sales up on ${salesVs.label}` }
        : { tone: "bad", text: `Sales down on ${salesVs.label}` },
    )
  }
  for (const s of stores) {
    if (s.laborMissingDays > 0) statuses.push({ tone: "warn", text: `${s.name} labor missing ${plural(s.laborMissingDays, "day")}` })
  }
  if (stores.length === 0 && p.atMost) statuses.push({ tone: "warn", text: "Some labor missing" })
  for (const st of p.statuses) {
    // Labor is said per store above; the P&L's other cost inputs carry over as they are.
    if (st.tone !== "ok" && !st.text.startsWith("Labor")) {
      statuses.push({ tone: st.tone === "bad" ? "bad" : "warn", text: st.text })
    }
  }
  if (statuses.every((s) => s.tone === "good") && p.sales > 0) statuses.push({ tone: "good", text: "Every cost on file" })

  /* ── Needs you, a few groups ── */
  const needs: OverviewNeed[] = p.todos.map((t, i) => ({
    key: `pnl-${i}`,
    tone: t.tone,
    what: t.title,
    why: t.items.join(" "),
    action: t.action,
  }))
  if (input.alerts === null) {
    // Never an empty Needs you that reads as all clear.
    needs.push({
      key: "alerts-unread",
      tone: "warn",
      what: "Alerts did not load",
      why: "Open the alerts page to see what is waiting.",
      action: { label: "Open alerts", href: "/dashboard/alerts" },
    })
  } else if (input.alerts.rows.length > 0) {
    const groups = countByTarget(input.alerts.rows)
    const partial = input.alerts.open > input.alerts.rows.length
    groups.forEach(([target, n]) => {
      const g = alertGroupWords(target)
      needs.push({
        key: `alerts-${target}`,
        tone: "warn",
        what: `${n} ${n === 1 ? g.one : g.many}`,
        // The inbox loads the most serious first, so a partial page is said on every group.
        why: partial
          ? `Counted from the ${input.alerts!.rows.length} most serious of ${input.alerts!.open} open alerts.`
          : null,
        action: { label: g.label, href: "/dashboard/alerts" },
      })
    })
  }

  return {
    sentence: parts.join(" "),
    sales: p.sales,
    salesVs,
    kept: p.kept,
    keptPct: p.keptPct,
    keptAtMost: p.atMost,
    weeks: p.weeks,
    statuses,
    stores,
    needs,
  }
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("")
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}
