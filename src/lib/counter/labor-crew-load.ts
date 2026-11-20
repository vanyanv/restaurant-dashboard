import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { toQueryBounds, type DateRange } from "@/lib/counter/date-range"
import { shortStoreName } from "@/lib/checks/names"
import type { LaborCrew } from "@/lib/counter/labor-crew"

/**
 * The rows behind the Labor page's People and Time clock tabs: the published
 * shifts, the timekeeping alerts and the crew names for a range.
 *
 * Stores are resolved through `accountId` first (the tenancy boundary), as
 * `loadLeakLedger` does: `storeId: null` means every store on this account,
 * and a store that is not on the account resolves to no rows. Names are read
 * for the people in those rows only, and for those stores only. The week
 * totals read every store on the SAME account, never another's.
 *
 * `weekStart` is a DATE column, read back as UTC midnight, so its day is taken
 * from the ISO string and not from local getters.
 *
 * Not cached: the rows carry crew names, and three indexed reads are cheap.
 */
export async function loadLaborCrew(input: {
  range: DateRange
  storeId: string | null
  accountId: string
}): Promise<LaborCrew> {
  const { range, storeId, accountId } = input
  const stores = await getScopedStores(accountId, storeId ?? null)
  if (stores.length === 0) return { stores: [], shifts: [], weeks: [], alerts: [], names: [] }
  const storeIds = stores.map((s) => s.id)
  const { startDate, endDate } = toQueryBounds(range)

  const [shifts, alerts] = await Promise.all([
    // isVirtual: false, as `loadLaborWeek` reads it: an unfilled slot is nobody's hours.
    prisma.harriShift.findMany({
      where: { storeId: { in: storeIds }, date: { gte: startDate, lte: endDate }, isVirtual: false, userId: { not: null } },
      select: { storeId: true, userId: true, minutes: true, weekStart: true },
    }),
    prisma.harriTimekeepingAlert.findMany({
      where: { storeId: { in: storeIds }, date: { gte: startDate, lte: endDate } },
      select: { storeId: true, userId: true, alertCode: true },
    }),
  ])

  // The whole weeks the range touches, at EVERY store on the account, for the
  // past-40 check: a range that cuts a week, or a page on one store of two,
  // must not hide a long week. Still bounded by the account's own stores.
  const weekStarts = [...new Set(shifts.map((s) => s.weekStart.getTime()))].map((t) => new Date(t))
  const people = [...new Set(shifts.map((s) => s.userId))].filter((id): id is number => id !== null)
  const accountStoreIds = (await getScopedStores(accountId, null)).map((s) => s.id)
  const weekRows =
    weekStarts.length === 0
      ? []
      : await prisma.harriShift.groupBy({
          by: ["userId", "weekStart"],
          where: {
            storeId: { in: accountStoreIds },
            weekStart: { in: weekStarts },
            userId: { in: people },
            isVirtual: false,
          },
          _sum: { minutes: true },
        })

  const userIds = [...new Set([...shifts.map((s) => s.userId), ...alerts.map((a) => a.userId)])].filter(
    (id): id is number => id !== null,
  )
  const names =
    userIds.length === 0
      ? []
      : await prisma.harriEmployee.findMany({
          where: { storeId: { in: storeIds }, userId: { in: userIds } },
          select: { userId: true, firstName: true, lastName: true },
        })

  return {
    stores: stores.map((s) => ({ id: s.id, name: shortStoreName(s.name) })),
    shifts: shifts.map((s) => ({ storeId: s.storeId, userId: s.userId, minutes: s.minutes, weekStart: s.weekStart.toISOString().slice(0, 10) })),
    weeks: weekRows.flatMap((w) =>
      w.userId === null
        ? []
        : [{ userId: w.userId, weekStart: w.weekStart.toISOString().slice(0, 10), minutes: w._sum.minutes ?? 0 }],
    ),
    alerts,
    names,
  }
}
