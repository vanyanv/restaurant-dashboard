// ErrorEvent analytics — recent errors, 24h count, hourly/daily histogram.

import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"
import { windowFromArg, truncLiteral, type TimeWindow } from "../time-range"

export async function getRecentErrors(limit = 50) {
  return prisma.errorEvent.findMany({
    orderBy: { occurredAt: "desc" },
    take: limit,
    select: { id: true, occurredAt: true, source: true, route: true, status: true, message: true, stack: true },
  })
}

export async function getErrorCount24h() {
  const since = new Date(Date.now() - 24 * 3600_000)
  return prisma.errorEvent.count({ where: { occurredAt: { gte: since } } })
}

/** Error counts bucketed by hour (legacy `hours` arg) or by the bucket of a
 * {@link TimeWindow} from the global range control. */
export async function getErrorsByHour(arg: number | TimeWindow = 24) {
  const { since, until, bucket } = windowFromArg(arg)
  const rows = await prisma.$queryRaw<{ bucket: Date; count: bigint }[]>`
    SELECT date_trunc(${Prisma.raw(truncLiteral(bucket))}, "occurredAt") AS bucket, COUNT(*)::bigint AS count
    FROM "ErrorEvent"
    WHERE "occurredAt" >= ${since} AND "occurredAt" <= ${until}
    GROUP BY 1 ORDER BY 1 ASC
  `
  return rows.map((r) => ({ bucket: r.bucket, count: Number(r.count) }))
}
