import { BUSINESS_TIME_ZONE, businessDay } from "@/lib/counter/business-date"

/**
 * Wall-clock arithmetic for store checks, in America/Los_Angeles.
 *
 * A check's window is stored as minutes after LA midnight of its business
 * day (`opensAtMin`, `dueAtMin`), so "due 4:00 pm" survives a DST change
 * without anyone editing it. `dueAtMin` may pass 1440: an evening check due
 * at 12:30 am still belongs to the day its window opened.
 *
 * Everything here is pure, so the window rules are tested without a clock.
 */

export type CheckKindName = "MORNING" | "TRANSITION" | "EVENING"

export const CHECK_KINDS: readonly CheckKindName[] = ["MORNING", "TRANSITION", "EVENING"]

export const CHECK_LABEL: Record<CheckKindName, { en: string; es: string }> = {
  MORNING: { en: "Morning", es: "Mañana" },
  TRANSITION: { en: "Transition", es: "Cambio de turno" },
  EVENING: { en: "Evening", es: "Noche" },
}

export type CheckWindow = {
  opensAtMin: number
  dueAtMin: number
  graceMin: number
  /**
   * Due time per weekday, Sunday first, in the same minutes as `dueAtMin`.
   * Empty means every day uses `dueAtMin`. The weekday is the business day
   * the window opens on, so "Friday, due 2:00 am" is Friday night's close.
   */
  dueByWeekday?: readonly number[]
}

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const

/** 0 = Sunday, for a business day "YYYY-MM-DD". */
export function weekdayOf(day: string): number {
  return new Date(`${day}T12:00:00.000Z`).getUTCDay()
}

/** The due minute that applies on `day`, after any weekday override. */
export function dueAtFor(day: string, w: CheckWindow): number {
  const byDay = w.dueByWeekday
  return byDay && byDay.length === 7 ? byDay[weekdayOf(day)] : w.dueAtMin
}

/**
 * "10:00 pm – 1:00 am", or with weekday overrides
 * "10:00 pm – 1:00 am · 2:00 am Fri, Sat, Sun".
 */
export function windowSummary(w: CheckWindow): string {
  const base = `${minutesLabel(w.opensAtMin)} – ${minutesLabel(w.dueAtMin)}`
  const byDay = w.dueByWeekday
  if (!byDay || byDay.length !== 7) return base
  const groups = new Map<number, string[]>()
  // Monday first reads naturally for a week of closes.
  for (const d of [1, 2, 3, 4, 5, 6, 0]) {
    if (byDay[d] === w.dueAtMin) continue
    groups.set(byDay[d], [...(groups.get(byDay[d]) ?? []), WEEKDAY_SHORT[d]])
  }
  if (groups.size === 0) return base
  return [base, ...[...groups].map(([min, days]) => `${minutesLabel(min)} ${days.join(", ")}`)].join(" · ")
}

const offsetFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
})

/** LA's offset from UTC at `instant`, in minutes (-420 or -480). */
function laOffsetMin(instant: number): number {
  const parts = offsetFmt.formatToParts(new Date(instant))
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value)
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"))
  return Math.round((asUtc - instant) / 60_000)
}

/**
 * The instant at `minutes` past LA midnight of business day `day`
 * ("YYYY-MM-DD"). Minutes may exceed 1440.
 */
export function laInstant(day: string, minutes: number): Date {
  const [y, m, d] = day.split("-").map(Number)
  const naive = Date.UTC(y, m - 1, d, 0, minutes)
  let instant = naive - laOffsetMin(naive) * 60_000
  // A second pass settles the hour either side of a DST change.
  instant = naive - laOffsetMin(instant) * 60_000
  return new Date(instant)
}

/** "YYYY-MM-DD" shifted by `delta` days. */
export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + delta))
  return t.toISOString().slice(0, 10)
}

/** The @db.Date encoding of a business day. */
export function dayToDb(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`)
}

export function dbToDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function todayLA(now: Date): string {
  return businessDay(now)
}

export type WindowBounds = { opens: Date; due: Date; closes: Date }

export function windowBounds(day: string, w: CheckWindow): WindowBounds {
  const dueAtMin = dueAtFor(day, w)
  return {
    opens: laInstant(day, w.opensAtMin),
    due: laInstant(day, dueAtMin),
    closes: laInstant(day, dueAtMin + w.graceMin),
  }
}

/**
 * Where `now` sits against one day's window:
 *   upcoming  before it opens
 *   open      open, not yet due
 *   late      past due, inside the grace period — still takes a submission
 *   closed    past due plus grace
 */
export type WindowPhase = "upcoming" | "open" | "late" | "closed"

export function windowPhase(day: string, w: CheckWindow, now: Date): WindowPhase {
  const b = windowBounds(day, w)
  const t = now.getTime()
  if (t < b.opens.getTime()) return "upcoming"
  if (t <= b.due.getTime()) return "open"
  if (t <= b.closes.getTime()) return "late"
  return "closed"
}

/**
 * Minutes a submission at `at` is late, 0 when on time. Rounded up, so a
 * check in 20 seconds after the due minute says "late, 1 min" rather than
 * "late, 0 min".
 */
export function lateMinutes(day: string, w: CheckWindow, at: Date): number {
  const due = windowBounds(day, w).due.getTime()
  const over = at.getTime() - due
  return over <= 0 ? 0 : Math.ceil(over / 60_000)
}

/**
 * The business day whose window for `w` is taking submissions at `now`, if
 * any. Yesterday is checked first: an evening window open past midnight
 * belongs to the day it started on.
 */
export function acceptingDay(w: CheckWindow, now: Date): string | null {
  const today = todayLA(now)
  for (const day of [addDays(today, -1), today]) {
    const phase = windowPhase(day, w, now)
    if (phase === "open" || phase === "late") return day
  }
  return null
}

/** "9:41 am" in LA. */
export function clockLabel(instant: Date): string {
  return instant
    .toLocaleTimeString("en-US", { timeZone: BUSINESS_TIME_ZONE, hour: "numeric", minute: "2-digit" })
    .replace(" AM", " am")
    .replace(" PM", " pm")
}

/** "4:00 pm" from minutes past midnight, wrapping past 1440. */
export function minutesLabel(min: number): string {
  const m = ((min % 1440) + 1440) % 1440
  const h24 = Math.floor(m / 60)
  const mm = m % 60
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(mm).padStart(2, "0")} ${h24 < 12 ? "am" : "pm"}`
}

/** "1 hr 29 min" / "12 min". */
export function durationLabel(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60_000))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`
}

/** "Sun Oct 25" for a business day. */
export function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00.000Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).replace(",", "")
}
