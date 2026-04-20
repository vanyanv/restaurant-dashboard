"use server"

import { revalidatePath } from "next/cache"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { todayInLA, startOfDayLA, endOfDayLA } from "@/lib/dashboard-utils"
import {
  buildPeriods,
  bucketSummariesByPeriod,
  computeStorePnL,
  channelMix,
  type Granularity,
  type Period,
  type PnLRow,
} from "@/lib/pnl"
import type { UnmappedMenuItem } from "@/lib/pnl-cogs"
import { recomputeDailyCogsForRange } from "@/lib/cogs-materializer"
import { CogsStatus } from "@/generated/prisma/client"

const createStoreSchema = z.object({
  name: z.string().min(1, "Store name is required").max(100),
  address: z.string().max(200).optional(),
  phone: z.string().max(20).optional(),
})

const updateStoreSchema = z.object({
  name: z.string().min(1, "Store name is required").max(100),
  address: z.string().max(200).optional(),
  phone: z.string().max(20).optional(),
  isActive: z.boolean().optional(),
  fixedMonthlyLabor: z.number().min(0).max(1_000_000).nullable().optional(),
  fixedMonthlyRent: z.number().min(0).max(1_000_000).nullable().optional(),
  fixedMonthlyTowels: z.number().min(0).max(1_000_000).nullable().optional(),
  fixedMonthlyCleaning: z.number().min(0).max(1_000_000).nullable().optional(),
  uberCommissionRate: z.number().min(0).max(1).optional(),
  doordashCommissionRate: z.number().min(0).max(1).optional(),
})

export async function createStore(formData: FormData) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return { error: "Unauthorized" }
    }

    if (session.user.role !== "OWNER") {
      return { error: "Only owners can create stores" }
    }

    const validatedData = createStoreSchema.parse({
      name: formData.get("name"),
      address: formData.get("address") || undefined,
      phone: formData.get("phone") || undefined,
    })

    const store = await prisma.store.create({
      data: {
        ...validatedData,
        ownerId: session.user.id,
        isActive: true,
      },
    })

    revalidatePath("/dashboard")
    return { success: true, store }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0].message }
    }
    console.error("Create store error:", error)
    return { error: "Failed to create store" }
  }
}

export async function getStores() {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return []
    }

    const stores = await prisma.store.findMany({
      where: {
        ownerId: session.user.id,
        isActive: true
      },
      orderBy: { createdAt: 'desc' }
    })

    return stores
  } catch (error) {
    console.error("Get stores error:", error)
    return []
  }
}

export async function getOtterAnalytics(
  storeId?: string,
  options?: { days?: number; startDate?: string; endDate?: string }
): Promise<import("@/types/analytics").StoreAnalyticsData | null> {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return null
    }

    const stores = await getStores()
    if (stores.length === 0) {
      return null
    }

    const storeIds = storeId ? [storeId] : stores.map((s) => s.id)

    // Determine date range
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

    // Fetch current period
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

    // Fetch previous period for comparison
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

    // Helper: sum a field across rows
    const sum = (rows: typeof summaries, fn: (r: (typeof summaries)[0]) => number) =>
      rows.reduce((acc, r) => acc + fn(r), 0)

    const isFPPlatform = (p: string) => p === "css-pos" || p === "bnm-web"
    const gross = (r: (typeof summaries)[0]) => (r.fpGrossSales ?? 0) + (r.tpGrossSales ?? 0)
    const net = (r: (typeof summaries)[0]) => (r.fpNetSales ?? 0) + (r.tpNetSales ?? 0)

    // KPIs
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

    // Period-over-period comparison
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

    // Daily trends (grouped by date)
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

    // Platform trends (per-date per-platform gross sales)
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

    // Platform breakdown with all metrics — dynamic channel grouping
    // FP platforms: group by platform + paymentMethod (e.g., "css-pos/CASH", "css-pos/CARD")
    // 3P platforms: group by platform only (paymentMethod = null)
    const channelKeys = new Set<string>()
    for (const r of summaries) {
      const isFP = isFPPlatform(r.platform)
      const pm = isFP && r.paymentMethod && r.paymentMethod !== "N/A" ? r.paymentMethod : null
      channelKeys.add(`${r.platform}|||${pm ?? ""}`)
    }

    const platformBreakdown: import("@/types/analytics").PlatformBreakdown[] = []
    for (const key of channelKeys) {
      const [platform, pmRaw] = key.split("|||")
      const isFP = isFPPlatform(platform)
      const paymentMethod = pmRaw || null
      const rows = summaries.filter((r) => {
        if (r.platform !== platform) return false
        if (isFP) {
          const rpm = r.paymentMethod && r.paymentMethod !== "N/A" ? r.paymentMethod : null
          return rpm === paymentMethod
        }
        return true
      })
      const grossSalesVal = sum(rows, (r) => isFP ? (r.fpGrossSales ?? 0) : (r.tpGrossSales ?? 0))
      const netSalesVal = sum(rows, (r) => isFP ? (r.fpNetSales ?? 0) : (r.tpNetSales ?? 0))
      const feesVal = sum(rows, (r) => isFP ? (r.fpFees ?? 0) : (r.tpFees ?? 0))
      const discountsVal = sum(rows, (r) => isFP ? (r.fpDiscounts ?? 0) : (r.tpDiscounts ?? 0))
      const taxCollectedVal = sum(rows, (r) => isFP ? (r.fpTaxCollected ?? 0) : (r.tpTaxCollected ?? 0))
      const taxRemittedVal = sum(rows, (r) => isFP ? (r.fpTaxRemitted ?? 0) : (r.tpTaxRemitted ?? 0))
      const tipsVal = sum(rows, (r) => isFP ? (r.fpTips ?? 0) : (r.tpTipForRestaurant ?? 0))
      const serviceChargesVal = sum(rows, (r) => isFP ? (r.fpServiceCharges ?? 0) : (r.tpServiceCharges ?? 0))
      const loyaltyVal = sum(rows, (r) => isFP ? (r.fpLoyalty ?? 0) : (r.tpLoyaltyDiscount ?? 0))
      const refundsAdjVal = sum(rows, (r) => isFP ? 0 : (r.tpRefundsAdjustments ?? 0))
      const orderCountVal = sum(rows, (r) => isFP ? (r.fpOrderCount ?? 0) : (r.tpOrderCount ?? 0))
      const paidInVal = sum(rows, (r) => r.tillPaidIn ?? 0)
      const paidOutVal = sum(rows, (r) => r.tillPaidOut ?? 0)
      const theoreticalDepositVal =
        netSalesVal + taxCollectedVal - Math.abs(taxRemittedVal) + tipsVal + serviceChargesVal - Math.abs(feesVal)
      const expectedDepositVal = theoreticalDepositVal + paidInVal - Math.abs(paidOutVal)

      const entry = {
        platform,
        paymentMethod,
        grossSales: grossSalesVal,
        netSales: netSalesVal,
        fees: feesVal,
        discounts: discountsVal,
        taxCollected: taxCollectedVal,
        taxRemitted: taxRemittedVal,
        tips: tipsVal,
        serviceCharges: serviceChargesVal,
        loyalty: loyaltyVal,
        refundsAdjustments: refundsAdjVal,
        orderCount: orderCountVal,
        paidIn: paidInVal,
        paidOut: paidOutVal,
        theoreticalDeposit: theoreticalDepositVal,
        cashDrawerRecon: null as number | null,
        expectedDeposit: expectedDepositVal,
      }
      if (entry.grossSales > 0 || entry.netSales > 0) {
        platformBreakdown.push(entry)
      }
    }

    // Sort: FP channels first, then 3P alphabetically
    platformBreakdown.sort((a, b) => {
      const aFP = isFPPlatform(a.platform) ? 0 : 1
      const bFP = isFPPlatform(b.platform) ? 0 : 1
      if (aFP !== bFP) return aFP - bFP
      const cmp = a.platform.localeCompare(b.platform)
      if (cmp !== 0) return cmp
      return (a.paymentMethod ?? "").localeCompare(b.paymentMethod ?? "")
    })

    // Cash vs card split (FP only)
    const cashSales = sum(
      summaries.filter((r) => r.paymentMethod === "CASH"),
      (r) => r.fpGrossSales ?? 0
    )
    const cardSales = sum(
      summaries.filter((r) => r.paymentMethod === "CARD"),
      (r) => r.fpGrossSales ?? 0
    )

    // Last sync time
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
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return null

    const stores = await getStores()
    if (stores.length === 0) return null

    const storeIds = stores.map((s) => s.id)

    // Determine date range
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

    // Build per-store summary rows
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

      // Theoretical Deposit = Net Sales + Tax Collected - Tax Remitted + Tips + Service Charges - Commission & Fees
      const theoreticalDeposit =
        netSales + taxCollected - Math.abs(taxRemitted) + tips + serviceCharges - Math.abs(commissionFees)

      // Cash Drawer Recon — not available from Otter (drawer_reconciliation always null)
      const cashDrawerRecon = null

      // Expected Deposit = Theoretical Deposit + Paid In - Paid Out
      const expectedDeposit = theoreticalDeposit + paidIn - Math.abs(paidOut)

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

    // Totals row
    const totals = buildRow("total", "TOTAL", summaries)

    // Build per-channel summary rows
    const isFPPlatform = (p: string) => p === "css-pos" || p === "bnm-web"
    const PLATFORM_LABELS: Record<string, string> = {
      "css-pos": "Otter POS",
      "bnm-web": "Otter Online Ordering",
      doordash: "DoorDash",
      ubereats: "Uber Eats",
      grubhub: "Grubhub",
      caviar: "Caviar",
    }

    const channelKeySet = new Set<string>()
    for (const row of summaries) {
      const isFP = isFPPlatform(row.platform)
      const pm = isFP && row.paymentMethod && row.paymentMethod !== "N/A"
        ? row.paymentMethod
        : ""
      channelKeySet.add(`${row.platform}|||${pm}`)
    }

    const channelRows: import("@/types/analytics").StoreSummaryRow[] = []
    for (const key of channelKeySet) {
      const [platform, pmRaw] = key.split("|||")
      const isFP = isFPPlatform(platform)
      const paymentMethod = pmRaw || null
      const channelSummaries = summaries.filter((r) => {
        if (r.platform !== platform) return false
        if (isFP) {
          const rpm = r.paymentMethod && r.paymentMethod !== "N/A" ? r.paymentMethod : null
          return rpm === paymentMethod
        }
        return true
      })
      const baseLabel = PLATFORM_LABELS[platform] ?? platform
      const channelLabel = paymentMethod ? `${baseLabel} (${paymentMethod})` : baseLabel
      const channelRow = buildRow(key, channelLabel, channelSummaries)
      if (channelRow.grossSales !== 0 || channelRow.netSales !== 0) {
        channelRows.push(channelRow)
      }
    }

    // Sort: FP platforms first, then 3P alphabetically
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

    // Last sync time
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

    // Determine date range
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

    if (categories.length === 0) return null

    // Aggregate categories by name (sum across dates/stores)
    const categoryMap = new Map<string, import("@/types/analytics").MenuCategoryRow>()
    for (const c of categories) {
      const existing = categoryMap.get(c.category)
      if (existing) {
        existing.fpQuantitySold += c.fpQuantitySold
        existing.fpTotalInclModifiers += c.fpTotalInclModifiers
        existing.fpTotalSales += c.fpTotalSales
        existing.tpQuantitySold += c.tpQuantitySold
        existing.tpTotalInclModifiers += c.tpTotalInclModifiers
        existing.tpTotalSales += c.tpTotalSales
        existing.totalQuantitySold += c.fpQuantitySold + c.tpQuantitySold
        existing.totalSales += c.fpTotalSales + c.tpTotalSales
      } else {
        categoryMap.set(c.category, {
          category: c.category,
          fpQuantitySold: c.fpQuantitySold,
          fpTotalInclModifiers: c.fpTotalInclModifiers,
          fpTotalSales: c.fpTotalSales,
          tpQuantitySold: c.tpQuantitySold,
          tpTotalInclModifiers: c.tpTotalInclModifiers,
          tpTotalSales: c.tpTotalSales,
          totalQuantitySold: c.fpQuantitySold + c.tpQuantitySold,
          totalSales: c.fpTotalSales + c.tpTotalSales,
        })
      }
    }

    // Aggregate items by (category, itemName)
    const itemKey = (cat: string, item: string) => `${cat}|||${item}`
    const itemMap = new Map<string, import("@/types/analytics").MenuItemRow>()
    for (const i of items) {
      const key = itemKey(i.category, i.itemName)
      const existing = itemMap.get(key)
      if (existing) {
        existing.fpQuantitySold += i.fpQuantitySold
        existing.fpTotalInclModifiers += i.fpTotalInclModifiers
        existing.fpTotalSales += i.fpTotalSales
        existing.tpQuantitySold += i.tpQuantitySold
        existing.tpTotalInclModifiers += i.tpTotalInclModifiers
        existing.tpTotalSales += i.tpTotalSales
        existing.totalQuantitySold += i.fpQuantitySold + i.tpQuantitySold
        existing.totalSales += i.fpTotalSales + i.tpTotalSales
      } else {
        itemMap.set(key, {
          itemName: i.itemName,
          category: i.category,
          fpQuantitySold: i.fpQuantitySold,
          fpTotalInclModifiers: i.fpTotalInclModifiers,
          fpTotalSales: i.fpTotalSales,
          tpQuantitySold: i.tpQuantitySold,
          tpTotalInclModifiers: i.tpTotalInclModifiers,
          tpTotalSales: i.tpTotalSales,
          totalQuantitySold: i.fpQuantitySold + i.tpQuantitySold,
          totalSales: i.fpTotalSales + i.tpTotalSales,
        })
      }
    }

    // Nest items under categories
    const result: import("@/types/analytics").MenuCategoryWithItems[] = []
    for (const cat of categoryMap.values()) {
      const catItems = Array.from(itemMap.values())
        .filter((i) => i.category === cat.category)
        .sort((a, b) => b.totalQuantitySold - a.totalQuantitySold)
      result.push({ ...cat, items: catItems })
    }

    // Sort by totalQuantitySold descending
    result.sort((a, b) => b.totalQuantitySold - a.totalQuantitySold)

    // Compute totals
    const totals = {
      fpQuantitySold: result.reduce((s, c) => s + c.fpQuantitySold, 0),
      fpTotalSales: result.reduce((s, c) => s + c.fpTotalSales, 0),
      tpQuantitySold: result.reduce((s, c) => s + c.tpQuantitySold, 0),
      tpTotalSales: result.reduce((s, c) => s + c.tpTotalSales, 0),
      totalQuantitySold: result.reduce((s, c) => s + c.totalQuantitySold, 0),
      totalSales: result.reduce((s, c) => s + c.totalSales, 0),
    }

    return {
      categories: result,
      totals,
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

export async function getMenuPerformanceAnalytics(
  storeId?: string,
  options?: { days?: number; startDate?: string; endDate?: string }
): Promise<import("@/types/analytics").MenuPerformanceData | null> {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return null

    const stores = await getStores()
    if (stores.length === 0) return null

    const storeIds = storeId ? [storeId] : stores.map((s) => s.id)

    // Determine date range
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

    // Fetch current period categories + items
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

    // Fetch previous period for comparison
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

    // Aggregate items by (category, itemName)
    const itemKey = (cat: string, item: string) => `${cat}|||${item}`
    const itemMap = new Map<string, import("@/types/analytics").MenuItemRanked>()
    for (const i of items) {
      const key = itemKey(i.category, i.itemName)
      const existing = itemMap.get(key)
      if (existing) {
        existing.fpQuantitySold += i.fpQuantitySold
        existing.tpQuantitySold += i.tpQuantitySold
        existing.fpSales += i.fpTotalSales
        existing.tpSales += i.tpTotalSales
        existing.totalQuantitySold += i.fpQuantitySold + i.tpQuantitySold
        existing.totalSales += i.fpTotalSales + i.tpTotalSales
      } else {
        itemMap.set(key, {
          itemName: i.itemName,
          category: i.category,
          fpQuantitySold: i.fpQuantitySold,
          tpQuantitySold: i.tpQuantitySold,
          fpSales: i.fpTotalSales,
          tpSales: i.tpTotalSales,
          totalQuantitySold: i.fpQuantitySold + i.tpQuantitySold,
          totalSales: i.fpTotalSales + i.tpTotalSales,
          avgPricePerUnit: 0,
          fpShare: 0,
          tpShare: 0,
          previousQuantity: 0,
          previousSales: 0,
          quantityGrowth: null,
          salesGrowth: null,
        })
      }
    }

    // Aggregate previous-period qty/sales per item for WoW deltas.
    const prevItemMap = new Map<string, { qty: number; sales: number }>()
    for (const i of prevItems) {
      const key = itemKey(i.category, i.itemName)
      const qty = i.fpQuantitySold + i.tpQuantitySold
      const sales = i.fpTotalSales + i.tpTotalSales
      const existing = prevItemMap.get(key)
      if (existing) {
        existing.qty += qty
        existing.sales += sales
      } else {
        prevItemMap.set(key, { qty, sales })
      }
    }

    // Compute derived fields
    const allItems: import("@/types/analytics").MenuItemRanked[] = []
    for (const [key, item] of itemMap.entries()) {
      item.avgPricePerUnit = item.totalQuantitySold > 0
        ? item.totalSales / item.totalQuantitySold
        : 0
      item.fpShare = item.totalQuantitySold > 0
        ? (item.fpQuantitySold / item.totalQuantitySold) * 100
        : 0
      item.tpShare = item.totalQuantitySold > 0
        ? (item.tpQuantitySold / item.totalQuantitySold) * 100
        : 0
      const prev = prevItemMap.get(key)
      item.previousQuantity = prev?.qty ?? 0
      item.previousSales = prev?.sales ?? 0
      item.quantityGrowth = item.previousQuantity > 0
        ? ((item.totalQuantitySold - item.previousQuantity) / item.previousQuantity) * 100
        : null
      item.salesGrowth = item.previousSales > 0
        ? ((item.totalSales - item.previousSales) / item.previousSales) * 100
        : null
      allItems.push(item)
    }
    allItems.sort((a, b) => b.totalQuantitySold - a.totalQuantitySold)

    // Build item daily matrix (top 20 items x all dates) for heatmap + race
    const top20Items = allItems.slice(0, 20)
    const top20Set = new Set(top20Items.map(i => itemKey(i.category, i.itemName)))
    const matrixItemNames = top20Items.map(i => i.itemName)

    const itemDailyMatrix: import("@/types/analytics").ItemDailyCell[] = []
    for (const i of items) {
      const key = itemKey(i.category, i.itemName)
      if (!top20Set.has(key)) continue
      itemDailyMatrix.push({
        date: i.date.toISOString().split("T")[0],
        itemName: i.itemName,
        category: i.category,
        quantity: i.fpQuantitySold + i.tpQuantitySold,
        revenue: i.fpTotalSales + i.tpTotalSales,
      })
    }

    // Build race day frames (top 10 items, cumulative rankings per day)
    const top10Items = allItems.slice(0, 10)
    const top10Set = new Set(top10Items.map(i => itemKey(i.category, i.itemName)))
    const uniqueDates = [...new Set(items.map(i => i.date.toISOString().split("T")[0]))].sort()

    const cumulatives = new Map<string, { qty: number; rev: number; category: string }>()
    for (const item of top10Items) {
      cumulatives.set(item.itemName, { qty: 0, rev: 0, category: item.category })
    }

    const raceDayFrames: import("@/types/analytics").RaceDayFrame[] = []
    for (const date of uniqueDates) {
      for (const i of items) {
        if (i.date.toISOString().split("T")[0] !== date) continue
        const key = itemKey(i.category, i.itemName)
        if (!top10Set.has(key)) continue
        const cum = cumulatives.get(i.itemName)
        if (!cum) continue
        cum.qty += i.fpQuantitySold + i.tpQuantitySold
        cum.rev += i.fpTotalSales + i.tpTotalSales
      }
      const entries = Array.from(cumulatives.entries())
        .map(([name, data]) => ({ itemName: name, ...data }))
        .sort((a, b) => b.qty - a.qty)
        .map((e, idx) => ({
          itemName: e.itemName,
          category: e.category,
          cumulativeQuantity: e.qty,
          cumulativeRevenue: e.rev,
          rank: idx + 1,
        }))
      raceDayFrames.push({ date, rankings: entries })
    }

    // KPIs
    const totalItemsSold = allItems.reduce((s, i) => s + i.totalQuantitySold, 0)
    const totalMenuRevenue = allItems.reduce((s, i) => s + i.totalSales, 0)
    const uniqueItemsCount = allItems.length
    const topSellingItem = allItems.length > 0
      ? { name: allItems[0].itemName, quantity: allItems[0].totalQuantitySold, category: allItems[0].category }
      : null

    const kpis: import("@/types/analytics").MenuPerformanceKpis = {
      totalItemsSold,
      totalMenuRevenue,
      uniqueItemsCount,
      avgRevenuePerItem: uniqueItemsCount > 0 ? totalMenuRevenue / uniqueItemsCount : 0,
      topSellingItem,
    }

    // Previous period comparison
    let prevTotalItems = 0
    let prevTotalRevenue = 0
    for (const i of prevItems) {
      prevTotalItems += i.fpQuantitySold + i.tpQuantitySold
      prevTotalRevenue += i.fpTotalSales + i.tpTotalSales
    }

    const comparison: import("@/types/analytics").MenuPerformanceComparison = {
      currentItemsSold: totalItemsSold,
      previousItemsSold: prevTotalItems,
      itemsSoldGrowth: prevTotalItems > 0
        ? ((totalItemsSold - prevTotalItems) / prevTotalItems) * 100
        : 0,
      currentRevenue: totalMenuRevenue,
      previousRevenue: prevTotalRevenue,
      revenueGrowth: prevTotalRevenue > 0
        ? ((totalMenuRevenue - prevTotalRevenue) / prevTotalRevenue) * 100
        : 0,
    }

    // Daily trends
    const byDate: Record<string, import("@/types/analytics").MenuDailyTrend> = {}
    for (const i of items) {
      const dateStr = i.date.toISOString().split("T")[0]
      const existing = byDate[dateStr]
      if (existing) {
        existing.fpQuantitySold += i.fpQuantitySold
        existing.tpQuantitySold += i.tpQuantitySold
        existing.fpSales += i.fpTotalSales
        existing.tpSales += i.tpTotalSales
        existing.totalQuantitySold += i.fpQuantitySold + i.tpQuantitySold
        existing.totalSales += i.fpTotalSales + i.tpTotalSales
      } else {
        byDate[dateStr] = {
          date: dateStr,
          fpQuantitySold: i.fpQuantitySold,
          tpQuantitySold: i.tpQuantitySold,
          fpSales: i.fpTotalSales,
          tpSales: i.tpTotalSales,
          totalQuantitySold: i.fpQuantitySold + i.tpQuantitySold,
          totalSales: i.fpTotalSales + i.tpTotalSales,
        }
      }
    }
    const dailyTrends = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date))

    // Category breakdown
    const catMap = new Map<string, { totalSales: number; totalQuantitySold: number; fpSales: number; tpSales: number }>()
    for (const c of categories) {
      const existing = catMap.get(c.category)
      if (existing) {
        existing.totalSales += c.fpTotalSales + c.tpTotalSales
        existing.totalQuantitySold += c.fpQuantitySold + c.tpQuantitySold
        existing.fpSales += c.fpTotalSales
        existing.tpSales += c.tpTotalSales
      } else {
        catMap.set(c.category, {
          totalSales: c.fpTotalSales + c.tpTotalSales,
          totalQuantitySold: c.fpQuantitySold + c.tpQuantitySold,
          fpSales: c.fpTotalSales,
          tpSales: c.tpTotalSales,
        })
      }
    }

    const totalCatSales = Array.from(catMap.values()).reduce((s, c) => s + c.totalSales, 0)
    const categoryBreakdown: import("@/types/analytics").MenuCategorySalesBreakdown[] = Array.from(catMap.entries())
      .map(([category, data]) => ({
        category,
        ...data,
        percentOfTotal: totalCatSales > 0 ? (data.totalSales / totalCatSales) * 100 : 0,
      }))
      .sort((a, b) => b.totalSales - a.totalSales)

    // Channel comparison (per category)
    const channelMap = new Map<string, import("@/types/analytics").MenuChannelComparison>()
    for (const c of categories) {
      const existing = channelMap.get(c.category)
      if (existing) {
        existing.fpQuantitySold += c.fpQuantitySold
        existing.fpSales += c.fpTotalSales
        existing.tpQuantitySold += c.tpQuantitySold
        existing.tpSales += c.tpTotalSales
      } else {
        channelMap.set(c.category, {
          category: c.category,
          fpQuantitySold: c.fpQuantitySold,
          fpSales: c.fpTotalSales,
          tpQuantitySold: c.tpQuantitySold,
          tpSales: c.tpTotalSales,
        })
      }
    }

    return {
      kpis,
      comparison,
      dailyTrends,
      categoryBreakdown,
      topItems: allItems.slice(0, 15),
      allItems,
      channelComparison: Array.from(channelMap.values()).sort((a, b) =>
        (b.fpQuantitySold + b.tpQuantitySold) - (a.fpQuantitySold + a.tpQuantitySold)
      ),
      dateRange: {
        startDate: rangeStart.toISOString().split("T")[0],
        endDate: rangeEnd.toISOString().split("T")[0],
      },
      dayCount,
      itemDailyMatrix,
      raceDayFrames,
      matrixItemNames,
    }
  } catch (error) {
    console.error("Get menu performance analytics error:", error)
    return null
  }
}

export async function getMenuItemDetail(
  itemName: string,
  category: string,
  storeId?: string,
  options?: { days?: number; startDate?: string; endDate?: string }
): Promise<import("@/types/analytics").ItemExplorerData | null> {
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

    // Fetch current period items for this specific item
    const currentItems = await prisma.otterMenuItem.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: rangeStart, lte: rangeEnd },
        itemName,
        category,
      },
      orderBy: { date: "asc" },
    })

    if (currentItems.length === 0) return null

    // Fetch all items in range for rank computation
    const allItemsRaw = await prisma.otterMenuItem.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: rangeStart, lte: rangeEnd },
      },
      select: { itemName: true, category: true, fpQuantitySold: true, tpQuantitySold: true },
    })

    // Compute rank
    const qtyMap = new Map<string, number>()
    for (const i of allItemsRaw) {
      const key = `${i.category}|||${i.itemName}`
      qtyMap.set(key, (qtyMap.get(key) ?? 0) + i.fpQuantitySold + i.tpQuantitySold)
    }
    const sorted = [...qtyMap.entries()].sort((a, b) => b[1] - a[1])
    const rank = sorted.findIndex(([k]) => k === `${category}|||${itemName}`) + 1

    // Fetch previous period for growth
    const prevEnd = new Date(rangeStart)
    prevEnd.setDate(prevEnd.getDate() - 1)
    const prevStart = new Date(prevEnd)
    prevStart.setDate(prevStart.getDate() - dayCount)
    prevStart.setHours(0, 0, 0, 0)

    const prevItems = await prisma.otterMenuItem.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: prevStart, lte: prevEnd },
        itemName,
        category,
      },
    })

    // Aggregate current
    let fpQty = 0, tpQty = 0, fpSales = 0, tpSales = 0
    for (const i of currentItems) {
      fpQty += i.fpQuantitySold
      tpQty += i.tpQuantitySold
      fpSales += i.fpTotalSales
      tpSales += i.tpTotalSales
    }
    const totalQty = fpQty + tpQty
    const totalRevenue = fpSales + tpSales

    // Aggregate previous
    let prevTotalQty = 0
    for (const i of prevItems) {
      prevTotalQty += i.fpQuantitySold + i.tpQuantitySold
    }

    // Build daily trend (aggregate by date across stores)
    const dailyMap = new Map<string, import("@/types/analytics").ItemDailyDetail>()
    for (const i of currentItems) {
      const dateStr = i.date.toISOString().split("T")[0]
      const existing = dailyMap.get(dateStr)
      if (existing) {
        existing.fpQuantitySold += i.fpQuantitySold
        existing.tpQuantitySold += i.tpQuantitySold
        existing.fpSales += i.fpTotalSales
        existing.tpSales += i.tpTotalSales
        existing.totalQuantitySold += i.fpQuantitySold + i.tpQuantitySold
        existing.totalSales += i.fpTotalSales + i.tpTotalSales
      } else {
        dailyMap.set(dateStr, {
          date: dateStr,
          fpQuantitySold: i.fpQuantitySold,
          tpQuantitySold: i.tpQuantitySold,
          fpSales: i.fpTotalSales,
          tpSales: i.tpTotalSales,
          totalQuantitySold: i.fpQuantitySold + i.tpQuantitySold,
          totalSales: i.fpTotalSales + i.tpTotalSales,
        })
      }
    }

    return {
      itemName,
      category,
      rank,
      totalQuantitySold: totalQty,
      totalRevenue,
      avgPricePerUnit: totalQty > 0 ? totalRevenue / totalQty : 0,
      fpQuantitySold: fpQty,
      tpQuantitySold: tpQty,
      fpSales,
      tpSales,
      growthPercent: prevTotalQty > 0
        ? ((totalQty - prevTotalQty) / prevTotalQty) * 100
        : null,
      dailyTrend: Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
    }
  } catch (error) {
    console.error("Get menu item detail error:", error)
    return null
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
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

    // Determine date range
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

    // Fetch current period items + categories
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

    // Fetch previous period for comparison
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

    // Aggregate current items by (category, itemName)
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

    // Aggregate previous period items
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

    // ─── Build Treemap ───
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

    // ─── Build Pareto / ABC ───
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

    // ─── Build Matrix ───
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

    // ─── Build Table ───
    const tableCategories: import("@/types/analytics").ProductMixTableCategory[] = []
    for (const [catName, catItems] of catItemsMap) {
      const catTotalRevenue = catItems.reduce((s, i) => s + i.totalSales, 0)
      const catTotalQty = catItems.reduce((s, i) => s + i.totalQuantitySold, 0)
      const catTotalModRev = catItems.reduce(
        (s, i) => s + Math.max(0, i.totalInclModifiers - i.totalSales), 0
      )

      // Previous period category totals for period change
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

    // ─── Build Insights ───
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

    // ─── Build Movers ───
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

export async function getStoreById(storeId: string) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return null
    }

    const store = await prisma.store.findFirst({
      where: {
        id: storeId,
        ownerId: session.user.id,
      },
    })

    return store
  } catch (error) {
    console.error("Get store by ID error:", error)
    return null
  }
}

export async function updateStore(storeId: string, formData: FormData) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return { error: "Unauthorized" }
    }

    if (session.user.role !== "OWNER") {
      return { error: "Only owners can update stores" }
    }

    const parseOptionalNumber = (v: FormDataEntryValue | null): number | null | undefined => {
      if (v == null) return undefined
      const s = String(v).trim()
      if (s === "") return null
      const n = Number(s)
      return Number.isFinite(n) ? n : undefined
    }

    const parseRate = (v: FormDataEntryValue | null): number | undefined => {
      if (v == null) return undefined
      const s = String(v).trim()
      if (s === "") return undefined
      // Accept either decimals (0.21) or percents (21). Treat values > 1 as percents.
      const n = Number(s)
      if (!Number.isFinite(n) || n < 0) return undefined
      return n > 1 ? n / 100 : n
    }

    const validatedData = updateStoreSchema.parse({
      name: formData.get("name"),
      address: formData.get("address") || undefined,
      phone: formData.get("phone") || undefined,
      isActive: formData.get("isActive") === "true",
      fixedMonthlyLabor: parseOptionalNumber(formData.get("fixedMonthlyLabor")),
      fixedMonthlyRent: parseOptionalNumber(formData.get("fixedMonthlyRent")),
      fixedMonthlyTowels: parseOptionalNumber(formData.get("fixedMonthlyTowels")),
      fixedMonthlyCleaning: parseOptionalNumber(formData.get("fixedMonthlyCleaning")),
      uberCommissionRate: parseRate(formData.get("uberCommissionRate")),
      doordashCommissionRate: parseRate(formData.get("doordashCommissionRate")),
    })

    // Verify store exists and user owns it
    const existingStore = await prisma.store.findFirst({
      where: { 
        id: storeId,
        ownerId: session.user.id
      }
    })

    if (!existingStore) {
      return { error: "Store not found or access denied" }
    }

    const updatedStore = await prisma.store.update({
      where: { id: storeId },
      data: validatedData,
    })

    revalidatePath("/dashboard/stores")
    revalidatePath(`/dashboard/stores/${storeId}`)
    return { success: true, store: updatedStore }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0].message }
    }
    console.error("Update store error:", error)
    return { error: "Failed to update store" }
  }
}

export async function deleteStore(storeId: string) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return { error: "Unauthorized" }
    }

    if (session.user.role !== "OWNER") {
      return { error: "Only owners can delete stores" }
    }

    // Verify store exists and user owns it
    const existingStore = await prisma.store.findFirst({
      where: {
        id: storeId,
        ownerId: session.user.id
      },
    })

    if (!existingStore) {
      return { error: "Store not found or access denied" }
    }

    // Soft delete - set as inactive instead of hard delete
    await prisma.store.update({
      where: { id: storeId },
      data: { isActive: false }
    })

    revalidatePath("/dashboard/stores")
    revalidatePath("/dashboard")
    return { success: true }
  } catch (error) {
    console.error("Delete store error:", error)
    return { error: "Failed to delete store" }
  }
}

export async function toggleStoreStatus(storeId: string) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return { error: "Unauthorized" }
    }

    if (session.user.role !== "OWNER") {
      return { error: "Only owners can change store status" }
    }

    // Get current store status
    const store = await prisma.store.findFirst({
      where: { 
        id: storeId,
        ownerId: session.user.id
      }
    })

    if (!store) {
      return { error: "Store not found or access denied" }
    }

    // Toggle status
    const updatedStore = await prisma.store.update({
      where: { id: storeId },
      data: { isActive: !store.isActive }
    })

    revalidatePath("/dashboard/stores")
    revalidatePath(`/dashboard/stores/${storeId}`)
    return { success: true, store: updatedStore }
  } catch (error) {
    console.error("Toggle store status error:", error)
    return { error: "Failed to update store status" }
  }
}

// ========== Order Patterns ==========

export async function getOrderPatterns(
  storeId?: string,
  options?: { days?: number; startDate?: string; endDate?: string }
): Promise<import("@/types/analytics").OrderPatternsData | null> {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return null

    const stores = await getStores()
    if (stores.length === 0) return null

    const storeIds = storeId ? [storeId] : stores.map((s) => s.id)

    // Determine date range
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

    // Fetch hourly data from Otter API + daily data from DB in parallel
    const [hourly, summaries] = await Promise.all([
      getHourlyOrderDistribution(storeIds, rangeStart, rangeEnd),
      prisma.otterDailySummary.findMany({
        where: {
          storeId: { in: storeIds },
          date: { gte: rangeStart, lte: rangeEnd },
        },
        select: {
          date: true,
          platform: true,
          fpOrderCount: true,
          tpOrderCount: true,
          fpGrossSales: true,
          tpGrossSales: true,
        },
        orderBy: { date: "asc" },
      }),
    ])

    // --- Day of week aggregation ---
    const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    const dayBuckets = Array.from({ length: 7 }, () => ({
      orderCount: 0,
      totalSales: 0,
      dayOccurrences: new Set<string>(),
    }))

    for (const row of summaries) {
      const d = new Date(row.date)
      const dow = d.getUTCDay()
      const dateKey = d.toISOString().slice(0, 10)
      dayBuckets[dow].orderCount += (row.fpOrderCount ?? 0) + (row.tpOrderCount ?? 0)
      dayBuckets[dow].totalSales += (row.fpGrossSales ?? 0) + (row.tpGrossSales ?? 0)
      dayBuckets[dow].dayOccurrences.add(dateKey)
    }

    const byDayOfWeek = dayBuckets.map((b, i) => ({
      day: i,
      label: DAY_LABELS[i],
      orderCount: b.orderCount,
      totalSales: Math.round(b.totalSales * 100) / 100,
      avgOrders: b.dayOccurrences.size > 0
        ? Math.round(b.orderCount / b.dayOccurrences.size)
        : 0,
    }))

    // --- Monthly aggregation ---
    const monthMap = new Map<string, { orderCount: number; totalSales: number }>()

    for (const row of summaries) {
      const d = new Date(row.date)
      const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
      const entry = monthMap.get(monthKey) ?? { orderCount: 0, totalSales: 0 }
      entry.orderCount += (row.fpOrderCount ?? 0) + (row.tpOrderCount ?? 0)
      entry.totalSales += (row.fpGrossSales ?? 0) + (row.tpGrossSales ?? 0)
      monthMap.set(monthKey, entry)
    }

    const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    const byMonth = Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => {
        const [year, month] = key.split("-")
        return {
          month: key,
          label: `${MONTH_NAMES[parseInt(month) - 1]} ${year}`,
          orderCount: val.orderCount,
          totalSales: Math.round(val.totalSales * 100) / 100,
        }
      })

    return { hourly, byDayOfWeek, byMonth }
  } catch (error) {
    console.error("Get order patterns error:", error)
    return null
  }
}

async function getHourlyOrderDistribution(
  storeIds: string[],
  rangeStart: Date,
  rangeEnd: Date
): Promise<import("@/types/analytics").HourlyOrderPoint[]> {
  const { queryMetrics, buildCustomerOrdersBody } = await import("@/lib/otter")

  // Look up Otter UUIDs for the given stores
  const otterStores = await prisma.otterStore.findMany({
    where: { storeId: { in: storeIds } },
    select: { otterStoreId: true },
  })

  const HOUR_LABELS = [
    "12 AM", "1 AM", "2 AM", "3 AM", "4 AM", "5 AM",
    "6 AM", "7 AM", "8 AM", "9 AM", "10 AM", "11 AM",
    "12 PM", "1 PM", "2 PM", "3 PM", "4 PM", "5 PM",
    "6 PM", "7 PM", "8 PM", "9 PM", "10 PM", "11 PM",
  ]

  const emptyHourly = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    label: HOUR_LABELS[i],
    orderCount: 0,
    totalSales: 0,
  }))

  if (otterStores.length === 0) return emptyHourly

  const otterIds = otterStores.map((s) => s.otterStoreId)
  const body = buildCustomerOrdersBody(otterIds, rangeStart, rangeEnd)

  try {
    const rows = await queryMetrics(body)

    const hourly = [...emptyHourly]
    for (const row of rows) {
      const epochMs = row.reference_time_local_without_tz as number | null
      if (epochMs == null) continue

      const hour = new Date(epochMs).getUTCHours()
      if (hour >= 0 && hour < 24) {
        hourly[hour].orderCount += 1
        hourly[hour].totalSales += (row.net_sales as number) ?? 0
      }
    }

    // Round sales
    for (const h of hourly) {
      h.totalSales = Math.round(h.totalSales * 100) / 100
    }

    return hourly
  } catch (error) {
    console.error("Failed to fetch hourly order data from Otter:", error)
    return emptyHourly
  }
}

// ═══ P&L ═══

export type StorePnLResult =
  | {
      storeName: string
      periods: Period[]
      rows: PnLRow[]
      fixedLaborConfigured: boolean
      fixedRentConfigured: boolean
      kpis: {
        grossSales: number
        netAfterCommissions: number
        fixedCosts: number
        bottomLine: number
        marginPct: number
      }
      channelMix: Array<{ channel: string; amount: number }>
      trend: {
        totalSales: number[]
        bottomLine: number[]
      }
      cogs: {
        totalCogs: number
        grossProfit: number
        grossMarginPct: number
        unmappedItems: UnmappedMenuItem[]
      }
    }
  | { error: string }

type DailyCogsRow = {
  date: Date
  itemName: string
  category: string
  qtySold: number
  salesRevenue: number
  lineCost: number
  status: CogsStatus
  recipeId: string | null
}

/**
 * Turn DailyCogsItem rows into (per-period cogs totals, aggregated unmapped items).
 * Replaces the old per-request `computeCogsForPeriods` walk.
 */
function summarizeDailyCogs(rows: DailyCogsRow[], periods: Period[]): {
  cogsValues: number[]
  unmappedItems: UnmappedMenuItem[]
} {
  const cogsValues = periods.map(() => 0)
  const unmappedAgg = new Map<string, UnmappedMenuItem>()

  for (const row of rows) {
    const t = row.date.getTime()
    const idx = periods.findIndex(
      (p) => t >= p.startDate.getTime() && t <= p.endDate.getTime()
    )
    if (idx === -1) continue

    if (row.status === CogsStatus.UNMAPPED) {
      const key = `${row.itemName}:::${row.category}`
      const existing = unmappedAgg.get(key)
      if (existing) {
        existing.qtySold += row.qtySold
        existing.salesRevenue += row.salesRevenue
      } else {
        unmappedAgg.set(key, {
          itemName: row.itemName,
          category: row.category,
          qtySold: row.qtySold,
          salesRevenue: row.salesRevenue,
        })
      }
      continue
    }

    cogsValues[idx] += row.lineCost
  }

  const unmappedItems = Array.from(unmappedAgg.values()).sort(
    (a, b) => b.salesRevenue - a.salesRevenue
  )
  return { cogsValues, unmappedItems }
}

export async function getStorePnL(input: {
  storeId: string
  startDate: Date
  endDate: Date
  granularity: Granularity
}): Promise<StorePnLResult> {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return { error: "Unauthorized" }
    if (session.user.role !== "OWNER") return { error: "P&L is restricted to owners" }

    const store = await prisma.store.findFirst({
      where: { id: input.storeId, ownerId: session.user.id },
      select: {
        id: true,
        name: true,
        fixedMonthlyLabor: true,
        fixedMonthlyRent: true,
        fixedMonthlyTowels: true,
        fixedMonthlyCleaning: true,
        uberCommissionRate: true,
        doordashCommissionRate: true,
      },
    })
    if (!store) return { error: "Store not found" }

    const periods = buildPeriods(input.startDate, input.endDate, input.granularity)
    if (periods.length === 0) {
      return {
        storeName: store.name,
        periods: [],
        rows: [],
        fixedLaborConfigured: store.fixedMonthlyLabor != null,
        fixedRentConfigured: store.fixedMonthlyRent != null,
        kpis: {
          grossSales: 0,
          netAfterCommissions: 0,
          fixedCosts: 0,
          bottomLine: 0,
          marginPct: 0,
        },
        channelMix: [],
        trend: { totalSales: [], bottomLine: [] },
        cogs: {
          totalCogs: 0,
          grossProfit: 0,
          grossMarginPct: 0,
          unmappedItems: [],
        },
      }
    }

    const overallStart = periods[0].startDate
    const overallEnd = periods[periods.length - 1].endDate

    const summaries = await prisma.otterDailySummary.findMany({
      where: {
        storeId: store.id,
        date: { gte: overallStart, lte: overallEnd },
      },
      select: {
        date: true,
        platform: true,
        paymentMethod: true,
        fpGrossSales: true,
        tpGrossSales: true,
        fpTaxCollected: true,
        tpTaxCollected: true,
        fpDiscounts: true,
        tpDiscounts: true,
        fpServiceCharges: true,
        tpServiceCharges: true,
      },
    })

    const bucketed = bucketSummariesByPeriod(summaries, periods)
    const cogsRows = await prisma.dailyCogsItem.findMany({
      where: {
        storeId: store.id,
        date: { gte: overallStart, lte: overallEnd },
      },
      select: {
        date: true,
        itemName: true,
        category: true,
        qtySold: true,
        salesRevenue: true,
        lineCost: true,
        status: true,
        recipeId: true,
      },
    })
    const cogs = summarizeDailyCogs(cogsRows, periods)
    const computed = computeStorePnL({
      bucketed,
      periods,
      store,
      cogsValues: cogs.cogsValues,
    })

    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
    const grossSales = sum(computed.totalSales)
    const netAfterCommissions = sum(computed.netAfterCommissions)
    const totalCogs = sum(computed.cogsValues)
    const grossProfit = sum(computed.grossProfit)
    const grossMarginPct = grossSales === 0 ? 0 : grossProfit / grossSales
    const fixedCosts =
      sum(computed.laborValues) +
      sum(computed.rentValues) +
      sum(computed.towelsValues) +
      sum(computed.cleaningValues)
    const bottomLine = sum(computed.bottomLine)
    const marginPct = grossSales === 0 ? 0 : bottomLine / grossSales

    const totalChannelVals = computed.perPeriodSalesValues.reduce<number[]>(
      (acc, periodVals) => {
        for (let i = 0; i < periodVals.length; i++) {
          acc[i] = (acc[i] ?? 0) + periodVals[i]
        }
        return acc
      },
      []
    )

    return {
      storeName: store.name,
      periods,
      rows: computed.rows,
      fixedLaborConfigured: store.fixedMonthlyLabor != null,
      fixedRentConfigured: store.fixedMonthlyRent != null,
      kpis: {
        grossSales,
        netAfterCommissions,
        fixedCosts,
        bottomLine,
        marginPct,
      },
      channelMix: channelMix(totalChannelVals),
      trend: {
        totalSales: computed.totalSales,
        bottomLine: computed.bottomLine,
      },
      cogs: {
        totalCogs,
        grossProfit,
        grossMarginPct,
        unmappedItems: cogs.unmappedItems,
      },
    }
  } catch (error) {
    console.error("getStorePnL error:", error)
    const msg = error instanceof Error ? error.message : String(error)
    return { error: `Failed to load P&L: ${msg.slice(0, 300)}` }
  }
}

// ─── All-stores P&L for the /dashboard/pnl overview ───

export type AllStoresPnLResult =
  | {
      storeCount: number
      combined: {
        grossSales: number
        netAfterCommissions: number
        fixedCosts: number
        bottomLine: number
        marginPct: number
      }
      perStore: Array<{
        storeId: string
        storeName: string
        grossSales: number
        netAfterCommissions: number
        fixedCosts: number
        bottomLine: number
        marginPct: number
        channelMix: Array<{ channel: string; amount: number }>
        fixedCostsConfigured: boolean
      }>
      periods: Period[]
    }
  | { error: string }

export async function getAllStoresPnL(input: {
  startDate: Date
  endDate: Date
  granularity: Granularity
}): Promise<AllStoresPnLResult> {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return { error: "Unauthorized" }
    if (session.user.role !== "OWNER") return { error: "P&L is restricted to owners" }

    const stores = await prisma.store.findMany({
      where: { ownerId: session.user.id, isActive: true },
      select: {
        id: true,
        name: true,
        fixedMonthlyLabor: true,
        fixedMonthlyRent: true,
        fixedMonthlyTowels: true,
        fixedMonthlyCleaning: true,
        uberCommissionRate: true,
        doordashCommissionRate: true,
      },
      orderBy: { name: "asc" },
    })

    const periods = buildPeriods(input.startDate, input.endDate, input.granularity)
    if (stores.length === 0 || periods.length === 0) {
      return {
        storeCount: 0,
        combined: {
          grossSales: 0,
          netAfterCommissions: 0,
          fixedCosts: 0,
          bottomLine: 0,
          marginPct: 0,
        },
        perStore: [],
        periods,
      }
    }

    const storeIds = stores.map((s) => s.id)
    const overallStart = periods[0].startDate
    const overallEnd = periods[periods.length - 1].endDate

    const allSummaries = await prisma.otterDailySummary.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: overallStart, lte: overallEnd },
      },
      select: {
        storeId: true,
        date: true,
        platform: true,
        paymentMethod: true,
        fpGrossSales: true,
        tpGrossSales: true,
        fpTaxCollected: true,
        tpTaxCollected: true,
        fpDiscounts: true,
        tpDiscounts: true,
        fpServiceCharges: true,
        tpServiceCharges: true,
      },
    })

    const byStore = new Map<string, typeof allSummaries>()
    for (const s of allSummaries) {
      const arr = byStore.get(s.storeId) ?? []
      arr.push(s)
      byStore.set(s.storeId, arr)
    }

    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

    const allCogsRows = await prisma.dailyCogsItem.findMany({
      where: {
        storeId: { in: storeIds },
        date: { gte: overallStart, lte: overallEnd },
      },
      select: {
        storeId: true,
        date: true,
        itemName: true,
        category: true,
        qtySold: true,
        salesRevenue: true,
        lineCost: true,
        status: true,
        recipeId: true,
      },
    })
    const cogsByStore = new Map<string, DailyCogsRow[]>()
    for (const r of allCogsRows) {
      const arr = cogsByStore.get(r.storeId) ?? []
      arr.push(r)
      cogsByStore.set(r.storeId, arr)
    }

    const perStore = stores.map((store) => {
      const storeSummaries = byStore.get(store.id) ?? []
      const bucketed = bucketSummariesByPeriod(storeSummaries, periods)
      const storeCogs = summarizeDailyCogs(cogsByStore.get(store.id) ?? [], periods)
      const computed = computeStorePnL({
        bucketed,
        periods,
        store,
        cogsValues: storeCogs.cogsValues,
      })

      // Aggregate per-period arrays to range totals.
      const grossSales = sum(computed.totalSales)
      const netAfterCommissions = sum(computed.netAfterCommissions)
      const fixedCosts =
        sum(computed.laborValues) +
        sum(computed.rentValues) +
        sum(computed.towelsValues) +
        sum(computed.cleaningValues)
      const bottomLine = sum(computed.bottomLine)
      const marginPct = grossSales === 0 ? 0 : bottomLine / grossSales

      // Sum per-channel across periods for the mini mix bar.
      const totalChannelVals = computed.perPeriodSalesValues.reduce<number[]>(
        (acc, periodVals) => {
          for (let i = 0; i < periodVals.length; i++) {
            acc[i] = (acc[i] ?? 0) + periodVals[i]
          }
          return acc
        },
        []
      )

      return {
        storeId: store.id,
        storeName: store.name,
        grossSales,
        netAfterCommissions,
        fixedCosts,
        bottomLine,
        marginPct,
        channelMix: channelMix(totalChannelVals),
        fixedCostsConfigured:
          store.fixedMonthlyLabor != null && store.fixedMonthlyRent != null,
      }
    })

    const combined = {
      grossSales: sum(perStore.map((p) => p.grossSales)),
      netAfterCommissions: sum(perStore.map((p) => p.netAfterCommissions)),
      fixedCosts: sum(perStore.map((p) => p.fixedCosts)),
      bottomLine: sum(perStore.map((p) => p.bottomLine)),
      marginPct: 0,
    }
    combined.marginPct =
      combined.grossSales === 0 ? 0 : combined.bottomLine / combined.grossSales

    return {
      storeCount: stores.length,
      combined,
      perStore,
      periods,
    }
  } catch (error) {
    console.error("getAllStoresPnL error:", error)
    const msg = error instanceof Error ? error.message : String(error)
    return { error: `Failed to load P&L: ${msg.slice(0, 300)}` }
  }
}

/**
 * Force a full recompute of DailyCogsItem rows for one store across the last
 * `lookbackDays` days. Useful after a retroactive correction (e.g., editing an
 * old invoice). Safe to call repeatedly; idempotent.
 */
export async function recomputeCogsForStore(input: {
  storeId: string
  lookbackDays?: number
}): Promise<
  | { daysProcessed: number; rowsWritten: number }
  | { error: string }
> {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return { error: "Unauthorized" }
    if (session.user.role !== "OWNER")
      return { error: "P&L is restricted to owners" }

    const store = await prisma.store.findFirst({
      where: { id: input.storeId, ownerId: session.user.id },
      select: { id: true },
    })
    if (!store) return { error: "Store not found" }

    const lookbackDays = input.lookbackDays ?? 90
    const endDate = new Date()
    endDate.setUTCHours(0, 0, 0, 0)
    const startDate = new Date(endDate)
    startDate.setUTCDate(startDate.getUTCDate() - lookbackDays)

    const result = await recomputeDailyCogsForRange({
      storeId: store.id,
      startDate,
      endDate,
      ownerId: session.user.id,
    })

    revalidatePath(`/dashboard/pnl/${store.id}`)
    revalidatePath(`/dashboard/pnl`)
    return result
  } catch (error) {
    console.error("recomputeCogsForStore error:", error)
    const msg = error instanceof Error ? error.message : String(error)
    return { error: `Failed to recompute COGS: ${msg.slice(0, 300)}` }
  }
}
