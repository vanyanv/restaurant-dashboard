// Phase 2 — Grounding: a small "what's happening right now" snapshot we
// inject into the per-request context block of the system prompt. Lets the
// model answer ambient questions ("how's today going?") without burning a
// tool call, and primes its choice of which tools to invoke.
//
// Goes AFTER the static prompt so it doesn't break OpenAI's prefix cache.
// 60s TTL — short enough that new sales / anomalies show up within a minute,
// long enough that repeat turns don't pile DB load.

import { prisma } from "@/lib/prisma"

const SNAPSHOT_TTL_MS = 60_000

interface CachedSnapshot {
  text: string
  expiresAt: number
}

const cache = new Map<string, CachedSnapshot>()

interface StoreLast7d {
  storeId: string
  storeName: string
  net7d: number
  txns7d: number
}

export async function buildSituationSnapshot(accountId: string, now: Date = new Date()): Promise<string> {
  const cached = cache.get(accountId)
  if (cached && cached.expiresAt > Date.now()) return cached.text

  const stores = await prisma.store.findMany({
    where: { accountId, isActive: true },
    select: { id: true, name: true },
  })
  if (stores.length === 0) {
    const empty = "(no active stores on account)"
    cache.set(accountId, { text: empty, expiresAt: Date.now() + SNAPSHOT_TTL_MS })
    return empty
  }
  const storeIds = stores.map((s) => s.id)
  const storeNameById = new Map(stores.map((s) => [s.id, s.name]))

  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setUTCHours(0, 0, 0, 0)
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7)
  const today = new Date(now)
  today.setUTCHours(0, 0, 0, 0)

  // Run the three reads in parallel.
  const [salesByStore, openAnomalies, latestForecast] = await Promise.all([
    prisma.otterDailySummary.groupBy({
      by: ["storeId"],
      where: {
        storeId: { in: storeIds },
        date: { gte: sevenDaysAgo, lt: today },
      },
      _sum: {
        fpNetSales: true,
        tpNetSales: true,
        fpOrderCount: true,
        tpOrderCount: true,
      },
    }),
    prisma.anomalyEvent.count({
      where: {
        storeId: { in: storeIds },
        status: "OPEN",
        occurredOn: { gte: sevenDaysAgo },
      },
    }),
    prisma.forecastDailyRevenue.findFirst({
      where: { storeId: { in: storeIds } },
      orderBy: { generatedAt: "desc" },
      select: { generatedAt: true, modelVersion: true },
    }),
  ])

  const last7d: StoreLast7d[] = salesByStore.map((row) => ({
    storeId: row.storeId,
    storeName: storeNameById.get(row.storeId) ?? row.storeId,
    net7d: (row._sum.fpNetSales ?? 0) + (row._sum.tpNetSales ?? 0),
    txns7d: (row._sum.fpOrderCount ?? 0) + (row._sum.tpOrderCount ?? 0),
  }))

  const totalNet = last7d.reduce((acc, r) => acc + r.net7d, 0)
  const totalTxns = last7d.reduce((acc, r) => acc + r.txns7d, 0)

  const lines: string[] = []
  lines.push(
    `Trailing 7 days (${formatDate(sevenDaysAgo)} → ${formatDate(today)}): net $${formatMoney(totalNet)} across ${formatNum(totalTxns)} orders.`,
  )
  if (last7d.length > 1) {
    const perStore = last7d
      .map((r) => `${r.storeName}: $${formatMoney(r.net7d)}`)
      .join(", ")
    lines.push(`Per store — ${perStore}.`)
  }
  lines.push(
    `Open anomalies (last 7 days, |z| ≥ 3): ${openAnomalies}${openAnomalies > 0 ? ". Use getOpenAnomalies for detail." : "."}`,
  )
  if (latestForecast) {
    const ageHours = Math.round(
      (now.getTime() - latestForecast.generatedAt.getTime()) / 3_600_000,
    )
    lines.push(
      `Forecast pipeline last ran ${ageHours}h ago (model ${latestForecast.modelVersion}).${ageHours > 36 ? " Stale — surface this caveat in any forecast answer." : ""}`,
    )
  } else {
    lines.push(
      "Forecast pipeline has no rows yet — getRevenueForecast / getMenuItemForecast will return empty.",
    )
  }

  const text = lines.join("\n")
  cache.set(accountId, { text, expiresAt: Date.now() + SNAPSHOT_TTL_MS })
  return text
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function formatMoney(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 })
}
function formatNum(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 })
}
