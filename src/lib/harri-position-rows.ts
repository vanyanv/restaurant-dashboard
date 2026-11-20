import { prisma } from "@/lib/prisma"
import { batchedDayRows, dayStart, utcDay } from "@/lib/counter/day-batch"

/**
 * `HarriPositionDaily` rows of these stores over a span, read once per render.
 *
 * The Labor page read this table twice (the week, then the twelve-week trend),
 * SPLH once more and the Decisions strip once more, each with its own
 * `select` and none through `day-batch`, while `loadLaborCost` beside them
 * already shared its read. One superset `select` here lets a wider read be cut
 * back to any caller's days (`batchedDayRows`), so each caller gets the rows
 * its own read would have returned and the render makes one read for the
 * widest span.
 *
 * `accountId` is the tenancy boundary: the read filters on
 * `store: { accountId }` as well as `storeId in`.
 *
 * A start that is not a UTC midnight reads on its own, as `getAllStoresPnL`'s
 * reads do, because only whole days can be cut from a shared read.
 */
export interface HarriPositionRow {
  storeId: string
  date: Date
  positionCode: string
  positionName: string | null
  payType: string
  totalLabor: number | null
  actualSeconds: number | null
  overtimeAmount: number | null
}

export function loadHarriPositionRows(input: {
  accountId: string
  storeIds: string[]
  startDate: Date
  endDate: Date
}): Promise<HarriPositionRow[]> {
  const { accountId, storeIds, startDate, endDate } = input
  const read = (r: { gte: Date; lte: Date }): Promise<HarriPositionRow[]> =>
    prisma.harriPositionDaily.findMany({
      where: { storeId: { in: storeIds }, store: { accountId }, date: r },
      select: {
        storeId: true,
        date: true,
        positionCode: true,
        positionName: true,
        payType: true,
        totalLabor: true,
        actualSeconds: true,
        overtimeAmount: true,
      },
    })
  if (startDate.getTime() !== dayStart(utcDay(startDate)).getTime()) {
    return read({ gte: startDate, lte: endDate })
  }
  return batchedDayRows({
    group: `harri-positions|${accountId}|${[...storeIds].sort().join(",")}`,
    range: { first: utcDay(startDate), last: utcDay(endDate) },
    load: (r) => read({ gte: dayStart(r.first), lte: dayStart(r.last) }),
    dayOf: (row) => utcDay(row.date),
  })
}

/**
 * Hours worked per (store, day) — what `groupBy(["storeId", "date"])` with
 * `_sum.actualSeconds` returned — summed from the shared rows. `actualSeconds`
 * is an integer, so the sums are exact. A day whose rows are all null is null,
 * as SUM is.
 */
export function actualSecondsByStoreDay(
  rows: HarriPositionRow[],
): Array<{ storeId: string; date: Date; _sum: { actualSeconds: number | null } }> {
  const by = new Map<string, { storeId: string; date: Date; _sum: { actualSeconds: number | null } }>()
  for (const r of rows) {
    const key = `${r.storeId}|${r.date.getTime()}`
    let cur = by.get(key)
    if (!cur) {
      cur = { storeId: r.storeId, date: r.date, _sum: { actualSeconds: null } }
      by.set(key, cur)
    }
    if (r.actualSeconds !== null) cur._sum.actualSeconds = (cur._sum.actualSeconds ?? 0) + r.actualSeconds
  }
  return [...by.values()]
}
