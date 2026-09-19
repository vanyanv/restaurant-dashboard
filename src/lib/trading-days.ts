/**
 * The days a store actually traded, and series built over them.
 *
 * `OtterMenuItem` has no row for an item that sold nothing, so a missing day
 * is indistinguishable from a zero day — and a day with no rows AT ALL is a
 * day the store was shut, or a day Otter did not sync. Two separate analyses
 * built their series by walking the calendar and filling every gap with zero,
 * and both drew a conclusion from days that never happened:
 *
 *   - `lost-sales-actions` read a two-day closure as a simultaneous 86 of
 *     every item on the menu, each priced at its own baseline.
 *   - `launch-trajectory-actions` read the last seven ROWS as the last seven
 *     days, so a new item selling on seven of the last thirty days had its
 *     rate measured over its good days and then multiplied by ninety.
 *
 * A day on which some other item sold is the only evidence this one COULD
 * have sold. That is what makes a zero on such a day meaningful, and it is
 * the only kind of day these functions count.
 */

/** The day key (`YYYY-MM-DD`, UTC) a row's business date falls on. */
export function tradingDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Index rows by the store that traded and the day it traded on.
 *
 * `soldSomething` decides what counts as trading: a row with zero quantity
 * and zero revenue is a published row for an item that did not sell, not
 * evidence the doors were open.
 */
export function tradedDaysByStore<T>(
  rows: T[],
  read: (row: T) => { storeId: string; date: Date; soldSomething: boolean },
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const row of rows) {
    const { storeId, date, soldSomething } = read(row)
    if (!soldSomething) continue
    const days = out.get(storeId) ?? new Set<string>()
    days.add(tradingDayKey(date))
    out.set(storeId, days)
  }
  return out
}

/** The store's trading days in the window, oldest first. */
export function tradingDaysIn(
  tradedDayKeys: Set<string>,
  opts: { sinceKey?: string; untilKey?: string } = {},
): string[] {
  const { sinceKey, untilKey } = opts
  return [...tradedDayKeys]
    .filter((k) => (sinceKey === undefined || k >= sinceKey) && (untilKey === undefined || k <= untilKey))
    .sort()
}

/**
 * One item's quantity on each of the last `days` trading days.
 *
 * A trading day with no row for the item is a real zero and belongs in the
 * mean. A day the store did not trade is absent, not zero.
 */
export function trailingTradingDayQtys(args: {
  tradedDayKeys: Set<string>
  qtyByDateKey: Map<string, number>
  /** The item's first sale — nothing before it is part of its trajectory. */
  sinceKey: string
  untilKey: string
  days: number
}): number[] {
  const { tradedDayKeys, qtyByDateKey, sinceKey, untilKey, days } = args
  return tradingDaysIn(tradedDayKeys, { sinceKey, untilKey })
    .slice(-days)
    .map((k) => qtyByDateKey.get(k) ?? 0)
}

/**
 * The share of calendar days in a span on which the store traded.
 *
 * 1 for a store that opens every day. Used to turn a per-trading-day rate
 * into a per-calendar-day horizon without assuming a seven-day week: a store
 * dark on Mondays does not get 90 selling days out of 90 calendar ones.
 *
 * Pass the days of a RECENT window, not every trading day on record. Measured
 * over all of history it answers a different question — one whose answer is
 * dominated by however far back the data happens to reach, so a store with
 * one stray row from January reads as trading a quarter of the time.
 * `tradingDaysIn` is how you window it.
 */
export function tradingRate(tradingDays: string[]): number {
  if (tradingDays.length === 0) return 1
  const keys = [...tradingDays].sort()
  const first = Date.parse(`${keys[0]}T00:00:00Z`)
  const last = Date.parse(`${keys[keys.length - 1]}T00:00:00Z`)
  const span = Math.round((last - first) / 86_400_000) + 1
  if (span <= 0) return 1
  return Math.min(1, keys.length / span)
}
