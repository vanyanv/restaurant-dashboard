import { getAccountStoreRows } from "@/lib/account-stores"
import { prisma } from "@/lib/prisma"
import { toQueryBounds, type DateRange } from "@/lib/counter/date-range"
import {
  buildElapsedCompare,
  currentElapsedWindow,
  lastDayState,
  mayBeIncomplete,
  priorElapsedWindow,
  type ElapsedCompare,
  type LaClock,
} from "@/lib/counter/elapsed-compare"

/** The sync that writes the daily figures the full-day comparison reads (the same job the sync chip watches). */
const SYNC_JOB = "otter.metrics.sync"

const dayKey = (d: Date) => d.toISOString().slice(0, 10)

/**
 * The reads behind `elapsed-compare.ts`: the latest successful Otter sync for
 * the stores in scope, the newest hourly row, and the hourly rows of the
 * current range and its prior window.
 *
 * Returns null when the last day is complete, which means: compare in full,
 * exactly as before. Every read is bounded by `accountId` — hourly rows
 * through `store: { accountId }`, sync runs by the account's own store ids
 * (a run with no store is the platform's own and counts for everyone, as in
 * `shell-status.ts`).
 */
export async function loadElapsedCompare(input: {
  range: DateRange
  storeId: string | null
  accountId: string
  now: Date
}): Promise<ElapsedCompare | null> {
  const { range, storeId, accountId, now } = input
  if (!mayBeIncomplete(range, now)) return null

  // The request's one store read (`@/lib/account-stores`), narrowed to one store.
  const stores = (await getAccountStoreRows(accountId)).filter((s) => !storeId || s.id === storeId)
  const storeIds = stores.map((s) => s.id)
  if (storeIds.length === 0) return null

  const hourlyScope = { store: { accountId }, storeId: { in: storeIds } }
  const [run, newest] = await Promise.all([
    prisma.jobRun.findFirst({
      where: {
        jobName: SYNC_JOB,
        status: "SUCCESS",
        OR: [{ storeId: null }, { storeId: { in: storeIds } }],
      },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    }),
    prisma.otterHourlySummary.findFirst({
      where: hourlyScope,
      orderBy: [{ date: "desc" }, { hour: "desc" }],
      select: { date: true, hour: true },
    }),
  ])
  const newestHourly: LaClock | null = newest ? { day: dayKey(newest.date), hour: newest.hour } : null

  const state = lastDayState({ range, now, lastSyncAt: run?.startedAt ?? null, newestHourly })
  if (state === "complete") return null

  const cur = toQueryBounds(currentElapsedWindow(range, now))
  const priorWindow = priorElapsedWindow(range, now)
  const prior = priorWindow ? toQueryBounds(priorWindow) : null
  const rows = await prisma.otterHourlySummary.findMany({
    where: {
      ...hourlyScope,
      OR: [
        { date: { gte: cur.startDate, lte: cur.endDate } },
        ...(prior ? [{ date: { gte: prior.startDate, lte: prior.endDate } }] : []),
      ],
    },
    select: { storeId: true, date: true, hour: true, netSales: true },
  })

  return buildElapsedCompare({
    range,
    state,
    now,
    rows: rows.map((r) => ({ storeId: r.storeId, day: dayKey(r.date), hour: r.hour, netSales: r.netSales })),
    newestHourly,
  })
}

