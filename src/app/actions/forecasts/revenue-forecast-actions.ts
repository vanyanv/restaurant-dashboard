"use server"

import { prisma } from "@/lib/prisma"
import { getCachedSession, resolveStoreContext } from "./_shared"

export interface RevenueForecastDay {
  date: Date
  predictedRevenue: number
  p10: number | null
  p90: number | null
  modelVersion: string
  generatedAt: Date
  /** `transfer` means the row was produced by ml/transfer/hollywood_prior.py
   *  for a warming_up store; `native` means the per-store XGBoost model.
   *  When aggregating across stores, set to `transfer` if any contributing
   *  row was transfer (conservative — surfaces the caption on mixed days). */
  forecastSource: "native" | "transfer"
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
  /** When the store physically opened; null for aggregate views or for stores
   *  that haven't opened yet. Used by the W5 transfer-source caption to
   *  compute "day N of <store>" labelling. */
  openedAt: Date | null
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
  const session = await getCachedSession()
  const user = session?.user ?? null
  if (!user) return null

  const resolved = await resolveStoreContext(input.storeId, user.accountId)
  if (!resolved.ok) return resolved
  const { storeIds, storeName, storeIdOut } = resolved.ctx

  const horizonDays = input.horizonDays ?? 14
  const asOf = input.asOf ?? new Date()
  const horizonEnd = new Date(asOf)
  horizonEnd.setDate(horizonEnd.getDate() + horizonDays)

  // openedAt lookup only meaningful for a single scoped store; for aggregate
  // views the caption never renders so the value stays null.
  const storeOpenedAtPromise = storeIdOut
    ? prisma.store.findUnique({
        where: { id: storeIdOut },
        select: { openedAt: true },
      })
    : Promise.resolve(null)

  // Forecast rows and the latest training run are independent — fetch in parallel.
  const [rows, lastRun, storeRow] = await Promise.all([
    prisma.forecastDailyRevenue.findMany({
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
        forecastSource: true,
      },
    }),
    prisma.mlTrainingRun.findFirst({
      where: { target: "REVENUE", status: "SUCCEEDED", mape: { not: null } },
      orderBy: { startedAt: "desc" },
      select: { mape: true },
    }),
    storeOpenedAtPromise,
  ])

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
      forecastSource: "native" | "transfer"
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
        forecastSource: r.forecastSource,
      })
    } else {
      cur.predictedRevenue += pr
      cur.p10 += p10
      cur.p90 += p90
      if (r.generatedAt > cur.generatedAt) {
        cur.generatedAt = r.generatedAt
        cur.modelVersion = r.modelVersion
      }
      if (r.forecastSource === "transfer") {
        cur.forecastSource = "transfer"
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
      forecastSource: r.forecastSource,
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
  return {
    ok: true,
    data: {
      storeId: storeIdOut,
      storeName,
      generatedAt,
      recentMape: lastRun?.mape ?? null,
      days,
      openedAt: storeRow?.openedAt ?? null,
    },
  }
}

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}
