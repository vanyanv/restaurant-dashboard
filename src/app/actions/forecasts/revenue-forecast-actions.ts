"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

interface SessionUser {
  id: string
  accountId: string
}
interface SessionLike {
  user?: SessionUser | null
}

export interface RevenueForecastDay {
  date: Date
  predictedRevenue: number
  p10: number | null
  p90: number | null
  modelVersion: string
  generatedAt: Date
}

export interface RevenueForecastData {
  /** Null when aggregating across all stores in the account. */
  storeId: string | null
  storeName: string
  /** Most recent forecast generation timestamp; null when no forecasts exist. */
  generatedAt: Date | null
  /** MAPE on the last reconciled window — null until the pipeline runs. */
  recentMape: number | null
  days: RevenueForecastDay[]
}

export type GetRevenueForecastResult =
  | { ok: true; data: RevenueForecastData }
  | { ok: false; error: "store_not_in_account" }

/**
 * Read the latest 14-day daily revenue forecast. When `storeId` is supplied,
 * scopes to that single store; when omitted, sums across every active store
 * in the user's account ("All stores" portfolio view).
 */
export async function getRevenueForecast(input: {
  storeId?: string
  horizonDays?: number
  asOf?: Date
}): Promise<GetRevenueForecastResult | null> {
  const session = (await getServerSession(authOptions)) as SessionLike | null
  const user = session?.user ?? null
  if (!user) return null

  let storeIds: string[]
  let storeName: string
  let storeIdOut: string | null
  if (input.storeId) {
    const store = await prisma.store.findUnique({
      where: { id: input.storeId },
      select: { id: true, name: true, accountId: true },
    })
    if (!store || store.accountId !== user.accountId) {
      return { ok: false, error: "store_not_in_account" }
    }
    storeIds = [store.id]
    storeName = store.name
    storeIdOut = store.id
  } else {
    const stores = await prisma.store.findMany({
      where: { accountId: user.accountId, isActive: true },
      select: { id: true },
    })
    storeIds = stores.map((s) => s.id)
    storeName = "All stores"
    storeIdOut = null
  }

  const horizonDays = input.horizonDays ?? 14
  const asOf = input.asOf ?? new Date()
  const horizonEnd = new Date(asOf)
  horizonEnd.setDate(horizonEnd.getDate() + horizonDays)

  const rows = await prisma.forecastDailyRevenue.findMany({
    where: {
      storeId: { in: storeIds },
      hourBucket: 0,
      forecastDate: { gte: startOfDay(asOf), lt: startOfDay(horizonEnd) },
    },
    select: {
      storeId: true,
      forecastDate: true,
      predictedRevenue: true,
      p10: true,
      p90: true,
      modelVersion: true,
      generatedAt: true,
    },
  })

  // Latest generation per (storeId, date), then sum across stores per date.
  const latestPerStoreDate = new Map<string, (typeof rows)[number]>()
  for (const r of rows) {
    const key = `${r.storeId}|${r.forecastDate.toISOString().slice(0, 10)}`
    const existing = latestPerStoreDate.get(key)
    if (!existing || r.generatedAt > existing.generatedAt) {
      latestPerStoreDate.set(key, r)
    }
  }

  const aggByDate = new Map<
    string,
    {
      date: Date
      predictedRevenue: number
      p10: number
      p90: number
      modelVersion: string
      generatedAt: Date
    }
  >()
  for (const r of latestPerStoreDate.values()) {
    const key = r.forecastDate.toISOString().slice(0, 10)
    const cur = aggByDate.get(key)
    const pr = r.predictedRevenue
    const p10 = r.p10 ?? pr
    const p90 = r.p90 ?? pr
    if (!cur) {
      aggByDate.set(key, {
        date: r.forecastDate,
        predictedRevenue: pr,
        p10,
        p90,
        modelVersion: r.modelVersion,
        generatedAt: r.generatedAt,
      })
    } else {
      cur.predictedRevenue += pr
      cur.p10 += p10
      cur.p90 += p90
      if (r.generatedAt > cur.generatedAt) {
        cur.generatedAt = r.generatedAt
        cur.modelVersion = r.modelVersion
      }
    }
  }

  const days: RevenueForecastDay[] = Array.from(aggByDate.values())
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((r) => ({
      date: r.date,
      predictedRevenue: r.predictedRevenue,
      p10: r.p10,
      p90: r.p90,
      modelVersion: r.modelVersion,
      generatedAt: r.generatedAt,
    }))

  const generatedAt =
    days.length > 0
      ? days.reduce(
          (max, d) => (d.generatedAt > max ? d.generatedAt : max),
          days[0].generatedAt,
        )
      : null

  // MAPE is account-wide (single mlTrainingRun row, no per-store split). Show
  // it for both single-store and aggregate views.
  const lastRun = await prisma.mlTrainingRun.findFirst({
    where: { target: "REVENUE", status: "SUCCEEDED", mape: { not: null } },
    orderBy: { startedAt: "desc" },
    select: { mape: true },
  })

  return {
    ok: true,
    data: {
      storeId: storeIdOut,
      storeName,
      generatedAt,
      recentMape: lastRun?.mape ?? null,
      days,
    },
  }
}

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}
