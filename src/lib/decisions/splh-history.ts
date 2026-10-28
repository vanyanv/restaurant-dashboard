/**
 * The per-day labor-hours-against-sales rows behind the weekday SPLH medians
 * (`weekdayTargets`), folded account-wide from per-store inputs.
 *
 * Hours are one figure per store-day (`HarriPositionDaily`, already summed over
 * its position rows) and sales are the statement's Net Sales per store-day —
 * the same figure the P&L and the Labor page print — so a store-day's sales
 * are counted exactly once however many positions worked it. (The old raw SQL
 * joined the one daily figure onto the position table and had to fold labor
 * first to stop the fan-out; with one input row per store-day there is no
 * fan-out to guard.)
 *
 * `unsynced` counts the stores that worked a day with no sales figure behind
 * it. Their hours sit in the denominator and their sales are not in the
 * numerator, so the caller drops such a day rather than scoring a collapse
 * that never happened.
 */
export interface StoreDayHours {
  storeId: string
  /** `YYYY-MM-DD`. */
  day: string
  hours: number
}

export interface SplhHistoryRow {
  day: string
  hours: number
  net: number | null
  unsynced: number
}

export function foldSplhHistory(input: {
  hours: StoreDayHours[]
  /** Net Sales keyed `${storeId}|${day}`. A store-day not in it has no sales figure. */
  net: Map<string, number>
}): SplhHistoryRow[] {
  const byDay = new Map<string, SplhHistoryRow>()
  const seen = new Set<string>()
  for (const h of input.hours) {
    const key = `${h.storeId}|${h.day}`
    const row = byDay.get(h.day) ?? { day: h.day, hours: 0, net: null, unsynced: 0 }
    row.hours += h.hours
    // One vote and one sales figure per store-day, even if a store-day arrives twice.
    if (!seen.has(key)) {
      seen.add(key)
      const n = input.net.get(key)
      if (n === undefined) row.unsynced += 1
      else row.net = (row.net ?? 0) + n
    }
    byDay.set(h.day, row)
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
}
