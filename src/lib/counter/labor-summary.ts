import { money, pct, plural, points } from "@/lib/counter/format"
import { hoursText } from "@/lib/counter/schedule-hold"
// TYPES ONLY from `labor-week`: that module reads the database, and this one
// is also imported by the page's client view (`compareLaborWeeks`).
import type { LaborDay, LaborRole, LaborStoreShare, LaborTrendWeek, LaborWeek } from "@/lib/counter/labor-week"

/**
 * The Labor page's detail, brought out of the fold (owner's go, 2026-11-20,
 * mock https://claude.ai/artifact/VVoyXKUEykrCL6MK5K78ms): each day's share,
 * the stores side by side, what the cost is made of, and the weeks as sales
 * against labor with any two set next to each other.
 *
 * Nothing here is computed afresh. Every figure is a field of `LaborDay`,
 * `LaborWeek`, `LaborRole`, `LaborStoreShare` or `LaborTrendWeek`, the same
 * ones the sentence and the folded sections print. This file words them and
 * sizes the bars.
 *
 * ## No target, on purpose
 *
 * No labor target is on file anywhere (`targets.ts` keeps `labor: null`), so
 * no day or week is graded. The mark on each day's bar is the range's OWN
 * share, named as that, and a bar is never tinted as good or bad news.
 *
 * ## Missing is not zero
 *
 * A day or week that sold with no labor from Harri is drawn hatched and says
 * "missing". Its share is taken on the sales of the days that have labor
 * (`ratedSales`), which is `laborDay`'s own rule.
 */

/** Days drawn at most; a longer range shows its last ones and says so. */
export const LABOR_DAYS_SHOWN = 14

/** Role rows drawn before the rest are summed into one line. */
const ROLES_SHOWN = 6

/** The day bars never scale tighter than this share, so a calm week does not look alarming. */
const DAY_SCALE_FLOOR = 40

export type LaborTone = "good" | "warn" | "bad"

export interface LaborDayBar {
  key: string
  /** "Mon" */
  dow: string
  /** "Nov 9" */
  date: string
  /** "32.0%", or "missing" / "no sales". */
  share: string
  /** 0..100 of the track; 0 with no share. */
  fill: number
  /** Sold, with no labor from Harri for at least one store. */
  missing: boolean
  /** Harri has not finalised this day yet. */
  provisional: boolean
  /** "$2,050 on $6,400 · 112 h" */
  detail: string
  aria: string
}

export interface LaborStoreCard {
  storeId: string
  name: string
  status: { tone: LaborTone; label: string }
  figures: Array<{ label: string; value: string }>
}

export interface LaborRoleBar {
  key: string
  label: string
  /** 0..100 against the largest role. */
  fill: number
  cost: string
  detail: string
}

export interface LaborSummary {
  days: LaborDayBar[]
  /** Where the range's own share sits on the day track, 0..100; null with no share. */
  dayMark: number | null
  /** "27.4%", the share the mark stands for. */
  dayMarkLabel: string | null
  dayNote: string
  /** Empty on one store's page. */
  stores: LaborStoreCard[]
  roles: LaborRoleBar[]
  rolesNote: string | null
}

const DOW = new Intl.DateTimeFormat("en-US", { weekday: "short" })
const MONTH_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })

/** `YYYY-MM-DD` as a LOCAL date: a day key is a calendar day, never a UTC instant. */
function localDay(key: string): Date {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export function buildLaborSummary(input: {
  days: LaborDay[]
  week: LaborWeek
  roles: LaborRole[]
  storeShares: LaborStoreShare[]
  /** Stores whose labor reads too low to be whole, by `incompleteLaborStores`: the adapter's call, not this file's. */
  incompleteStoreIds?: string[]
}): LaborSummary {
  const { week, roles, storeShares } = input
  const days = input.days.slice(-LABOR_DAYS_SHOWN)
  const provisional = new Set(week.provisionalDays)
  const incompleteIds = new Set(input.incompleteStoreIds ?? [])

  const shares = days.map((d) => d.laborPct).filter((v): v is number => v !== null && Number.isFinite(v))
  const top = Math.max(DAY_SCALE_FLOOR, ...shares, week.laborPct ?? 0) * 1.05
  const at = (v: number) => Math.max(0, Math.min(100, (v / top) * 100))

  const bars: LaborDayBar[] = days.map((d) => {
    const date = localDay(d.key)
    const sold = d.totalSales !== null && d.totalSales > 0
    // A day that sold and has no labor at all has nothing to draw; a day
    // short of one store still has a share, on the stores that reported.
    const noLabor = d.costMissing && d.cost === 0
    const share = noLabor ? "missing" : d.laborPct === null ? (sold ? "missing" : "no sales") : pct(d.laborPct, { scaled: true })
    const parts: string[] = []
    if (noLabor) {
      parts.push(`sold ${money(d.totalSales)}`, "no labor from Harri")
    } else {
      parts.push(d.totalSales === null ? money(d.cost) : `${money(d.cost)} on ${money(d.ratedSales ?? d.totalSales)}`)
      if (d.actualHours > 0) parts.push(hoursText(d.actualHours, 0))
      if (d.costMissing) parts.push(`${plural(d.missingStoreDays, "store")} missing`)
    }
    const detail = parts.join(" · ")
    return {
      key: d.key,
      dow: DOW.format(date),
      date: MONTH_DAY.format(date),
      share,
      fill: noLabor || d.laborPct === null ? 0 : at(d.laborPct),
      missing: d.costMissing,
      provisional: provisional.has(d.label),
      detail,
      aria: `${d.label}: labor ${share}, ${detail}`,
    }
  })

  const cut = input.days.length - days.length
  const notes: string[] = []
  if (week.laborPct !== null) {
    notes.push(`The line on each bar is this range's own share, ${pct(week.laborPct, { scaled: true })}. No labor target is on file, so no day is graded.`)
  }
  if (cut > 0) notes.push(`Showing the last ${days.length} days of the range.`)
  if (bars.some((b) => b.provisional)) notes.push("Days marked so far can still move: Harri settles a day about two days later.")

  // One store's page has one share and it is the headline; cards are for comparing.
  const stores: LaborStoreCard[] =
    storeShares.length < 2
      ? []
      : storeShares.map((s) => {
          const incomplete = incompleteIds.has(s.storeId)
          const none = s.laborPct === null || (s.cost === 0 && s.ratedSales === 0)
          return {
            storeId: s.storeId,
            name: s.name,
            status: none
              ? { tone: "warn" as const, label: "No labor on file" }
              : incomplete
              ? { tone: "warn" as const, label: "Labor looks incomplete" }
              : { tone: "good" as const, label: "Labor on file" },
            figures: [
              { label: incomplete ? "Share on file" : "Share of sales", value: none ? "missing" : pct(s.laborPct, { scaled: true }) },
              { label: "Labor cost", value: none ? "missing" : money(s.cost) },
              // With no labor day there are no "those days": $0 here would read as a store that sold nothing.
              ...(none ? [] : [{ label: "Sales on those days", value: money(s.ratedSales) }]),
            ],
          }
        })

  const ranked = [...roles].filter((r) => r.cost > 0 || r.hours > 0).sort((a, b) => b.cost - a.cost)
  const shown = ranked.slice(0, ROLES_SHOWN)
  const rest = ranked.slice(ROLES_SHOWN)
  const topCost = Math.max(1, ...shown.map((r) => r.cost))
  const roleBars: LaborRoleBar[] = shown.map((r) => ({
    key: `${r.position}|${r.payType}`,
    label: r.position,
    fill: Math.max(0, Math.min(100, (r.cost / topCost) * 100)),
    cost: money(r.cost),
    detail: `${hoursText(r.hours, 0)} · ${pct(r.share, { scaled: true })}`,
  }))
  const roleNotes: string[] = []
  if (rest.length > 0) {
    roleNotes.push(
      `${plural(rest.length, "more role")} add ${money(rest.reduce((t, r) => t + r.cost, 0))}; every role is in the full list below.`,
    )
  }
  if (week.overtimeCost > 0) roleNotes.push(`Overtime paid: ${money(week.overtimeCost)}. Harri sends overtime in dollars, not hours.`)

  return {
    days: bars,
    dayMark: week.laborPct === null ? null : at(week.laborPct),
    dayMarkLabel: week.laborPct === null ? null : pct(week.laborPct, { scaled: true }),
    dayNote: notes.join(" "),
    stores,
    roles: roleBars,
    rolesNote: roleNotes.length > 0 ? roleNotes.join(" ") : null,
  }
}

/* ── The weeks: sales against labor, and any two side by side ─────────── */

export interface LaborWeekCell {
  /** Monday, `YYYY-MM-DD`. */
  key: string
  /** Last day of the week inside the data, `YYYY-MM-DD`. */
  end: string
  /** "11/9"; "so far" on the week still running; "part" on a past week the range cuts short. */
  label: string
  /** "Week of Nov 9", for the pickers and screen readers. */
  name: string
  /** Fewer than seven days: still running, or cut short by the range. */
  running: boolean
  /** "so far" or "part week"; empty on a whole week. */
  partWord: string
  missing: boolean
  selected: boolean
  sales: number | null
  cost: number
  hours: number
  laborPct: number | null
  splh: number | null
  /** Printed over the bar: the share, or "missing". */
  top: string
  /** Sales bar height, 0..100 against the tallest week. */
  salesFill: number
  /** Labor's part of the sales bar, 0..100 of the bar. */
  laborFill: number
  aria: string
}

export interface LaborWeeksView {
  weeks: LaborWeekCell[]
  sentence: string
  /** The two weeks the comparison opens on: the newest whole week and the one before. Keys, or null. */
  compare: { a: string; b: string } | null
}

/**
 * The trend's weeks as cells. `rangeStart`/`rangeEnd` are day keys of the
 * range on screen; a week is `selected` only when the range is exactly it.
 */
export function buildLaborWeeks(
  weeks: LaborTrendWeek[],
  rangeStart: string,
  rangeEnd: string,
  /** The reader's day, `YYYY-MM-DD`. A part week ending before it is over, not "so far". */
  todayKey: string = rangeEnd,
): LaborWeeksView {
  const topSales = Math.max(1, ...weeks.map((w) => w.sales ?? 0))
  const cells: LaborWeekCell[] = weeks.map((w) => {
    const missing = w.missingStoreDays > 0
    const noLabor = w.cost === 0 && w.hours === 0
    const share = noLabor || w.laborPct === null ? (w.sales ? "missing" : "") : pct(w.laborPct, { scaled: true })
    const name = `Week of ${MONTH_DAY.format(localDay(w.key))}`
    const bits = [
      w.sales === null ? "no sales on file" : `sold ${money(w.sales)}`,
      noLabor
        ? "no labor on file"
        : w.laborPct === null
        ? `labor ${money(w.cost)}`
        : `labor ${money(w.cost)}, ${share} of sales${missing ? " on the days with labor" : ""}`,
    ]
    if (missing) bits.push(`labor missing on ${plural(w.missingStoreDays, "store-day")}`)
    const partWord = !w.isPartial ? "" : w.end >= todayKey ? "so far" : "part week"
    if (w.isPartial) bits.push(partWord === "so far" ? "week still running" : "not a whole week")
    return {
      key: w.key,
      end: w.end,
      label: partWord === "so far" ? "so far" : partWord ? "part" : w.label,
      name,
      running: w.isPartial,
      partWord,
      missing: missing || (noLabor && (w.sales ?? 0) > 0),
      selected: w.key === rangeStart && w.end === rangeEnd,
      sales: w.sales,
      cost: w.cost,
      hours: w.hours,
      laborPct: noLabor ? null : w.laborPct,
      splh: w.splh,
      top: share,
      salesFill: w.sales === null ? 0 : Math.max(0, (w.sales / topSales) * 100),
      laborFill: w.sales && w.sales > 0 ? Math.max(0, Math.min(100, (w.cost / w.sales) * 100)) : 0,
      aria: `${name}: ${bits.join(", ")}`,
    }
  })

  const whole = cells.filter((c) => !c.running && c.laborPct !== null)
  const a = cells.find((c) => c.selected && c.laborPct !== null) ?? whole[whole.length - 1] ?? null
  const before = a === null ? [] : whole.filter((c) => c.key < a.key)
  const b = before[before.length - 1] ?? null

  let sentence: string
  if (whole.length === 0) {
    sentence = "No whole week here has both sales and labor on file yet."
  } else {
    const lo = whole.reduce((m, c) => ((c.laborPct as number) < (m.laborPct as number) ? c : m))
    const hi = whole.reduce((m, c) => ((c.laborPct as number) > (m.laborPct as number) ? c : m))
    sentence =
      whole.length === 1
        ? `One whole week has a reading: the ${lc(whole[0].name)}, labor ${whole[0].top} of sales.`
        : `Over ${plural(whole.length, "whole week")}, labor ran from ${lo.top} of sales (the ${lc(lo.name)}) to ${hi.top} (the ${lc(hi.name)}).`
    const short = cells.filter((c) => c.missing).length
    if (short > 0) sentence += ` ${plural(short, "week is", "weeks are")} hatched: labor is missing for part of ${short === 1 ? "it" : "them"}, so the labor shown is short and the share is on the days with labor.`
  }

  return { weeks: cells, sentence, compare: a !== null && b !== null ? { a: a.key, b: b.key } : null }
}

export interface LaborCompareRow {
  key: string
  label: string
  a: string
  b: string
  /** "▲ $1,200", "▼ 1.1 pts", "flat", or "" when either side is missing. */
  change: string
  /** Whether the move is the good direction, the bad one, or neither. */
  tone: "up" | "down" | "flat"
}

/** "Week of Nov 9" inside a sentence. */
const lc = (name: string) => name.replace(/^Week/, "week")

const moneyMove = (d: number) => (Math.round(d) === 0 ? "flat" : `${d > 0 ? "▲" : "▼"} ${money(Math.abs(d))}`)

/**
 * Week `a` set against week `b`, line by line. A missing side leaves the
 * change blank rather than reading the gap as a move.
 */
export function compareLaborWeeks(a: LaborWeekCell, b: LaborWeekCell): LaborCompareRow[] {
  const laborOk = a.laborPct !== null && b.laborPct !== null
  const both = <T,>(x: T | null, y: T | null): x is T => x !== null && y !== null
  const salesMove = both(a.sales, b.sales) ? a.sales - (b.sales as number) : null
  const costMove = laborOk ? a.cost - b.cost : null
  const shareMove = laborOk ? (a.laborPct as number) - (b.laborPct as number) : null
  const hoursMove = laborOk ? a.hours - b.hours : null
  const splhMove = both(a.splh, b.splh) ? a.splh - (b.splh as number) : null
  const tone = (d: number | null, goodWhenUp: boolean): LaborCompareRow["tone"] =>
    d === null || Math.abs(d) < 0.05 ? "flat" : d > 0 === goodWhenUp ? "up" : "down"
  const missing = (c: LaborWeekCell) => (c.laborPct === null ? "missing" : null)

  return [
    {
      key: "sales",
      label: "Sales",
      a: a.sales === null ? "missing" : money(a.sales),
      b: b.sales === null ? "missing" : money(b.sales),
      change: salesMove === null ? "" : moneyMove(salesMove),
      tone: tone(salesMove, true),
    },
    {
      key: "cost",
      label: "Labor cost",
      a: missing(a) ?? money(a.cost),
      b: missing(b) ?? money(b.cost),
      change: costMove === null ? "" : moneyMove(costMove),
      // More or less labor is not good or bad on its own; the share is.
      tone: "flat",
    },
    {
      key: "share",
      label: "Labor, share of sales",
      a: missing(a) ?? pct(a.laborPct, { scaled: true }),
      b: missing(b) ?? pct(b.laborPct, { scaled: true }),
      change: shareMove === null ? "" : points(shareMove),
      tone: tone(shareMove, false),
    },
    {
      key: "hours",
      label: "Hours worked",
      a: missing(a) ?? hoursText(a.hours, 0),
      b: missing(b) ?? hoursText(b.hours, 0),
      change: hoursMove === null ? "" : Math.round(hoursMove) === 0 ? "flat" : `${hoursMove > 0 ? "▲" : "▼"} ${hoursText(Math.abs(hoursMove), 0)}`,
      tone: "flat",
    },
    {
      key: "splh",
      label: "Sales per labor hour",
      a: a.splh === null ? "missing" : money(a.splh, { cents: true }),
      b: b.splh === null ? "missing" : money(b.splh, { cents: true }),
      change: splhMove === null ? "" : Math.abs(splhMove) < 0.005 ? "flat" : `${splhMove > 0 ? "▲" : "▼"} ${money(Math.abs(splhMove), { cents: true })}`,
      tone: tone(splhMove, true),
    },
  ]
}
