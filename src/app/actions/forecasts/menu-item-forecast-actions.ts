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

export interface MenuItemForecastDay {
  date: Date
  predictedQty: number
  p10: number | null
  p90: number | null
}

export interface MenuItemForecast {
  /** itemName today; will be a real Otter SKU once mapping matures. */
  otterItemSkuId: string
  totalPredicted: number
  days: MenuItemForecastDay[]
}

export interface MenuItemForecastData {
  /** Null when aggregating across all stores. */
  storeId: string | null
  storeName: string
  generatedAt: Date | null
  recentMape: number | null
  items: MenuItemForecast[]
}

export type GetMenuItemForecastResult =
  | { ok: true; data: MenuItemForecastData }
  | { ok: false; error: "store_not_in_account" }

export async function getMenuItemForecast(input: {
  storeId?: string
  horizonDays?: number
  asOf?: Date
}): Promise<GetMenuItemForecastResult | null> {
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

  const horizonDays = input.horizonDays ?? 7
  const asOf = input.asOf ?? new Date()
  const horizonEnd = new Date(asOf)
  horizonEnd.setDate(horizonEnd.getDate() + horizonDays)

  const rows = await prisma.forecastMenuItem.findMany({
    where: {
      storeId: { in: storeIds },
      forecastDate: { gte: startOfDay(asOf), lt: startOfDay(horizonEnd) },
    },
    select: {
      storeId: true,
      otterItemSkuId: true,
      forecastDate: true,
      predictedQty: true,
      p10: true,
      p90: true,
      generatedAt: true,
    },
  })

  // Latest generation per (storeId, sku, date)
  const byKey = new Map<string, (typeof rows)[number]>()
  for (const r of rows) {
    const key = `${r.storeId}|${r.otterItemSkuId}|${r.forecastDate
      .toISOString()
      .slice(0, 10)}`
    const existing = byKey.get(key)
    if (!existing || r.generatedAt > existing.generatedAt) byKey.set(key, r)
  }

  // Aggregate qty across stores per (sku, date). Same SKU id across stores
  // is intentionally merged — we want portfolio demand for each item.
  type DayBuckets = Map<string, MenuItemForecastDay>
  const itemsBucket = new Map<string, DayBuckets>()
  let latestGen: Date | null = null
  for (const r of byKey.values()) {
    if (!latestGen || r.generatedAt > latestGen) latestGen = r.generatedAt
    const dateKey = r.forecastDate.toISOString().slice(0, 10)
    const days = itemsBucket.get(r.otterItemSkuId) ?? new Map()
    const cur = days.get(dateKey)
    const pr = r.predictedQty
    const p10 = r.p10 ?? pr
    const p90 = r.p90 ?? pr
    if (!cur) {
      days.set(dateKey, {
        date: r.forecastDate,
        predictedQty: pr,
        p10,
        p90,
      })
    } else {
      cur.predictedQty += pr
      cur.p10 = (cur.p10 ?? 0) + p10
      cur.p90 = (cur.p90 ?? 0) + p90
    }
    itemsBucket.set(r.otterItemSkuId, days)
  }

  const items: MenuItemForecast[] = Array.from(itemsBucket.entries())
    .map(([sku, days]) => {
      const dayList = Array.from(days.values()).sort(
        (a, b) => a.date.getTime() - b.date.getTime(),
      )
      return {
        otterItemSkuId: sku,
        totalPredicted: dayList.reduce((s, d) => s + d.predictedQty, 0),
        days: dayList,
      }
    })
    .sort((a, b) => b.totalPredicted - a.totalPredicted)

  const lastRun = await prisma.mlTrainingRun.findFirst({
    where: { target: "MENU_ITEM", status: "SUCCEEDED", mape: { not: null } },
    orderBy: { startedAt: "desc" },
    select: { mape: true },
  })

  return {
    ok: true,
    data: {
      storeId: storeIdOut,
      storeName,
      generatedAt: latestGen,
      recentMape: lastRun?.mape ?? null,
      items,
    },
  }
}

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}
