import { cache } from "react"
import { prisma } from "@/lib/prisma"
import { cached, stableKey } from "@/lib/cache/cached"
import { CLOSED_RANGE_TTL, rangeScopedTags } from "@/lib/cache/closed-range"
import { batchedDayRows, dayStart, type DayRange } from "@/lib/counter/day-batch"
import {
  daysBetween,
  foldLaborCost,
  type LaborCost,
} from "@/lib/counter/labor-cost-core"

export * from "@/lib/counter/labor-cost-core"

/**
 * The query half of the one labor-dollar function. The rule is in
 * `./labor-cost-core.ts`; read that first.
 *
 * Per store and business day: `HarriDailyLabor.actualCost` when it is a real
 * (> 0) reading, else the day's `HarriPositionDaily.totalLabor` sum, else the
 * day is missing — and a decided day's wages carry the store's employer
 * payroll tax (`Store.employerPayrollTaxRate`). The P&L rollup, the chat P&L tool and the Labor page all
 * read their labor dollars here, so a week costs the same on every page.
 *
 * Hours and per-position splits still come from `HarriPositionDaily` — they
 * are not dollars of the day — but any page total of labor dollars must equal
 * this function's total for the same range.
 *
 * `accountId` is the tenancy boundary: both reads filter on
 * `store: { accountId }`, so a store id from another account returns nothing
 * even if a caller passes one.
 */

export interface LaborCostQuery {
  accountId: string
  storeIds: string[]
  /** Inclusive; read as its UTC calendar day (`@db.Date` columns sit at UTC midnight). */
  startDate: Date
  /** Inclusive. */
  endDate: Date
}

/** The app's client, or a chat tool's own `ctx.prisma`. */
type LaborDb = Pick<typeof prisma, "harriDailyLabor" | "harriPositionDaily" | "store">

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

export async function loadLaborCost(
  input: LaborCostQuery,
  db: LaborDb = prisma,
): Promise<LaborCost> {
  const { accountId, storeIds } = input
  const days = daysBetween(input.startDate, input.endDate)
  if (storeIds.length === 0 || days.length === 0) return { stores: {}, total: 0, missingStoreDays: 0 }
  // Only the app's own client is shared per request; a chat tool's `ctx.prisma`
  // keeps its own reads.
  if (db !== prisma) return loadLaborCostFor(accountId, storeIds, days, db)
  const memo = laborCostThisRequest()
  const key = `${accountId}|${[...storeIds].sort().join(",")}|${days[0]}|${days[days.length - 1]}`
  let shared = memo.get(key)
  if (!shared) {
    shared = loadLaborCostSaved(accountId, storeIds, days)
    memo.set(key, shared)
    // A failed read is dropped so the next caller in the render retries,
    // as each did on its own before this was shared.
    shared.catch(() => memo.delete(key))
  }
  return structuredClone(await shared)
}

/**
 * One read per (account, stores, first day, last day) per server render.
 * Overview asked for the same days five times through different callers (the
 * rollup, the comparison rollup, the SPLH series, the labor week), with end
 * times of 00:00 or 23:59:59 that name the same calendar day; keyed on the
 * days, three distinct reads remain. Callers get a clone, so none can change
 * another's figures. Outside a render (crons, scripts) React's `cache` gives a
 * fresh map per call, so nothing is shared there.
 */
const laborCostThisRequest = cache(() => new Map<string, Promise<LaborCost>>())

/**
 * Past days only: saved across requests until a write to one of those days
 * (the Harri sync) or a store's payroll tax changes. A range that includes
 * today, or one too long to save, reads fresh. See @/lib/cache/closed-range.
 */
function loadLaborCostSaved(accountId: string, storeIds: string[], days: string[]): Promise<LaborCost> {
  const load = () => loadLaborCostFor(accountId, storeIds, days, prisma)
  const first = days[0]
  const last = days[days.length - 1]
  const tags = rangeScopedTags(new Date(`${first}T00:00:00.000Z`), new Date(`${last}T00:00:00.000Z`), [])
  if (tags.length === 0) return load()
  return cached(
    `counter:labor-cost:v1:${stableKey({ a: accountId, ids: [...storeIds].sort(), f: first, l: last })}`,
    CLOSED_RANGE_TTL,
    tags,
    load,
  )
}

async function loadLaborCostFor(
  accountId: string,
  storeIds: string[],
  days: string[],
  db: LaborDb,
): Promise<LaborCost> {

  const range = {
    gte: new Date(`${days[0]}T00:00:00.000Z`),
    lte: new Date(`${days[days.length - 1]}T00:00:00.000Z`),
  }
  const where = { storeId: { in: storeIds }, store: { accountId }, date: range }

  // On the app's own client the three reads are shared across one render:
  // Overview's rollups ask for four overlapping ranges, and the rows of a
  // wider read cut to these days are the rows this read returns. See
  // @/lib/counter/day-batch. A chat tool's `ctx.prisma` reads on its own.
  const shared = db === prisma
  const storeKey = [...storeIds].sort().join(",")
  const readDaily = (r: { gte: Date; lte: Date }) =>
    db.harriDailyLabor.findMany({
      where: { ...where, date: r },
      select: { storeId: true, date: true, actualCost: true },
    })
  const readPositions = (r: { gte: Date; lte: Date }) =>
    db.harriPositionDaily.groupBy({
      by: ["storeId", "date"],
      where: { ...where, date: r },
      _sum: { totalLabor: true },
    })
  const wide = (r: DayRange) => ({ gte: dayStart(r.first), lte: dayStart(r.last) })
  const dayRange = { first: days[0], last: days[days.length - 1] }

  const [daily, positions, rates] = await Promise.all([
    shared
      ? batchedDayRows({
          group: `labor-daily|${accountId}|${storeKey}`,
          range: dayRange,
          load: (r) => readDaily(wide(r)),
          dayOf: (row) => isoDay(row.date),
        })
      : readDaily(range),
    shared
      ? batchedDayRows({
          group: `labor-positions|${accountId}|${storeKey}`,
          range: dayRange,
          load: (r) => readPositions(wide(r)),
          dayOf: (row) => isoDay(row.date),
        })
      : readPositions(range),
    // The employer payroll tax each store's wages are loaded with — the
    // owner's setting on the store file. Same tenancy boundary as above.
    shared
      ? payrollTaxRatesThisRequest(accountId, storeKey)
      : db.store.findMany({
          where: { id: { in: storeIds }, accountId },
          select: { id: true, employerPayrollTaxRate: true },
        }),
  ])

  return foldLaborCost({
    storeIds,
    days,
    daily: daily.map((r) => ({ storeId: r.storeId, day: isoDay(r.date), actualCost: r.actualCost })),
    positions: positions.map((r) => ({
      storeId: r.storeId,
      day: isoDay(r.date),
      totalLabor: r._sum.totalLabor ?? null,
    })),
    payrollTaxRates: Object.fromEntries(rates.map((r) => [r.id, r.employerPayrollTaxRate])),
  })
}

/**
 * Each store's payroll tax rate, read once per render for a store set (React
 * `cache` keys on the two strings). Outside a render it reads every call.
 */
const payrollTaxRatesThisRequest = cache((accountId: string, storeKey: string) =>
  prisma.store.findMany({
    where: { id: { in: storeKey.split(",") }, accountId },
    select: { id: true, employerPayrollTaxRate: true },
  }),
)
