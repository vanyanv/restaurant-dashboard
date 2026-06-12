// CacheStat rollups — per-prefix hit stats and the daily hit-rate trend.

import { prisma } from "@/lib/prisma"

export async function getCacheStats(hours = 168) {
  const since = new Date(Date.now() - hours * 3600_000)
  const rows = await prisma.$queryRaw<{ keyPrefix: string; hits: bigint; misses: bigint; writes: bigint; busts: bigint; failures: bigint }[]>`
    SELECT
      "keyPrefix",
      SUM(hits)::bigint     AS hits,
      SUM(misses)::bigint   AS misses,
      SUM(writes)::bigint   AS writes,
      SUM(busts)::bigint    AS busts,
      SUM(failures)::bigint AS failures
    FROM "CacheStat"
    WHERE "hourBucket" >= ${since}
    GROUP BY "keyPrefix"
    ORDER BY (SUM(hits) + SUM(misses)) DESC
  `
  return rows.map((r) => {
    const hits = Number(r.hits)
    const misses = Number(r.misses)
    const total = hits + misses
    return {
      keyPrefix: r.keyPrefix,
      hits, misses,
      writes: Number(r.writes),
      busts: Number(r.busts),
      failures: Number(r.failures),
      hitPct: total > 0 ? (hits / total) * 100 : 0,
      sample: total,
    }
  })
}

export type CacheHitRateByDayPoint = {
  day: Date
  hits: number
  misses: number
  hitPct: number
}

export async function getCacheHitRateByDay(days = 7): Promise<CacheHitRateByDayPoint[]> {
  const since = new Date(Date.now() - days * 86_400_000)
  const rows = await prisma.$queryRaw<{ day: Date; hits: bigint; misses: bigint }[]>`
    SELECT
      date_trunc('day', "hourBucket") AS day,
      SUM(hits)::bigint   AS hits,
      SUM(misses)::bigint AS misses
    FROM "CacheStat"
    WHERE "hourBucket" >= ${since}
    GROUP BY 1
    ORDER BY 1 ASC
  `
  return rows.map((r) => {
    const hits = Number(r.hits)
    const misses = Number(r.misses)
    const total = hits + misses
    return { day: r.day, hits, misses, hitPct: total > 0 ? (hits / total) * 100 : 0 }
  })
}
