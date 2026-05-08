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
  storeId: string
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
 * Read the latest 14-day daily revenue forecast for a store. Returns an
 * empty `days` array when the pipeline has not produced any forecasts yet —
 * the dashboard shows an "awaiting first run" empty state in that case.
 *
 * The Python pipeline writes a fresh row per (storeId, forecastDate) on
 * every run, so we keep only the latest `generatedAt` per (date, hour=0).
 */
export async function getRevenueForecast(input: {
  storeId: string
  horizonDays?: number
  asOf?: Date
}): Promise<GetRevenueForecastResult | null> {
  const session = (await getServerSession(authOptions)) as SessionLike | null
  const user = session?.user ?? null
  if (!user) return null

  const store = await prisma.store.findUnique({
    where: { id: input.storeId },
    select: { id: true, name: true, accountId: true },
  })
  if (!store || store.accountId !== user.accountId) {
    return { ok: false, error: "store_not_in_account" }
  }

  const horizonDays = input.horizonDays ?? 14
  const asOf = input.asOf ?? new Date()
  const horizonEnd = new Date(asOf)
  horizonEnd.setDate(horizonEnd.getDate() + horizonDays)

  const rows = await prisma.forecastDailyRevenue.findMany({
    where: {
      storeId: input.storeId,
      hourBucket: 0,
      forecastDate: { gte: startOfDay(asOf), lt: startOfDay(horizonEnd) },
    },
    orderBy: [{ forecastDate: "asc" }, { generatedAt: "desc" }],
    select: {
      forecastDate: true,
      predictedRevenue: true,
      p10: true,
      p90: true,
      modelVersion: true,
      generatedAt: true,
    },
  })

  // For each forecastDate keep only the most-recent generation.
  const latestByDate = new Map<string, (typeof rows)[number]>()
  for (const r of rows) {
    const key = r.forecastDate.toISOString().slice(0, 10)
    const existing = latestByDate.get(key)
    if (!existing || r.generatedAt > existing.generatedAt) {
      latestByDate.set(key, r)
    }
  }

  const days: RevenueForecastDay[] = Array.from(latestByDate.values())
    .sort((a, b) => a.forecastDate.getTime() - b.forecastDate.getTime())
    .map((r) => ({
      date: r.forecastDate,
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

  const lastRun = await prisma.mlTrainingRun.findFirst({
    where: { target: "REVENUE", status: "SUCCEEDED", mape: { not: null } },
    orderBy: { startedAt: "desc" },
    select: { mape: true },
  })

  return {
    ok: true,
    data: {
      storeId: store.id,
      storeName: store.name,
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
