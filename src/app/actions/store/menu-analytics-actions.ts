"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { todayInLA, startOfDayLA, endOfDayLA } from "@/lib/dashboard-utils"
import { shapeMenuCategoryAnalytics } from "@/lib/menu-category-analytics-aggregation"
import { getStores } from "./crud-actions"

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

export async function getMenuCategoryAnalytics(
  storeId?: string,
  options?: { days?: number; startDate?: string; endDate?: string }
): Promise<import("@/types/analytics").MenuCategoryData | null> {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return null

    const stores = await getStores()
    if (stores.length === 0) return null

    const storeIds = storeId ? [storeId] : stores.map((s) => s.id)

    const days = options?.days ?? 30
    let rangeStart: Date
    let rangeEnd: Date

    if (options?.startDate && options?.endDate) {
      rangeStart = new Date(options.startDate + "T00:00:00Z")
      rangeEnd = new Date(options.endDate + "T23:59:59.999Z")
    } else {
      const today = todayInLA()
      rangeEnd = endOfDayLA(today)
      if (days === 1) {
        rangeStart = startOfDayLA(today)
      } else if (days === -1) {
        const yday = startOfDayLA(today)
        yday.setDate(yday.getDate() - 1)
        rangeStart = yday
        rangeEnd = new Date(yday.getTime() + 24 * 60 * 60 * 1000 - 1)
      } else {
        const start = startOfDayLA(today)
        start.setDate(start.getDate() - days)
        rangeStart = start
      }
    }

    const whereDateRange = {
      storeId: { in: storeIds },
      date: { gte: rangeStart, lte: rangeEnd },
    } as const

    const [categoryAggs, itemAggs] = await Promise.all([
      prisma.otterMenuCategory.groupBy({
        by: ["category"],
        where: whereDateRange,
        _sum: {
          fpQuantitySold: true,
          fpTotalInclModifiers: true,
          fpTotalSales: true,
          tpQuantitySold: true,
          tpTotalInclModifiers: true,
          tpTotalSales: true,
        },
      }),
      prisma.otterMenuItem.groupBy({
        by: ["category", "itemName"],
        where: whereDateRange,
        _sum: {
          fpQuantitySold: true,
          fpTotalInclModifiers: true,
          fpTotalSales: true,
          tpQuantitySold: true,
          tpTotalInclModifiers: true,
          tpTotalSales: true,
        },
      }),
    ])

    if (categoryAggs.length === 0) return null

    const shaped = shapeMenuCategoryAnalytics(
      categoryAggs.map((c) => ({
        category: c.category,
        fpQuantitySold: c._sum.fpQuantitySold ?? 0,
        fpTotalInclModifiers: c._sum.fpTotalInclModifiers ?? 0,
        fpTotalSales: c._sum.fpTotalSales ?? 0,
        tpQuantitySold: c._sum.tpQuantitySold ?? 0,
        tpTotalInclModifiers: c._sum.tpTotalInclModifiers ?? 0,
        tpTotalSales: c._sum.tpTotalSales ?? 0,
      })),
      itemAggs.map((i) => ({
        category: i.category,
        itemName: i.itemName,
        fpQuantitySold: i._sum.fpQuantitySold ?? 0,
        fpTotalInclModifiers: i._sum.fpTotalInclModifiers ?? 0,
        fpTotalSales: i._sum.fpTotalSales ?? 0,
        tpQuantitySold: i._sum.tpQuantitySold ?? 0,
        tpTotalInclModifiers: i._sum.tpTotalInclModifiers ?? 0,
        tpTotalSales: i._sum.tpTotalSales ?? 0,
      })),
    )

    return {
      categories: shaped.categories,
      totals: shaped.totals,
      dateRange: {
        startDate: rangeStart.toISOString().split("T")[0],
        endDate: rangeEnd.toISOString().split("T")[0],
      },
    }
  } catch (error) {
    console.error("Get menu category analytics error:", error)
    return null
  }
}

export async function getProductMixData(
  storeId?: string,
  options?: { days?: number; startDate?: string; endDate?: string }
): Promise<import("@/types/analytics").ProductMixData | null> {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return null

    const stores = await getStores()
    if (stores.length === 0) return null

    const storeIds = storeId ? [storeId] : stores.map((s) => s.id)

    const days = options?.days ?? 7
    let rangeStart: Date
    let rangeEnd: Date

    if (options?.startDate && options?.endDate) {
      rangeStart = new Date(options.startDate + "T00:00:00Z")
      rangeEnd = new Date(options.endDate + "T23:59:59.999Z")
    } else {
      const today = todayInLA()
      rangeEnd = endOfDayLA(today)
      if (days === 1) {
        rangeStart = startOfDayLA(today)
      } else if (days === -1) {
        const yday = startOfDayLA(today)
        yday.setDate(yday.getDate() - 1)
        rangeStart = yday
        rangeEnd = new Date(yday.getTime() + 24 * 60 * 60 * 1000 - 1)
      } else {
        const start = startOfDayLA(today)
        start.setDate(start.getDate() - days)
        rangeStart = start
      }
    }

    const dayCount = Math.max(1, Math.ceil(
      (rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24)
    ))

    const [categories, items] = await Promise.all([
      prisma.otterMenuCategory.findMany({
        where: {
          storeId: { in: storeIds },
          date: { gte: rangeStart, lte: rangeEnd },
        },
      }),
      prisma.otterMenuItem.findMany({
        where: {
          storeId: { in: storeIds },
          date: { gte: rangeStart, lte: rangeEnd },
        },
      }),
    ])

    if (items.length === 0 && categories.length === 0) return null

    const prevEnd = new Date(rangeStart)
    prevEnd.setDate(prevEnd.getDate() - 1)
    const prevStart = new Date(prevEnd)
    prevStart.setDate(prevStart.getDate() - dayCount)
    prevStart.setHours(0, 0, 0, 0)

    const prevItems = await prisma.otterMenuItem.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: prevStart, lte: prevEnd },
      },
    })

    const itemKey = (cat: string, item: string) => `${cat}|||${item}`
    type AggItem = {
      itemName: string
      category: string
      fpQuantitySold: number
      tpQuantitySold: number
      fpSales: number
      tpSales: number
      fpTotalInclModifiers: number
      tpTotalInclModifiers: number
      totalQuantitySold: number
      totalSales: number
      totalInclModifiers: number
    }
    const itemMap = new Map<string, AggItem>()
    for (const i of items) {
      const key = itemKey(i.category, i.itemName)
      const existing = itemMap.get(key)
      if (existing) {
        existing.fpQuantitySold += i.fpQuantitySold
        existing.tpQuantitySold += i.tpQuantitySold
        existing.fpSales += i.fpTotalSales
        existing.tpSales += i.tpTotalSales
        existing.fpTotalInclModifiers += i.fpTotalInclModifiers
        existing.tpTotalInclModifiers += i.tpTotalInclModifiers
        existing.totalQuantitySold += i.fpQuantitySold + i.tpQuantitySold
        existing.totalSales += i.fpTotalSales + i.tpTotalSales
        existing.totalInclModifiers += i.fpTotalInclModifiers + i.tpTotalInclModifiers
      } else {
        itemMap.set(key, {
          itemName: i.itemName,
          category: i.category,
          fpQuantitySold: i.fpQuantitySold,
          tpQuantitySold: i.tpQuantitySold,
          fpSales: i.fpTotalSales,
          tpSales: i.tpTotalSales,
          fpTotalInclModifiers: i.fpTotalInclModifiers,
          tpTotalInclModifiers: i.tpTotalInclModifiers,
          totalQuantitySold: i.fpQuantitySold + i.tpQuantitySold,
          totalSales: i.fpTotalSales + i.tpTotalSales,
          totalInclModifiers: i.fpTotalInclModifiers + i.tpTotalInclModifiers,
        })
      }
    }

    const prevMap = new Map<string, { totalQuantitySold: number; totalSales: number }>()
    for (const i of prevItems) {
      const key = itemKey(i.category, i.itemName)
      const existing = prevMap.get(key)
      if (existing) {
        existing.totalQuantitySold += i.fpQuantitySold + i.tpQuantitySold
        existing.totalSales += i.fpTotalSales + i.tpTotalSales
      } else {
        prevMap.set(key, {
          totalQuantitySold: i.fpQuantitySold + i.tpQuantitySold,
          totalSales: i.fpTotalSales + i.tpTotalSales,
        })
      }
    }

    const allItems = Array.from(itemMap.values()).filter(i => i.totalQuantitySold > 0)
    const grandTotalRevenue = allItems.reduce((s, i) => s + i.totalSales, 0)
    const grandTotalModifierRev = allItems.reduce(
      (s, i) => s + Math.max(0, i.totalInclModifiers - i.totalSales), 0
    )
    const grandTotalQty = allItems.reduce((s, i) => s + i.totalQuantitySold, 0)

    const catItemsMap = new Map<string, AggItem[]>()
    for (const item of allItems) {
      const arr = catItemsMap.get(item.category) ?? []
      arr.push(item)
      catItemsMap.set(item.category, arr)
    }

    const treemapChildren: import("@/types/analytics").TreemapCategoryNode[] = []
    for (const [catName, catItems] of catItemsMap) {
      const sorted = catItems.sort((a, b) => b.totalSales - a.totalSales)
      const catTotal = sorted.reduce((s, i) => s + i.totalSales, 0)
      const children: import("@/types/analytics").TreemapItemNode[] = []
      let otherRevenue = 0
      let otherQty = 0

      for (const item of sorted) {
        if (item.totalSales / catTotal < 0.02 && children.length >= 8) {
          otherRevenue += item.totalSales
          otherQty += item.totalQuantitySold
        } else {
          children.push({
            name: item.itemName,
            value: item.totalSales,
            category: catName,
            quantity: item.totalQuantitySold,
            avgPrice: item.totalSales / item.totalQuantitySold,
          })
        }
      }

      if (otherRevenue > 0) {
        children.push({
          name: "Other",
          value: otherRevenue,
          category: catName,
          quantity: otherQty,
          avgPrice: otherQty > 0 ? otherRevenue / otherQty : 0,
        })
      }

      treemapChildren.push({ name: catName, children })
    }
    treemapChildren.sort((a, b) => {
      const aTotal = a.children.reduce((s, c) => s + c.value, 0)
      const bTotal = b.children.reduce((s, c) => s + c.value, 0)
      return bTotal - aTotal
    })

    const treemap: import("@/types/analytics").TreemapData = {
      name: "Menu",
      children: treemapChildren,
    }

    const sortedByRevenue = [...allItems].sort((a, b) => b.totalSales - a.totalSales)
    let cumulative = 0
    const paretoItems: import("@/types/analytics").ParetoItem[] = sortedByRevenue.map((item) => {
      cumulative += item.totalSales
      const cumulativePercent = grandTotalRevenue > 0 ? (cumulative / grandTotalRevenue) * 100 : 0
      const abcClass = cumulativePercent <= 80 ? "A" as const
        : cumulativePercent <= 95 ? "B" as const
        : "C" as const
      return {
        itemName: item.itemName,
        category: item.category,
        revenue: item.totalSales,
        cumulativeRevenue: cumulative,
        cumulativePercent,
        abcClass,
      }
    })

    const quantities = allItems.map(i => i.totalQuantitySold)
    const avgPrices = allItems.map(i => i.totalSales / i.totalQuantitySold)
    const medianQuantity = median(quantities)
    const medianAvgPrice = median(avgPrices)

    const matrixItems: import("@/types/analytics").MatrixItem[] = allItems.map((item) => {
      const avgPrice = item.totalSales / item.totalQuantitySold
      const isHighQty = item.totalQuantitySold >= medianQuantity
      const isHighPrice = avgPrice >= medianAvgPrice
      let quadrant: "star" | "workhorse" | "puzzle" | "dog"
      if (isHighQty && isHighPrice) quadrant = "star"
      else if (isHighQty && !isHighPrice) quadrant = "workhorse"
      else if (!isHighQty && isHighPrice) quadrant = "puzzle"
      else quadrant = "dog"

      return {
        itemName: item.itemName,
        category: item.category,
        quantitySold: item.totalQuantitySold,
        avgPrice,
        revenue: item.totalSales,
        quadrant,
      }
    })

    const tableCategories: import("@/types/analytics").ProductMixTableCategory[] = []
    for (const [catName, catItems] of catItemsMap) {
      const catTotalRevenue = catItems.reduce((s, i) => s + i.totalSales, 0)
      const catTotalQty = catItems.reduce((s, i) => s + i.totalQuantitySold, 0)
      const catTotalModRev = catItems.reduce(
        (s, i) => s + Math.max(0, i.totalInclModifiers - i.totalSales), 0
      )

      let prevCatQty = 0
      for (const item of catItems) {
        const prev = prevMap.get(itemKey(item.category, item.itemName))
        if (prev) prevCatQty += prev.totalQuantitySold
      }

      const tableItems: import("@/types/analytics").ProductMixTableItem[] = catItems
        .sort((a, b) => b.totalSales - a.totalSales)
        .map((item) => {
          const modRev = Math.max(0, item.totalInclModifiers - item.totalSales)
          const prev = prevMap.get(itemKey(item.category, item.itemName))
          let periodChange: number | null = null
          if (prev && prev.totalQuantitySold > 0) {
            periodChange = ((item.totalQuantitySold - prev.totalQuantitySold) / prev.totalQuantitySold) * 100
          }

          return {
            itemName: item.itemName,
            category: item.category,
            quantitySold: item.totalQuantitySold,
            revenue: item.totalSales,
            modifierRevenue: modRev,
            avgPrice: item.totalSales / item.totalQuantitySold,
            percentOfCategoryRevenue: catTotalRevenue > 0 ? (item.totalSales / catTotalRevenue) * 100 : 0,
            percentOfTotalRevenue: grandTotalRevenue > 0 ? (item.totalSales / grandTotalRevenue) * 100 : 0,
            fpQuantitySold: item.fpQuantitySold,
            tpQuantitySold: item.tpQuantitySold,
            fpSales: item.fpSales,
            tpSales: item.tpSales,
            periodChange,
          }
        })

      tableCategories.push({
        category: catName,
        items: tableItems,
        quantitySold: catTotalQty,
        revenue: catTotalRevenue,
        modifierRevenue: catTotalModRev,
        percentOfTotalRevenue: grandTotalRevenue > 0 ? (catTotalRevenue / grandTotalRevenue) * 100 : 0,
        fpQuantitySold: catItems.reduce((s, i) => s + i.fpQuantitySold, 0),
        tpQuantitySold: catItems.reduce((s, i) => s + i.tpQuantitySold, 0),
        fpSales: catItems.reduce((s, i) => s + i.fpSales, 0),
        tpSales: catItems.reduce((s, i) => s + i.tpSales, 0),
        periodChange: prevCatQty > 0 ? ((catTotalQty - prevCatQty) / prevCatQty) * 100 : null,
      })
    }
    tableCategories.sort((a, b) => b.revenue - a.revenue)

    const aClassCount = paretoItems.filter(i => i.abcClass === "A").length
    const aClassPct = paretoItems.length > 0
      ? Math.round((aClassCount / paretoItems.length) * 100)
      : 0

    const modPct = grandTotalRevenue > 0
      ? ((grandTotalModifierRev / (grandTotalRevenue + grandTotalModifierRev)) * 100)
      : 0

    const declinedItems = allItems.filter(item => {
      const prev = prevMap.get(itemKey(item.category, item.itemName))
      if (!prev || prev.totalQuantitySold === 0) return false
      return ((item.totalQuantitySold - prev.totalQuantitySold) / prev.totalQuantitySold) * 100 < -20
    }).length

    const grewItems = allItems.filter(item => {
      const prev = prevMap.get(itemKey(item.category, item.itemName))
      if (!prev || prev.totalQuantitySold === 0) return false
      return ((item.totalQuantitySold - prev.totalQuantitySold) / prev.totalQuantitySold) * 100 > 20
    }).length

    const quadrantCounts = { star: 0, workhorse: 0, puzzle: 0, dog: 0 }
    for (const m of matrixItems) quadrantCounts[m.quadrant]++

    const insights: import("@/types/analytics").QuickInsight[] = []
    if (aClassCount > 0) {
      insights.push({
        id: "pareto",
        text: `Top ${aClassCount} items (${aClassPct}%) generate 80% of revenue`,
        type: "info",
      })
    }
    if (grandTotalModifierRev > 0) {
      insights.push({
        id: "modifiers",
        text: `Modifier revenue: $${grandTotalModifierRev.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} (${modPct.toFixed(1)}% of total)`,
        type: "info",
      })
    }
    if (declinedItems > 0) {
      insights.push({
        id: "declined",
        text: `${declinedItems} item${declinedItems > 1 ? "s" : ""} declined >20% vs prior period`,
        type: "negative",
      })
    }
    if (grewItems > 0) {
      insights.push({
        id: "grew",
        text: `${grewItems} item${grewItems > 1 ? "s" : ""} grew >20% vs prior period`,
        type: "positive",
      })
    }
    insights.push({
      id: "matrix",
      text: `Stars: ${quadrantCounts.star}, Workhorses: ${quadrantCounts.workhorse}, Puzzles: ${quadrantCounts.puzzle}, Dogs: ${quadrantCounts.dog}`,
      type: "info",
    })

    type MoverCandidate = {
      itemName: string
      category: string
      currentQuantity: number
      previousQuantity: number
      currentRevenue: number
      previousRevenue: number
    }
    const moverCandidates: MoverCandidate[] = []
    for (const item of allItems) {
      const prev = prevMap.get(itemKey(item.category, item.itemName))
      if (!prev || prev.totalQuantitySold === 0) continue
      moverCandidates.push({
        itemName: item.itemName,
        category: item.category,
        currentQuantity: item.totalQuantitySold,
        previousQuantity: prev.totalQuantitySold,
        currentRevenue: item.totalSales,
        previousRevenue: prev.totalSales,
      })
    }

    const toMover = (c: MoverCandidate): import("@/types/analytics").MoverItem => ({
      ...c,
      quantityChange: c.currentQuantity - c.previousQuantity,
      quantityChangePercent: ((c.currentQuantity - c.previousQuantity) / c.previousQuantity) * 100,
      revenueChange: c.currentRevenue - c.previousRevenue,
      revenueChangePercent: c.previousRevenue > 0
        ? ((c.currentRevenue - c.previousRevenue) / c.previousRevenue) * 100
        : 0,
    })

    const risers = moverCandidates
      .filter(c => c.currentQuantity > c.previousQuantity)
      .sort((a, b) => {
        const aPct = (a.currentQuantity - a.previousQuantity) / a.previousQuantity
        const bPct = (b.currentQuantity - b.previousQuantity) / b.previousQuantity
        return bPct - aPct
      })
      .slice(0, 5)
      .map(toMover)

    const decliners = moverCandidates
      .filter(c => c.currentQuantity < c.previousQuantity)
      .sort((a, b) => {
        const aPct = (a.currentQuantity - a.previousQuantity) / a.previousQuantity
        const bPct = (b.currentQuantity - b.previousQuantity) / b.previousQuantity
        return aPct - bPct
      })
      .slice(0, 5)
      .map(toMover)

    return {
      treemap,
      insights,
      paretoItems,
      matrixItems,
      matrixThresholds: { medianQuantity, medianAvgPrice },
      tableCategories,
      tableTotals: {
        quantitySold: grandTotalQty,
        revenue: grandTotalRevenue,
        modifierRevenue: grandTotalModifierRev,
      },
      risers,
      decliners,
      dateRange: {
        startDate: rangeStart.toISOString().split("T")[0],
        endDate: rangeEnd.toISOString().split("T")[0],
      },
      dayCount,
    }
  } catch (error) {
    console.error("Get product mix data error:", error)
    return null
  }
}
