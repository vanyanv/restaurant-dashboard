"use server"

import { revalidatePath } from "next/cache"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

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
      include: {
        _count: {
          select: {
            managers: true,
            reports: true,
          }
        }
      }
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
      where: session.user.role === "OWNER" 
        ? { 
            ownerId: session.user.id,
            isActive: true
          }
        : {
            isActive: true,
            managers: {
              some: {
                managerId: session.user.id,
                isActive: true
              }
            }
          },
      include: {
        _count: {
          select: {
            managers: true,
            reports: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    return stores
  } catch (error) {
    console.error("Get stores error:", error)
    return []
  }
}

export async function getStoreAnalytics() {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return null
    }

    const stores = await getStores()
    
    if (stores.length === 0) {
      return {
        todayReports: 0,
        totalReports: 0,
        totalRevenue: 0,
        averageTips: 0,
        avgPrepCompletion: 0,
        trends: {
          revenueGrowth: 0,
          currentWeekRevenue: 0,
          previousWeekRevenue: 0
        },
        storeCount: 0
      }
    }

    const storeIds = stores.map(s => s.id)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    // Get today's reports
    const todayReports = await prisma.dailyReport.count({
      where: {
        storeId: { in: storeIds },
        date: {
          gte: today,
        }
      }
    })

    // Get last 30 days of reports
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    
    const reports = await prisma.dailyReport.findMany({
      where: {
        storeId: { in: storeIds },
        date: {
          gte: thirtyDaysAgo,
        }
      }
    })

    const totalReports = reports.length
    const totalRevenue = reports.reduce((sum, r) => sum + (r.totalSales || 0), 0)
    const totalTips = reports.reduce((sum, r) => sum + r.tipCount, 0)
    const averageTips = totalReports > 0 ? totalTips / totalReports : 0
    
    const prepCompletions = reports.map(r => (r.morningPrepCompleted + r.eveningPrepCompleted) / 2)
    const avgPrepCompletion = prepCompletions.length > 0 
      ? Math.round(prepCompletions.reduce((sum, p) => sum + p, 0) / prepCompletions.length)
      : 0

    // Calculate week-over-week growth
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const fourteenDaysAgo = new Date()
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

    const currentWeekReports = reports.filter(r => r.date >= sevenDaysAgo)
    const previousWeekReports = reports.filter(r => 
      r.date >= fourteenDaysAgo && r.date < sevenDaysAgo
    )

    const currentWeekRevenue = currentWeekReports.reduce((sum, r) => sum + (r.totalSales || 0), 0)
    const previousWeekRevenue = previousWeekReports.reduce((sum, r) => sum + (r.totalSales || 0), 0)
    
    const revenueGrowth = previousWeekRevenue > 0 
      ? ((currentWeekRevenue - previousWeekRevenue) / previousWeekRevenue) * 100 
      : 0

    return {
      todayReports,
      totalReports,
      totalRevenue,
      averageTips,
      avgPrepCompletion,
      trends: {
        revenueGrowth: Math.round(revenueGrowth * 100) / 100,
        currentWeekRevenue,
        previousWeekRevenue
      },
      storeCount: stores.length
    }
  } catch (error) {
    console.error("Get analytics error:", error)
    return null
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
      rangeStart = new Date(options.startDate + "T00:00:00")
      rangeEnd = new Date(options.endDate + "T23:59:59")
    } else {
      rangeEnd = new Date()
      rangeStart = new Date()
      if (days === 1) {
        rangeStart.setHours(0, 0, 0, 0)
      } else {
        rangeStart.setDate(rangeEnd.getDate() - days)
        rangeStart.setHours(0, 0, 0, 0)
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

    const rangeEnd = new Date()
    const rangeStart = new Date()
    rangeStart.setDate(rangeEnd.getDate() - days)
    rangeStart.setHours(0, 0, 0, 0)

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
      rangeStart = new Date(options.startDate + "T00:00:00")
      rangeEnd = new Date(options.endDate + "T23:59:59")
    } else {
      rangeEnd = new Date()
      rangeStart = new Date()
      if (days === 1) {
        rangeStart.setHours(0, 0, 0, 0)
      } else {
        rangeStart.setDate(rangeEnd.getDate() - days)
        rangeStart.setHours(0, 0, 0, 0)
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
      rangeStart = new Date(options.startDate + "T00:00:00")
      rangeEnd = new Date(options.endDate + "T23:59:59")
    } else {
      rangeEnd = new Date()
      rangeStart = new Date()
      if (days === 1) {
        rangeStart.setHours(0, 0, 0, 0)
      } else {
        rangeStart.setDate(rangeEnd.getDate() - days)
        rangeStart.setHours(0, 0, 0, 0)
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

export async function getStoreById(storeId: string) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return null
    }

    const store = await prisma.store.findFirst({
      where: {
        id: storeId,
        AND: session.user.role === "OWNER" 
          ? { ownerId: session.user.id }
          : {
              managers: {
                some: {
                  managerId: session.user.id,
                  isActive: true
                }
              }
            }
      },
      include: {
        _count: {
          select: {
            managers: true,
            reports: true,
          }
        },
        managers: {
          where: { isActive: true },
          include: {
            manager: {
              select: {
                id: true,
                name: true,
                email: true,
              }
            }
          }
        }
      }
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

    const validatedData = updateStoreSchema.parse({
      name: formData.get("name"),
      address: formData.get("address") || undefined,
      phone: formData.get("phone") || undefined,
      isActive: formData.get("isActive") === "true",
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
      include: {
        _count: {
          select: {
            managers: true,
            reports: true,
          }
        }
      }
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
      include: {
        _count: {
          select: {
            reports: true,
            managers: true,
          }
        }
      }
    })

    if (!existingStore) {
      return { error: "Store not found or access denied" }
    }

    // Soft delete - set as inactive instead of hard delete
    await prisma.store.update({
      where: { id: storeId },
      data: { isActive: false }
    })

    // Deactivate all manager assignments
    await prisma.storeManager.updateMany({
      where: { storeId: storeId },
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

export async function getRecentReports(storeId?: string, limit: number = 15) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return []
    }

    const whereClause = session.user.role === "OWNER"
      ? {
          store: { ownerId: session.user.id },
          ...(storeId ? { storeId } : {})
        }
      : {
          managerId: session.user.id,
          ...(storeId ? { storeId } : {})
        }

    const reports = await prisma.dailyReport.findMany({
      where: whereClause,
      include: {
        store: {
          select: {
            id: true,
            name: true
          }
        },
        manager: {
          select: {
            name: true,
            email: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    })

    return reports
  } catch (error) {
    console.error("Get recent reports error:", error)
    return []
  }
}

export async function getStoreMetrics(storeId: string, days: number = 30) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return null
    }

    // Verify access to store
    const store = await getStoreById(storeId)
    if (!store) {
      return null
    }

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)
    
    const reports = await prisma.dailyReport.findMany({
      where: {
        storeId,
        date: {
          gte: startDate,
        }
      },
      include: {
        manager: {
          select: {
            name: true,
            email: true
          }
        }
      },
      orderBy: { date: 'desc' }
    })

    // Calculate daily revenue trends
    const revenueByDate = reports.reduce((acc: Record<string, number>, report) => {
      const dateStr = report.date.toISOString().split('T')[0]
      acc[dateStr] = (acc[dateStr] || 0) + (report.totalSales || 0)
      return acc
    }, {})

    const revenueTrends = Object.entries(revenueByDate)
      .map(([date, revenue]) => ({ date, revenue }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // Calculate prep task completion rates
    const prepTasks = ['prepMeat', 'prepSauce', 'prepOnionsSliced', 'prepOnionsDiced', 'prepTomatoesSliced', 'prepLettuce'] as const
    const prepCompletion = prepTasks.map(task => ({
      task: task.replace('prep', '').replace(/([A-Z])/g, ' $1').trim(),
      completed: reports.filter(r => r[task]).length,
      total: reports.length,
      percentage: reports.length > 0 ? Math.round((reports.filter(r => r[task]).length / reports.length) * 100) : 0
    }))

    // Manager performance
    const managerStats = reports.reduce((acc: Record<string, any>, report) => {
      const managerId = report.managerId
      if (!acc[managerId]) {
        acc[managerId] = {
          name: report.manager.name,
          email: report.manager.email,
          reportsCount: 0,
          totalRevenue: 0,
          avgPrepCompletion: 0,
          prepScores: []
        }
      }
      acc[managerId].reportsCount++
      acc[managerId].totalRevenue += report.totalSales || 0
      const prepScore = (report.morningPrepCompleted + report.eveningPrepCompleted) / 2
      acc[managerId].prepScores.push(prepScore)
      return acc
    }, {})

    // Calculate average prep completion for each manager
    Object.values(managerStats).forEach((manager: any) => {
      manager.avgPrepCompletion = manager.prepScores.length > 0 
        ? Math.round(manager.prepScores.reduce((sum: number, score: number) => sum + score, 0) / manager.prepScores.length)
        : 0
      delete manager.prepScores // Remove temporary array
    })

    // Shift performance comparison
    const morningReports = reports.filter(r => r.shift === 'MORNING' || r.shift === 'BOTH')
    const eveningReports = reports.filter(r => r.shift === 'EVENING' || r.shift === 'BOTH')

    const shiftComparison = {
      morning: {
        count: morningReports.length,
        avgRevenue: morningReports.length > 0 ? morningReports.reduce((sum, r) => sum + (r.totalSales || 0), 0) / morningReports.length : 0,
        avgPrepCompletion: morningReports.length > 0 ? Math.round(morningReports.reduce((sum, r) => sum + r.morningPrepCompleted, 0) / morningReports.length) : 0
      },
      evening: {
        count: eveningReports.length,
        avgRevenue: eveningReports.length > 0 ? eveningReports.reduce((sum, r) => sum + (r.totalSales || 0), 0) / eveningReports.length : 0,
        avgPrepCompletion: eveningReports.length > 0 ? Math.round(eveningReports.reduce((sum, r) => sum + r.eveningPrepCompleted, 0) / eveningReports.length) : 0
      }
    }

    // Till variance analysis
    const tillVariances = reports.map(r => ({
      date: r.date.toISOString().split('T')[0],
      shift: r.shift,
      variance: r.endingAmount - r.startingAmount,
      manager: r.manager.name
    }))

    return {
      store,
      totalReports: reports.length,
      dateRange: { start: startDate, end: new Date() },
      revenueTrends,
      prepCompletion,
      managerStats: Object.values(managerStats),
      shiftComparison,
      tillVariances,
      summary: {
        totalRevenue: reports.reduce((sum, r) => sum + (r.totalSales || 0), 0),
        avgTips: reports.length > 0 ? reports.reduce((sum, r) => sum + (r.cashTips || 0), 0) / reports.length : 0,
        avgPrepCompletion: reports.length > 0 ? Math.round(reports.reduce((sum, r) => sum + ((r.morningPrepCompleted + r.eveningPrepCompleted) / 2), 0) / reports.length) : 0
      }
    }
  } catch (error) {
    console.error("Get store metrics error:", error)
    return null
  }
}

export async function getTodayReportStatus() {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user || session.user.role !== "OWNER") {
      return []
    }

    const stores = await getStores()
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const todayReports = await prisma.dailyReport.findMany({
      where: {
        storeId: { in: stores.map(s => s.id) },
        date: {
          gte: today,
        }
      },
      select: {
        storeId: true,
        shift: true,
        managerId: true,
        manager: {
          select: {
            name: true
          }
        }
      }
    })

    // Create status grid for each store
    const statusGrid = stores.map(store => {
      const storeReports = todayReports.filter(r => r.storeId === store.id)
      const morningReport = storeReports.find(r => r.shift === 'MORNING' || r.shift === 'BOTH')
      const eveningReport = storeReports.find(r => r.shift === 'EVENING' || r.shift === 'BOTH')

      return {
        storeId: store.id,
        storeName: store.name,
        morning: {
          submitted: !!morningReport,
          manager: morningReport?.manager.name || null
        },
        evening: {
          submitted: !!eveningReport,
          manager: eveningReport?.manager.name || null
        }
      }
    })

    return statusGrid
  } catch (error) {
    console.error("Get today report status error:", error)
    return []
  }
}

export async function getPerformanceAlerts() {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user) {
      return []
    }

    const stores = await getStores()
    const alerts: any[] = []

    // Check for missing reports today
    const statusGrid = await getTodayReportStatus()
    statusGrid.forEach(store => {
      if (!store.morning.submitted) {
        alerts.push({
          type: 'missing_report',
          severity: 'warning',
          storeId: store.storeId,
          storeName: store.storeName,
          message: 'Missing morning report',
          shift: 'MORNING'
        })
      }
      if (!store.evening.submitted) {
        alerts.push({
          type: 'missing_report',
          severity: 'warning',
          storeId: store.storeId,
          storeName: store.storeName,
          message: 'Missing evening report',
          shift: 'EVENING'
        })
      }
    })

    // Check for low prep completion in recent reports
    const recentReports = await getRecentReports(undefined, 50)
    recentReports.forEach(report => {
      const avgPrep = (report.morningPrepCompleted + report.eveningPrepCompleted) / 2
      if (avgPrep < 70) {
        alerts.push({
          type: 'low_prep',
          severity: 'error',
          storeId: report.storeId,
          storeName: report.store.name,
          message: `Low prep completion: ${Math.round(avgPrep)}%`,
          manager: report.manager.name,
          date: report.date
        })
      }
    })

    return alerts.slice(0, 10) // Limit to 10 most recent alerts
  } catch (error) {
    console.error("Get performance alerts error:", error)
    return []
  }
}