import { businessQueryDate } from "./business-date"

const DAY_MS = 86_400_000

/**
 * How long ago a count was taken, in the stores' own calendar days: a count
 * at 11pm reads "yesterday" at 1am, and one from this morning reads "today"
 * however many hours have passed. The Inventory overview, the Shelf tab and
 * Order next all word a count's age with this, so they cannot disagree.
 */
export function businessDaysSince(at: Date, now: Date): number {
  return Math.max(0, Math.round((businessQueryDate(now).getTime() - businessQueryDate(at).getTime()) / DAY_MS))
}

/** "today" / "yesterday" / "9 days ago". */
export function countedAgo(at: Date, now: Date): string {
  const days = businessDaysSince(at, now)
  if (days === 0) return "today"
  if (days === 1) return "yesterday"
  return `${days} days ago`
}
