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
  storeId: string
  storeName: string
  generatedAt: Date | null
  recentMape: number | null
  items: MenuItemForecast[]
}

export type GetMenuItemForecastResult =
  | { ok: true; data: MenuItemForecastData }
  | { ok: false; error: "store_not_in_account" }

export async function getMenuItemForecast(input: {
  storeId: string
  horizonDays?: number
  asOf?: Date
}): Promise<GetMenuItemForecastResult | null> {
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

  const horizonDays = input.horizonDays ?? 7
  const asOf = input.asOf ?? new Date()
  const horizonEnd = new Date(asOf)
  horizonEnd.setDate(horizonEnd.getDate() + horizonDays)

  const rows = await prisma.forecastMenuItem.findMany({
    where: {
      storeId: input.storeId,
      forecastDate: { gte: startOfDay(asOf), lt: startOfDay(horizonEnd) },
    },
    orderBy: [{ otterItemSkuId: "asc" }, { forecastDate: "asc" }, { generatedAt: "desc" }],
    select: {
      otterItemSkuId: true,
      forecastDate: true,
      predictedQty: true,
      p10: true,
      p90: true,
      generatedAt: true,
    },
  })

  // Latest generation per (sku, date)
  const byKey = new Map<string, (typeof rows)[number]>()
  for (const r of rows) {
    const key = `${r.otterItemSkuId}|${r.forecastDate.toISOString().slice(0, 10)}`
    const existing = byKey.get(key)
    if (!existing || r.generatedAt > existing.generatedAt) byKey.set(key, r)
  }

  const itemsBucket = new Map<string, MenuItemForecastDay[]>()
  let latestGen: Date | null = null
  for (const r of byKey.values()) {
    if (!latestGen || r.generatedAt > latestGen) latestGen = r.generatedAt
    const list = itemsBucket.get(r.otterItemSkuId) ?? []
    list.push({
      date: r.forecastDate,
      predictedQty: r.predictedQty,
      p10: r.p10,
      p90: r.p90,
    })
    itemsBucket.set(r.otterItemSkuId, list)
  }

  const items: MenuItemForecast[] = Array.from(itemsBucket.entries())
    .map(([sku, days]) => ({
      otterItemSkuId: sku,
      totalPredicted: days.reduce((s, d) => s + d.predictedQty, 0),
      days: days.sort((a, b) => a.date.getTime() - b.date.getTime()),
    }))
    .sort((a, b) => b.totalPredicted - a.totalPredicted)

  const lastRun = await prisma.mlTrainingRun.findFirst({
    where: { target: "MENU_ITEM", status: "SUCCEEDED", mape: { not: null } },
    orderBy: { startedAt: "desc" },
    select: { mape: true },
  })

  return {
    ok: true,
    data: {
      storeId: store.id,
      storeName: store.name,
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
