/** All current stores trade on the Los Angeles calendar, including DST. */
export const BUSINESS_TIME_ZONE = "America/Los_Angeles"

const calendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric", month: "2-digit", day: "2-digit",
})

/** An instant's business date. Safe to carry across the server/client boundary. */
export function businessDay(instant: Date): string {
  const parts = calendar.formatToParts(instant)
  const part = (type: string) => parts.find((p) => p.type === type)!.value
  return `${part("year")}-${part("month")}-${part("day")}`
}

/**
 * A date-only value for Counter's local-field calendar arithmetic. This is
 * not an instant: reconstruct it in each runtime, never serialize it as today.
 * Query bounds continue encoding these calendar fields for @db.Date and
 * referenceTimeLocal columns, which already store the restaurant's date.
 */
export function businessCalendarDate(instant: Date): Date {
  const [year, month, day] = businessDay(instant).split("-").map(Number)
  return new Date(year, month - 1, day)
}

/** The current business day in the encoding used by @db.Date columns. */
export function businessQueryDate(instant: Date): Date {
  return new Date(`${businessDay(instant)}T00:00:00.000Z`)
}

const clock = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
})

/** The Los Angeles wall-clock reading of an instant, as if it were UTC. */
function wallClockAsUtc(instant: Date): number {
  const parts = clock.formatToParts(instant)
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"))
}

/**
 * The instant a business day starts (local midnight), from a date in the
 * @db.Date encoding (`YYYY-MM-DDT00:00:00Z`). For filtering real timestamps
 * such as `InventoryAdjustment.occurredAt`, which `toQueryBounds` cannot do:
 * its bounds are calendar fields, so 9pm Pacific (04:00Z next day) would land
 * on tomorrow.
 */
export function businessDayStartInstant(day: Date): Date {
  const midnightUtc = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())
  let guess = midnightUtc
  // Two passes settle the offset across a DST change.
  for (let i = 0; i < 2; i++) guess = midnightUtc - (wallClockAsUtc(new Date(guess)) - guess)
  return new Date(guess)
}
