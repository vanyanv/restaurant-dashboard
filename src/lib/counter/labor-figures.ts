import { TOTAL_SALES_CODE } from "@/lib/pnl"
import { loadStatement, rowValues, type Statement } from "@/lib/counter/statement"
import { laborWeek, loadLaborWeek, type LaborDay, type LaborRole, type LaborWeek } from "@/lib/counter/labor-week"
import { loadLeakLedger, type LeakLedger } from "@/lib/counter/labor-leaks"
import { dayCount, isoDay, type DateRange } from "@/lib/counter/date-range"

/**
 * The statement's Total Sales, one reading per calendar day, keyed
 * `YYYY-MM-DD`.
 *
 * This is L-R2's whole mechanism: `loadLaborWeek` takes this map and computes
 * `laborPct` on it, so the labour percentage on the Labor page, in the chat,
 * and on the P&L are the same division of the same two numbers.
 *
 * The key comes from the RANGE's own calendar (`range.start + i`), not from a
 * bucket's label: `buildPeriods` formats its daily labels in the server's local
 * time off a UTC-floored cursor, and a reader's day is the restaurant's day.
 */
export function salesByDayOf(daily: Statement, range: DateRange): Map<string, number> {
  return dayMap(rowValues(daily.rows, TOTAL_SALES_CODE) ?? [], range)
}

/**
 * The same Net Sales, per store and day: `store.rows` off the one daily
 * statement. Labor needs it to know which store-days SOLD but have no labor
 * reading, so their sales can be left out of the labor % and SPLH denominators.
 */
export function salesByStoreDayOf(
  daily: Statement,
  range: DateRange,
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>()
  for (const s of daily.perStore) {
    out.set(s.storeId, dayMap(rowValues(s.rows, TOTAL_SALES_CODE) ?? [], range))
  }
  return out
}

function dayMap(net: number[], range: DateRange): Map<string, number> {
  const out = new Map<string, number>()
  for (let i = 0; i < dayCount(range); i++) {
    const d = new Date(
      range.start.getFullYear(),
      range.start.getMonth(),
      range.start.getDate() + i,
    )
    out.set(isoDay(d), net[i] ?? 0)
  }
  return out
}

export interface LaborFigures {
  week: LaborWeek
  days: LaborDay[]
  roles: LaborRole[]
  /** `null` when no hours were worked: there is no rate to cost an alert at. */
  leaks: LeakLedger | null
}

/**
 * The Labor page's figures without its layout, for a caller that wants the
 * numbers (the chat). The same chain the page's adapter runs: daily statement
 * → Total Sales by day → labour week → leak ledger costed at the week's
 * blended rate. Nothing here computes a figure of its own.
 *
 * `loadStatement` scopes by the session (see its note), and the two Harri
 * loaders by `accountId`, so a caller must be inside a request whose session
 * is on that account — the chat route is.
 */
export async function loadLaborFigures(input: {
  range: DateRange
  /** `null` = every store on the account. */
  storeId: string | null
  accountId: string
}): Promise<LaborFigures> {
  const { range, storeId, accountId } = input
  const statement = await loadStatement({ range, storeId, granularity: "daily" })
  const raw = await loadLaborWeek({
    range,
    storeId,
    accountId,
    salesByDay: salesByDayOf(statement, range),
    salesByStoreDay: salesByStoreDayOf(statement, range),
  })
  const week = laborWeek(raw.days, raw.overtimeCost)
  const leaks =
    week.blendedRate === null
      ? null
      : await loadLeakLedger({ range, storeId, accountId, blendedRate: week.blendedRate })
  return { week, days: raw.days, roles: raw.roles, leaks }
}
