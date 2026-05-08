"use server"

// F22 — Menu engineering classifier. Splits the menu into the four
// classic Kasavana–Smith quadrants based on a median split of velocity
// (quantity sold) and unit margin (revenue/qty − cogs/qty):
//
//   STAR      — high margin, high velocity. Front of menu, hold price.
//   PLOWHORSE — low margin,  high volume.  Reprice or trim the recipe.
//   PUZZLE    — high margin, low volume.   Reposition or rename.
//   DOG       — low margin,  low volume.   Drop or rework.
//
// Pure read over the precomputed DailyCogsItem rollups — items with no
// costed recipe never appear in DailyCogsItem and so don't appear here.
// The dashboard surfaces the missing-recipe coverage % separately so the
// operator knows the classifier's coverage.

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

export type MenuQuadrant = "STAR" | "PLOWHORSE" | "PUZZLE" | "DOG"

export interface MenuEngineeringRow {
  itemName: string
  category: string
  soldQty: number
  revenue: number
  cogs: number
  unitPrice: number
  unitCost: number
  unitMargin: number
  totalContribution: number
  marginPct: number | null
  quadrant: MenuQuadrant
}

export interface MenuEngineeringData {
  storeId: string | null
  storeName: string | null
  windowStart: Date
  windowEnd: Date
  /** Median velocity used as the high/low split. */
  medianVelocity: number
  /** Median unit margin used as the high/low split. */
  medianUnitMargin: number
  rows: MenuEngineeringRow[]
  counts: Record<MenuQuadrant, number>
  totalContribution: number
}

export type GetMenuEngineeringResult =
  | { ok: true; data: MenuEngineeringData }
  | { ok: false; error: "store_not_in_account" }

export async function getMenuEngineering(input: {
  /** Omit to roll across all stores the caller owns. */
  storeId?: string
  lookbackDays?: number
  asOf?: Date
  /** Items with fewer than this many units in the window are excluded so the
   * classifier doesn't drown in long-tail noise. */
  minSoldQty?: number
}): Promise<GetMenuEngineeringResult | null> {
  const session = (await getServerSession(authOptions)) as SessionLike | null
  const user = session?.user ?? null
  if (!user) return null

  let storeIds: string[]
  let storeName: string | null = null
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
  } else {
    const stores = await prisma.store.findMany({
      where: { accountId: user.accountId, isActive: true },
      select: { id: true },
    })
    storeIds = stores.map((s) => s.id)
  }

  const lookbackDays = input.lookbackDays ?? 30
  const minSoldQty = input.minSoldQty ?? 5
  const asOf = input.asOf ?? new Date()
  const windowEnd = startOfDay(asOf)
  const windowStart = new Date(windowEnd)
  windowStart.setUTCDate(windowStart.getUTCDate() - lookbackDays)

  const grouped = await prisma.dailyCogsItem.groupBy({
    by: ["itemName", "category"],
    where: {
      storeId: { in: storeIds },
      date: { gte: windowStart, lte: windowEnd },
    },
    _sum: { qtySold: true, salesRevenue: true, lineCost: true },
  })

  const rowsRaw = grouped
    .map((row) => {
      const soldQty = row._sum.qtySold ?? 0
      const revenue = row._sum.salesRevenue ?? 0
      const cogs = row._sum.lineCost ?? 0
      return { itemName: row.itemName, category: row.category, soldQty, revenue, cogs }
    })
    .filter((r) => r.soldQty >= minSoldQty)

  if (rowsRaw.length === 0) {
    return {
      ok: true,
      data: {
        storeId: input.storeId ?? null,
        storeName,
        windowStart,
        windowEnd,
        medianVelocity: 0,
        medianUnitMargin: 0,
        rows: [],
        counts: { STAR: 0, PLOWHORSE: 0, PUZZLE: 0, DOG: 0 },
        totalContribution: 0,
      },
    }
  }

  const velocities = rowsRaw.map((r) => r.soldQty).sort((a, b) => a - b)
  const unitMargins = rowsRaw
    .map((r) => (r.soldQty > 0 ? (r.revenue - r.cogs) / r.soldQty : 0))
    .sort((a, b) => a - b)

  const medianVelocity = median(velocities)
  const medianUnitMargin = median(unitMargins)

  const counts: Record<MenuQuadrant, number> = {
    STAR: 0,
    PLOWHORSE: 0,
    PUZZLE: 0,
    DOG: 0,
  }
  let totalContribution = 0

  const rows: MenuEngineeringRow[] = rowsRaw.map((r) => {
    const unitPrice = r.soldQty > 0 ? r.revenue / r.soldQty : 0
    const unitCost = r.soldQty > 0 ? r.cogs / r.soldQty : 0
    const unitMargin = unitPrice - unitCost
    const totalC = r.revenue - r.cogs
    totalContribution += totalC
    const highVolume = r.soldQty >= medianVelocity
    const highMargin = unitMargin >= medianUnitMargin
    const quadrant: MenuQuadrant = highVolume
      ? highMargin
        ? "STAR"
        : "PLOWHORSE"
      : highMargin
        ? "PUZZLE"
        : "DOG"
    counts[quadrant] += 1
    return {
      itemName: r.itemName,
      category: r.category,
      soldQty: r.soldQty,
      revenue: r.revenue,
      cogs: r.cogs,
      unitPrice,
      unitCost,
      unitMargin,
      totalContribution: totalC,
      marginPct: r.revenue > 0 ? (totalC / r.revenue) * 100 : null,
      quadrant,
    }
  })

  rows.sort((a, b) => b.totalContribution - a.totalContribution)

  return {
    ok: true,
    data: {
      storeId: input.storeId ?? null,
      storeName,
      windowStart,
      windowEnd,
      medianVelocity,
      medianUnitMargin,
      rows,
      counts,
      totalContribution,
    },
  }
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2
  return sorted[mid]
}

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  return out
}
