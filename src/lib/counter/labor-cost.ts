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
 * day is missing. The P&L rollup, the chat P&L tool and the Labor page all
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
type LaborDb = Pick<typeof prisma, "harriDailyLabor" | "harriPositionDaily">

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

export async function loadLaborCost(
  input: LaborCostQuery,
  db: LaborDb = prisma,
): Promise<LaborCost> {
  const { accountId, storeIds } = input
  const days = daysBetween(input.startDate, input.endDate)
  if (storeIds.length === 0 || days.length === 0) return { stores: {}, total: 0, missingStoreDays: 0 }

  const range = {
    gte: new Date(`${days[0]}T00:00:00.000Z`),
    lte: new Date(`${days[days.length - 1]}T00:00:00.000Z`),
  }
  const where = { storeId: { in: storeIds }, store: { accountId }, date: range }

  const [daily, positions] = await Promise.all([
    db.harriDailyLabor.findMany({
      where,
      select: { storeId: true, date: true, actualCost: true },
    }),
    db.harriPositionDaily.groupBy({
      by: ["storeId", "date"],
      where,
      _sum: { totalLabor: true },
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
  })
}
