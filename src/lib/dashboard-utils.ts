import { format } from "date-fns"

const LA_TZ = "America/Los_Angeles"

export type DashboardRange =
  | { kind: "days"; days: number }
  | { kind: "custom"; startDate: string; endDate: string }

/** Parse /dashboard URL searchParams into a typed date range. Defaults to days=1. */
export function parseDashboardRange(sp: {
  start?: string
  end?: string
  days?: string
}): DashboardRange {
  if (sp.start && sp.end) {
    return { kind: "custom", startDate: sp.start, endDate: sp.end }
  }
  const parsed = sp.days ? Number.parseInt(sp.days, 10) : 1
  const days = Number.isFinite(parsed) && parsed !== 0 ? parsed : 1
  return { kind: "days", days }
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

/** Get "today" as a YYYY-MM-DD string in LA timezone (works correctly on Vercel/UTC servers). */
export function todayInLA(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: LA_TZ })
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
  if (!lastSyncAt) return "Never synced"
  const date =
    typeof lastSyncAt === "string" ? new Date(lastSyncAt) : lastSyncAt
  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return "Just synced"
  if (diffMin < 60) return `Last synced ${diffMin}m ago`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `Last synced ${diffHours}h ago`
  return `Last synced ${Math.floor(diffHours / 24)}d ago`
}
