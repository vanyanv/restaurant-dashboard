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
