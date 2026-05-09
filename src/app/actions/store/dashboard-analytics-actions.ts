"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { todayInLA, startOfDayLA, endOfDayLA } from "@/lib/dashboard-utils"
import { cached, stableKey } from "@/lib/cache/cached"
import { aggregateChannelTotals } from "@/lib/otter-analytics-aggregation"
import { getStores } from "./crud-actions"

export async function getOtterAnalytics(
  storeId?: string,
  options?: { days?: number; startDate?: string; endDate?: string }
): Promise<import("@/types/analytics").StoreAnalyticsData | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  const accountId = session.user.accountId

  return cached(
    `otter:account:${accountId}:${stableKey({ storeId, ...(options ?? {}) })}`,
    300,
    ["otter", `account:${accountId}`],
    async () => {
  try {
    const stores = await getStores()
    if (stores.length === 0) {
      return null
    }

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

    const dayCount = Math.max(1, Math.ceil(
      (rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24)
    ))

    const summaries = await prisma.otterDailySummary.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: rangeStart, lte: rangeEnd },
      },
      orderBy: { date: "asc" },
    })

    if (summaries.length === 0) {
      return null
    }

    const prevEnd = new Date(rangeStart)
    prevEnd.setDate(prevEnd.getDate() - 1)
    const prevStart = new Date(prevEnd)
    prevStart.setDate(prevStart.getDate() - dayCount)
    prevStart.setHours(0, 0, 0, 0)

    const prevSummaries = await prisma.otterDailySummary.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: prevStart, lte: prevEnd },
      },
    })

    const sum = (rows: typeof summaries, fn: (r: (typeof summaries)[0]) => number) =>
      rows.reduce((acc, r) => acc + fn(r), 0)

    const isFPPlatform = (p: string) => p === "css-pos" || p === "bnm-web"
    const gross = (r: (typeof summaries)[0]) => (r.fpGrossSales ?? 0) + (r.tpGrossSales ?? 0)
    const net = (r: (typeof summaries)[0]) => (r.fpNetSales ?? 0) + (r.tpNetSales ?? 0)

    const totalOrders = sum(summaries, (r) => (r.fpOrderCount ?? 0) + (r.tpOrderCount ?? 0))
    const grossRevenue = sum(summaries, gross)
    const kpis = {
      grossRevenue,
      netRevenue: sum(summaries, net),
      totalOrders,
      averageOrderValue: totalOrders > 0 ? grossRevenue / totalOrders : 0,
      totalFees: sum(summaries, (r) => (r.fpFees ?? 0) + (r.tpFees ?? 0)),
      totalTips: sum(summaries, (r) => (r.fpTips ?? 0) + (r.tpTipForRestaurant ?? 0)),
      totalDiscounts: sum(summaries, (r) => (r.fpDiscounts ?? 0) + (r.tpDiscounts ?? 0)),
      totalTaxCollected: sum(summaries, (r) => (r.fpTaxCollected ?? 0) + (r.tpTaxCollected ?? 0)),
      totalTaxRemitted: sum(summaries, (r) => (r.fpTaxRemitted ?? 0) + (r.tpTaxRemitted ?? 0)),
      totalServiceCharges: sum(summaries, (r) => (r.fpServiceCharges ?? 0) + (r.tpServiceCharges ?? 0)),
      totalLoyalty: sum(summaries, (r) => (r.fpLoyalty ?? 0) + (r.tpLoyaltyDiscount ?? 0)),
      totalRefundsAdjustments: sum(summaries, (r) => r.tpRefundsAdjustments ?? 0),
      totalLostRevenue: sum(summaries, (r) => r.fpLostRevenue ?? 0),
      tillPaidIn: sum(summaries, (r) => r.tillPaidIn ?? 0),
      tillPaidOut: sum(summaries, (r) => r.tillPaidOut ?? 0),
      tillNet: sum(summaries, (r) => (r.tillPaidIn ?? 0) - (r.tillPaidOut ?? 0)),
    }

    const currentGross = kpis.grossRevenue
    const previousGross = sum(prevSummaries, gross)
    const currentNet = kpis.netRevenue
    const previousNet = sum(prevSummaries, net)

    const comparison = {
      currentGross,
      previousGross,
      currentNet,
      previousNet,
      grossGrowth: previousGross > 0
        ? ((currentGross - previousGross) / previousGross) * 100
        : 0,
      netGrowth: previousNet > 0
        ? ((currentNet - previousNet) / previousNet) * 100
        : 0,
    }

    const byDate: Record<string, { grossRevenue: number; netRevenue: number; fpGross: number; tpGross: number; cashSales: number; cardSales: number }> = {}
    for (const r of summaries) {
      const dateStr = r.date.toISOString().split("T")[0]
      if (!byDate[dateStr]) {
        byDate[dateStr] = { grossRevenue: 0, netRevenue: 0, fpGross: 0, tpGross: 0, cashSales: 0, cardSales: 0 }
      }
      const d = byDate[dateStr]
      const isFP = isFPPlatform(r.platform)
      const rowGross = Number(isFP ? (r.fpGrossSales ?? 0) : (r.tpGrossSales ?? 0))
      const rowNet = Number(isFP ? (r.fpNetSales ?? 0) : (r.tpNetSales ?? 0))
      d.grossRevenue += rowGross
      d.netRevenue += rowNet
      if (isFP) {
        d.fpGross += rowGross
        if (r.paymentMethod === "CASH") d.cashSales += r.fpGrossSales ?? 0
        if (r.paymentMethod === "CARD") d.cardSales += r.fpGrossSales ?? 0
      } else {
        d.tpGross += rowGross
      }
    }

    const dailyTrends = Object.entries(byDate)
      .map(([date, vals]) => ({ date, ...vals }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const byDatePlatform: Record<string, Record<string, number>> = {}
    for (const r of summaries) {
      const dateStr = r.date.toISOString().split("T")[0]
      if (!byDatePlatform[dateStr]) byDatePlatform[dateStr] = {}
      const isFP = isFPPlatform(r.platform)
      const rowGross = isFP ? (r.fpGrossSales ?? 0) : (r.tpGrossSales ?? 0)
      byDatePlatform[dateStr][r.platform] = (byDatePlatform[dateStr][r.platform] ?? 0) + rowGross
    }
    const platformTrends: import("@/types/analytics").PlatformTrendPoint[] = []
    for (const [date, platforms] of Object.entries(byDatePlatform)) {
      for (const [platform, grossSales] of Object.entries(platforms)) {
        if (grossSales > 0) platformTrends.push({ date, platform, grossSales })
      }
    }
    platformTrends.sort((a, b) => a.date.localeCompare(b.date))

    const channelTotals = aggregateChannelTotals(summaries)
    const platformBreakdown: import("@/types/analytics").PlatformBreakdown[] = []
    for (const totals of channelTotals.values()) {
      if (totals.grossSales <= 0 && totals.netSales <= 0) continue
      platformBreakdown.push({
        platform: totals.platform,
        paymentMethod: totals.paymentMethod,
        grossSales: totals.grossSales,
        netSales: totals.netSales,
        fees: totals.fees,
        discounts: totals.discounts,
        taxCollected: totals.taxCollected,
        taxRemitted: totals.taxRemitted,
        tips: totals.tips,
        serviceCharges: totals.serviceCharges,
        loyalty: totals.loyalty,
        refundsAdjustments: totals.refundsAdjustments,
        orderCount: totals.orderCount,
        paidIn: totals.paidIn,
        paidOut: totals.paidOut,
        theoreticalDeposit: totals.theoreticalDeposit,
        cashDrawerRecon: null as number | null,
        expectedDeposit: totals.expectedDeposit,
      })
    }

    platformBreakdown.sort((a, b) => {
      const aFP = isFPPlatform(a.platform) ? 0 : 1
      const bFP = isFPPlatform(b.platform) ? 0 : 1
      if (aFP !== bFP) return aFP - bFP
      const cmp = a.platform.localeCompare(b.platform)
      if (cmp !== 0) return cmp
      return (a.paymentMethod ?? "").localeCompare(b.paymentMethod ?? "")
    })

    const cashSales = sum(
      summaries.filter((r) => r.paymentMethod === "CASH"),
      (r) => r.fpGrossSales ?? 0
    )
    const cardSales = sum(
      summaries.filter((r) => r.paymentMethod === "CARD"),
      (r) => r.fpGrossSales ?? 0
    )

    const otterStores = await prisma.otterStore.findMany({
      where: { storeId: { in: storeIds } },
      select: { lastSyncAt: true },
      orderBy: { lastSyncAt: "desc" },
    })
    const lastSyncAt = otterStores[0]?.lastSyncAt ?? null

    return {
      kpis,
      comparison,
      dailyTrends,
      platformBreakdown,
      paymentSplit: { cashSales, cardSales },
      platformTrends,
      dateRange: {
        startDate: rangeStart.toISOString().split("T")[0],
        endDate: rangeEnd.toISOString().split("T")[0],
      },
      dayCount,
      lastSyncAt,
    }
  } catch (error) {
    console.error("Get Otter analytics error:", error)
    return null
  }
    },
  )
}

export async function getRevenueTrendData(
  options?: { days?: number }
): Promise<{ dailyTrends: import("@/types/analytics").DailyTrend[] } | null> {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return null

    const stores = await getStores()
    if (stores.length === 0) return null

    const storeIds = stores.map((s) => s.id)
    const days = options?.days ?? 7

    const today = todayInLA()
    const rangeEnd = endOfDayLA(today)
    const rangeStart = startOfDayLA(today)
    rangeStart.setDate(rangeStart.getDate() - days)

    const summaries = await prisma.otterDailySummary.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: rangeStart, lte: rangeEnd },
      },
      select: {
        date: true,
        platform: true,
        paymentMethod: true,
        fpGrossSales: true,
        fpNetSales: true,
        tpGrossSales: true,
        tpNetSales: true,
      },
      orderBy: { date: "asc" },
    })

    if (summaries.length === 0) return null

    const isFPPlatform = (p: string) => p === "css-pos" || p === "bnm-web"

    const byDate: Record<string, { grossRevenue: number; netRevenue: number; fpGross: number; tpGross: number; cashSales: number; cardSales: number }> = {}
    for (const r of summaries) {
      const dateStr = r.date.toISOString().split("T")[0]
      if (!byDate[dateStr]) {
        byDate[dateStr] = { grossRevenue: 0, netRevenue: 0, fpGross: 0, tpGross: 0, cashSales: 0, cardSales: 0 }
      }
      const d = byDate[dateStr]
      const isFP = isFPPlatform(r.platform)
      const rowGross = Number(isFP ? (r.fpGrossSales ?? 0) : (r.tpGrossSales ?? 0))
      const rowNet = Number(isFP ? (r.fpNetSales ?? 0) : (r.tpNetSales ?? 0))
      d.grossRevenue += rowGross
      d.netRevenue += rowNet
      if (isFP) {
        d.fpGross += rowGross
        if (r.paymentMethod === "CASH") d.cashSales += r.fpGrossSales ?? 0
        if (r.paymentMethod === "CARD") d.cardSales += r.fpGrossSales ?? 0
      } else {
        d.tpGross += rowGross
      }
    }

    const dailyTrends = Object.entries(byDate)
      .map(([date, vals]) => ({ date, ...vals }))
      .sort((a, b) => b.date.localeCompare(a.date))

    return { dailyTrends }
  } catch (error) {
    console.error("Get revenue trend data error:", error)
    return null
  }
}

export async function getDashboardAnalytics(
  options?: { days?: number; startDate?: string; endDate?: string }
): Promise<import("@/types/analytics").DashboardData | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  const accountId = session.user.accountId

  return cached(
    `dash:account:${accountId}:${stableKey(options ?? {})}`,
    300,
    ["dash", `account:${accountId}`],
    async () => {
  try {
    const stores = await getStores()
    if (stores.length === 0) return null

    const storeIds = stores.map((s) => s.id)

    const days = options?.days ?? 1
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

    const summaries = await prisma.otterDailySummary.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: rangeStart, lte: rangeEnd },
      },
    })

    const storeMap = new Map(stores.map((s) => [s.id, s.name]))
    const byStore: Record<string, typeof summaries> = {}
    for (const row of summaries) {
      if (!byStore[row.storeId]) byStore[row.storeId] = []
      byStore[row.storeId].push(row)
    }

    const buildRow = (
      storeId: string,
      storeName: string,
      rows: typeof summaries
    ): import("@/types/analytics").StoreSummaryRow => {
      const s = (fn: (r: (typeof rows)[0]) => number) =>
        rows.reduce((acc, r) => acc + fn(r), 0)

      const grossSales = s((r) => (r.fpGrossSales ?? 0) + (r.tpGrossSales ?? 0))
      const fulfilledOrders = s((r) => (r.fpOrderCount ?? 0) + (r.tpOrderCount ?? 0))
      const discounts = s((r) => (r.fpDiscounts ?? 0) + (r.tpDiscounts ?? 0))
      const loyalty = s((r) => (r.fpLoyalty ?? 0) + (r.tpLoyaltyDiscount ?? 0))
      const refundsAdjustments = s((r) => r.tpRefundsAdjustments ?? 0)
      const netSales = s((r) => (r.fpNetSales ?? 0) + (r.tpNetSales ?? 0))
      const serviceCharges = s((r) => (r.fpServiceCharges ?? 0) + (r.tpServiceCharges ?? 0))
      const commissionFees = s((r) => (r.fpFees ?? 0) + (r.tpFees ?? 0))
      const taxCollected = s((r) => (r.fpTaxCollected ?? 0) + (r.tpTaxCollected ?? 0))
      const taxRemitted = s((r) => (r.fpTaxRemitted ?? 0) + (r.tpTaxRemitted ?? 0))
      const tips = s((r) => (r.fpTips ?? 0) + (r.tpTipForRestaurant ?? 0))
      const paidIn = s((r) => r.tillPaidIn ?? 0)
      const paidOut = s((r) => r.tillPaidOut ?? 0)

      if (taxRemitted > 0 || commissionFees > 0 || paidOut > 0) {
        console.warn(
          "[store-actions] Otter sign-convention drift detected for store=%s: " +
            "taxRemitted=%s commissionFees=%s paidOut=%s — deposit formula assumes <= 0",
          storeId,
          taxRemitted,
          commissionFees,
          paidOut
        )
      }

      const theoreticalDeposit =
        netSales + taxCollected + taxRemitted + tips + serviceCharges + commissionFees

      const cashDrawerRecon = null

      const expectedDeposit = theoreticalDeposit + paidIn + paidOut

      return {
        storeId,
        storeName,
        grossSales,
        fulfilledOrders,
        discounts,
        loyalty,
        refundsAdjustments,
        netSales,
        serviceCharges,
        commissionFees,
        taxCollected,
        taxRemitted,
        tips,
        paidIn,
        paidOut,
        theoreticalDeposit,
        cashDrawerRecon,
        expectedDeposit,
      }
    }

    const rows: import("@/types/analytics").StoreSummaryRow[] = []
    for (const storeId of storeIds) {
      const name = storeMap.get(storeId) ?? "Unknown"
      const storeRows = byStore[storeId] ?? []
      rows.push(buildRow(storeId, name, storeRows))
    }

    const totals = buildRow("total", "TOTAL", summaries)

    const isFPPlatform = (p: string) => p === "css-pos" || p === "bnm-web"
    const PLATFORM_LABELS: Record<string, string> = {
      "css-pos": "Otter POS",
      "bnm-web": "Otter Online Ordering",
      doordash: "DoorDash",
      ubereats: "Uber Eats",
      grubhub: "Grubhub",
      caviar: "Caviar",
    }

    const summariesByChannel = new Map<string, typeof summaries>()
    for (const row of summaries) {
      const isFP = isFPPlatform(row.platform)
      const pm = isFP && row.paymentMethod && row.paymentMethod !== "N/A"
        ? row.paymentMethod
        : ""
      const key = `${row.platform}|||${pm}`
      let bucket = summariesByChannel.get(key)
      if (!bucket) {
        bucket = []
        summariesByChannel.set(key, bucket)
      }
      bucket.push(row)
    }

    const channelRows: import("@/types/analytics").StoreSummaryRow[] = []
    for (const [key, channelSummaries] of summariesByChannel) {
      const [platform, pmRaw] = key.split("|||")
      const paymentMethod = pmRaw || null
      const baseLabel = PLATFORM_LABELS[platform] ?? platform
      const channelLabel = paymentMethod ? `${baseLabel} (${paymentMethod})` : baseLabel
      const channelRow = buildRow(key, channelLabel, channelSummaries)
      if (channelRow.grossSales !== 0 || channelRow.netSales !== 0) {
        channelRows.push(channelRow)
      }
    }

    channelRows.sort((a, b) => {
      const [aPlatform] = a.storeId.split("|||")
      const [bPlatform] = b.storeId.split("|||")
      const aFP = isFPPlatform(aPlatform) ? 0 : 1
      const bFP = isFPPlatform(bPlatform) ? 0 : 1
      if (aFP !== bFP) return aFP - bFP
      const cmp = aPlatform.localeCompare(bPlatform)
      if (cmp !== 0) return cmp
      return a.storeName.localeCompare(b.storeName)
    })

    const otterStores = await prisma.otterStore.findMany({
      where: { storeId: { in: storeIds } },
      select: { lastSyncAt: true },
      orderBy: { lastSyncAt: "desc" },
    })
    const lastSyncAt = otterStores[0]?.lastSyncAt ?? null

    return {
      rows,
      totals,
      channelRows,
      dateRange: {
        startDate: rangeStart.toISOString().split("T")[0],
        endDate: rangeEnd.toISOString().split("T")[0],
      },
      dayCount,
      lastSyncAt,
    }
  } catch (error) {
    console.error("Get dashboard analytics error:", error)
    return null
  }
    },
  )
}
