/**
 * One forecast per store per day, from a table that keeps every generation.
 *
 * `ForecastDailyRevenue` is append-only across model generations: the nightly
 * writes the whole forward window each run and never deletes the last one. On
 * 2026-08-26 the fourteen-day window held 121 rows from 16 distinct
 * generations — sixteen for the nearest day, one for the furthest.
 *
 * So a `findMany` over a date range does NOT return a series. It returns a
 * series per generation, interleaved, and summing it is wrong by whatever
 * number of generations happen to be on file:
 *
 *     newest generation per day   $50,754     <- the week's forecast
 *     every row, no dedupe       $646,442     <- 12.7x, and five digits either way
 *
 * That is the whole reason this function exists rather than an `orderBy` in
 * each caller. The failure has no symptom: it is not a crash, and on a page
 * whose other figures are five digits it is not obviously silly. It is the
 * same failure class as `order-signs.ts` — one stored convention, misread,
 * producing a plausible number that is not the number.
 *
 * Note also that `horizonDay` is NOT the way out: it is null on 1,372 of the
 * table's 1,442 rows, so any query filtering on it returns almost nothing.
 *
 * Newest wins, keyed on (storeId, forecastDate). Output is sorted by date
 * ascending so a caller can chart it directly.
 */
export function newestGenerationPerDay<
  T extends { storeId: string; forecastDate: Date; generatedAt: Date },
>(rows: T[]): T[] {
  const best = new Map<string, T>()
  for (const r of rows) {
    const key = `${r.storeId}|${r.forecastDate.toISOString().slice(0, 10)}`
    const held = best.get(key)
    // `>=` rather than `>`: on a tie the later row in the input wins, which
    // keeps the function total. `>` would leave the earlier one, which is just
    // as arbitrary but reads as if a rule were being applied.
    if (held === undefined || r.generatedAt.getTime() >= held.generatedAt.getTime()) {
      best.set(key, r)
    }
  }
  return [...best.values()].sort(
    (a, b) => a.forecastDate.getTime() - b.forecastDate.getTime(),
  )
}

/**
 * The hourly sibling of `newestGenerationPerDay`, for `ForecastHourlyOrders`
 * (`src/lib/counter/staffing-curve.ts`, L-R6).
 *
 * Same append-only shape, one grain finer: unique on `(storeId,
 * forecastDate, hourBucket, generatedAt)` rather than `(storeId,
 * forecastDate)`. Measured over the labour window (2026-08-20 … 2026-08-26):
 *
 *     raw                    2,208 rows   35,020 orders
 *     newest generation only   168 rows    2,658 orders   <- 13.17x
 *
 * and the deduped total is the credible one — 2,658 forecast against 2,643
 * actual orders the same week. This is a second copy of
 * `newestGenerationPerDay`'s tie-break and sort shape, not a rewrite of it:
 * the two tables key on a different tuple, so one generic function over
 * `Map<string, T>` would need its caller to build that key anyway, which is
 * exactly what each of these two thin functions already does.
 */
export function newestGenerationPerHour<
  T extends {
    storeId: string
    forecastDate: Date
    hourBucket: number
    generatedAt: Date
  },
>(rows: T[]): T[] {
  const best = new Map<string, T>()
  for (const r of rows) {
    const key = `${r.storeId}|${r.forecastDate.toISOString().slice(0, 10)}|${r.hourBucket}`
    const held = best.get(key)
    // Same `>=` tie-break as `newestGenerationPerDay`: on a tie the later row
    // in the input wins, keeping the function total rather than leaving an
    // arbitrary earlier row behind.
    if (held === undefined || r.generatedAt.getTime() >= held.generatedAt.getTime()) {
      best.set(key, r)
    }
  }
  return [...best.values()].sort((a, b) => {
    const byDate = a.forecastDate.getTime() - b.forecastDate.getTime()
    return byDate !== 0 ? byDate : a.hourBucket - b.hourBucket
  })
}
