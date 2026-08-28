import { format } from "date-fns"

const LA_TZ = "America/Los_Angeles"

export type DashboardRange =
  | { kind: "days"; days: number }
  | { kind: "custom"; startDate: string; endDate: string }

/**
 * Default preset for Overview when the URL carries no range.
 *
 * Yesterday, not today: a day in progress has no complete labor, COGS or
 * payout data, so the first thing a new visitor saw was a partial day that
 * reads as a collapse. Yesterday is the most recent *finished* day and is the
 * only range where every figure on the page is settled.
 */
export const DEFAULT_DASHBOARD_DAYS = -1

/** Parse /dashboard URL searchParams into a typed date range. Defaults to yesterday. */
export function parseDashboardRange(sp: {
  start?: string
  end?: string
  days?: string
}): DashboardRange {
  return parseRangeWithDefault(sp, DEFAULT_DASHBOARD_DAYS)
}

/** Convert a DashboardRange into the options shape every server action expects. */
export function rangeToActionOptions(
  range: DashboardRange
): { days?: number; startDate?: string; endDate?: string } {
  return range.kind === "days"
    ? { days: range.days }
    : { startDate: range.startDate, endDate: range.endDate }
}

/** Parse searchParams with a route-specific default preset (e.g. 7 or 30 days). */
export function parseRangeWithDefault(
  sp: { start?: string; end?: string; days?: string },
  defaultDays: number
): DashboardRange {
  if (sp.start && sp.end) {
    return { kind: "custom", startDate: sp.start, endDate: sp.end }
  }
  const parsed = sp.days ? Number.parseInt(sp.days, 10) : defaultDays
  const days =
    Number.isFinite(parsed) && parsed !== 0 ? parsed : defaultDays
  return { kind: "days", days }
}

/** YYYY-MM-DD `n` days after `dateStr` (negative goes back). LA-naive via UTC noon. */
export function addDaysLA(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00Z")
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Hard ceiling on how many days a range may expand to, so a hand-typed
 *  `?start=1970-01-01` can't turn a pace lookup into an unbounded scan. */
export const MAX_RANGE_DAYS = 400

/**
 * Resolve a DashboardRange into the ascending list of LA calendar dates it
 * covers. Mirrors exactly how `getDashboardAnalytics` / `getOtterAnalytics` /
 * `buildPnLSummary` widen the same range (days=1 → today, days=-1 → yesterday
 * only, days=N → the N+1 days ending today), so anything derived from this
 * list lines up with the figures on screen instead of drifting a day.
 */
export function resolveRangeDates(
  range: DashboardRange,
  today: string = todayInLA()
): string[] {
  let start: string
  let end: string

  if (range.kind === "custom") {
    start = range.startDate
    end = range.endDate
  } else if (range.days === 1) {
    start = end = today
  } else if (range.days === -1) {
    start = end = addDaysLA(today, -1)
  } else {
    start = addDaysLA(today, -range.days)
    end = today
  }

  if (end < start) [start, end] = [end, start]

  const dates: string[] = []
  for (let d = start; d <= end && dates.length < MAX_RANGE_DAYS; d = addDaysLA(d, 1)) {
    dates.push(d)
  }
  return dates
}

/** Get "today" as a YYYY-MM-DD string in LA timezone (works correctly on Vercel/UTC servers). */
export function todayInLA(): string {
  return laDateOf(new Date())
}

/**
 * The LA calendar date a given instant falls on, `yyyy-MM-dd`.
 *
 * Split out of `todayInLA` so a caller that already has a `now` — the chat's
 * system prompt builder, whose `now` is injectable so the eval can freeze it —
 * can name the business day without reaching for the wall clock itself.
 *
 * `toISOString().slice(0, 10)` is the trap this replaces: at 17:34 PDT on
 * 27 August it returns `2026-08-28`, so anything using it to mean "today"
 * names tomorrow for the last seven hours of every LA day.
 */
export function laDateOf(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: LA_TZ })
}

/** Get a Date for start-of-day of a given LA-local date (defaults to today in LA). */
export function startOfDayLA(dateStr?: string): Date {
  const d = dateStr ?? todayInLA()
  return new Date(d + "T00:00:00.000Z")
}

/** Get a Date for end-of-day of a given LA-local date (defaults to today in LA). */
export function endOfDayLA(dateStr?: string): Date {
  const d = dateStr ?? todayInLA()
  return new Date(d + "T23:59:59.999Z")
}

/** Format a Date as yyyy-MM-dd using local calendar date (avoids UTC day rollover). */
export function localDateStr(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

export function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate + "T00:00:00")
  const end = new Date(endDate + "T00:00:00")
  if (startDate === endDate) {
    return format(start, "MMM d, yyyy")
  }
  if (start.getFullYear() === end.getFullYear()) {
    return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`
  }
  return `${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`
}

export function getLastSyncText(lastSyncAt: Date | string | null | undefined): string {
  if (!lastSyncAt) return "Awaiting first sync"
  const date =
    typeof lastSyncAt === "string" ? new Date(lastSyncAt) : lastSyncAt
  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return "Just synced"
  if (diffMin < 60) return `Synced ${diffMin}m ago`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `Synced ${diffHours}h ago`
  return `Synced ${Math.floor(diffHours / 24)}d ago`
}

export function getRangeStamp(range: DashboardRange): string {
  if (range.kind === "custom") {
    return formatDateRange(range.startDate, range.endDate).toUpperCase()
  }
  const d = range.days
  if (d === 1) return "TODAY"
  if (d === -1) return "YDAY"
  if (d > 1) return `LAST ${d}D`
  return `${d}D`
}
