import { cache } from "react"
import { prisma } from "@/lib/prisma"
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
  const shared = await laborCostThisRequest(accountId, [...storeIds].sort().join(","), days[0], days[days.length - 1])
  return structuredClone(shared)
}

/**
 * One read per (account, stores, first day, last day) per server render.
 * Overview asked for the same days five times through different callers (the
 * rollup, the comparison rollup, the SPLH series, the labor week), with end
 * times of 00:00 or 23:59:59 that name the same calendar day; keyed on the
 * days, three distinct reads remain. Callers get a clone, so none can change
 * another's figures.
 */
const laborCostThisRequest = cache(
  (accountId: string, storeIdsKey: string, firstDay: string, lastDay: string): Promise<LaborCost> =>
    loadLaborCostFor(
      accountId,
      storeIdsKey.split(","),
      daysBetween(new Date(`${firstDay}T00:00:00.000Z`), new Date(`${lastDay}T00:00:00.000Z`)),
      prisma,
    ),
)

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

  const [daily, positions, rates] = await Promise.all([
    db.harriDailyLabor.findMany({
      where,
      select: { storeId: true, date: true, actualCost: true },
    }),
    db.harriPositionDaily.groupBy({
      by: ["storeId", "date"],
      where,
      _sum: { totalLabor: true },
    }),
    // The employer payroll tax each store's wages are loaded with — the
    // owner's setting on the store file. Same tenancy boundary as above.
    db.store.findMany({
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
