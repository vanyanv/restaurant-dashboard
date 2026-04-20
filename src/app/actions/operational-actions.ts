"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getStores } from "./store-actions"
import { todayInLA, startOfDayLA, endOfDayLA } from "@/lib/dashboard-utils"
import { getISOWeek, getISOWeekYear, startOfISOWeek, endOfISOWeek, format } from "date-fns"
import type {
  OperationsData,
  WeeklyBucket,
  CategorySpending,
  OperationsKpis,
} from "@/types/operations"

function dateToWeekKey(d: Date): string {
  const y = getISOWeekYear(d)
  const w = getISOWeek(d)
  return `${y}-W${String(w).padStart(2, "0")}`
}

function shortWeekLabel(d: Date): string {
  return `W${String(getISOWeek(d)).padStart(2, "0")}`
}

export async function getOperationalAnalytics(
  storeId?: string,
  options?: { days?: number; startDate?: string; endDate?: string }
): Promise<OperationsData | null> {
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
    const start = startOfDayLA(today)
    if (days === -1) {
      start.setDate(start.getDate() - 1)
      rangeStart = start
      rangeEnd = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1)
    } else {
      start.setDate(start.getDate() - (days === 1 ? 0 : days))
      rangeStart = start
    }
  }

  const dayCount = Math.max(1, Math.ceil(
    (rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24)
  ))

  // Previous period for comparison
  const prevEnd = new Date(rangeStart.getTime() - 1)
  const prevStart = new Date(prevEnd)
  prevStart.setDate(prevStart.getDate() - dayCount)
  prevStart.setHours(0, 0, 0, 0)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoiceWhereCurrent: any = {
    ownerId: session.user.id,
    invoiceDate: { not: null, gte: rangeStart, lte: rangeEnd },
  }
  if (storeId) invoiceWhereCurrent.storeId = storeId

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoiceWherePrevious: any = {
    ownerId: session.user.id,
    invoiceDate: { not: null, gte: prevStart, lte: prevEnd },
  }
  if (storeId) invoiceWherePrevious.storeId = storeId

  // 5 parallel queries
  const [otterCurrent, otterPrevious, invoicesCurrent, invoicesPrevious, lineItemsCurrent] =
    await Promise.all([
      prisma.otterDailySummary.findMany({
        where: { storeId: { in: storeIds }, date: { gte: rangeStart, lte: rangeEnd } },
      }),
      prisma.otterDailySummary.findMany({
        where: { storeId: { in: storeIds }, date: { gte: prevStart, lte: prevEnd } },
      }),
      prisma.invoice.findMany({
        where: invoiceWhereCurrent,
        select: { totalAmount: true, invoiceDate: true, storeId: true },
      }),
      prisma.invoice.findMany({
        where: invoiceWherePrevious,
        select: { totalAmount: true },
      }),
      prisma.invoiceLineItem.findMany({
        where: { invoice: invoiceWhereCurrent },
        select: { category: true, extendedPrice: true },
      }),
    ])

  // Build weekly buckets
  const bucketMap = new Map<string, {
    weekLabel: string; weekStart: string; weekEnd: string
    spending: number; revenue: number; orders: number
  }>()

  function ensureBucket(d: Date) {
    const key = dateToWeekKey(d)
    if (!bucketMap.has(key)) {
      const ws = startOfISOWeek(d)
      const we = endOfISOWeek(d)
      bucketMap.set(key, {
        weekLabel: shortWeekLabel(d),
        weekStart: format(ws, "yyyy-MM-dd"),
        weekEnd: format(we, "yyyy-MM-dd"),
        spending: 0, revenue: 0, orders: 0,
      })
    }
    return key
  }

  // Populate from Otter (revenue + orders)
  for (const row of otterCurrent) {
    const key = ensureBucket(row.date)
    const b = bucketMap.get(key)!
    b.revenue += (row.fpGrossSales ?? 0) + (row.tpGrossSales ?? 0)
    b.orders += (row.fpOrderCount ?? 0) + (row.tpOrderCount ?? 0)
  }

  // Populate from invoices (spending)
  for (const inv of invoicesCurrent) {
    if (!inv.invoiceDate) continue
    const key = ensureBucket(inv.invoiceDate)
    bucketMap.get(key)!.spending += inv.totalAmount
  }

  // Convert to sorted array
  const weeklyBuckets: WeeklyBucket[] = Array.from(bucketMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, b]) => ({
      weekLabel: b.weekLabel,
      weekStart: b.weekStart,
      weekEnd: b.weekEnd,
      totalSpending: b.spending,
      totalRevenue: b.revenue,
      totalOrders: b.orders,
      costPerOrder: b.orders > 0 ? b.spending / b.orders : 0,
      grossMarginPct: b.revenue > 0 ? ((b.revenue - b.spending) / b.revenue) * 100 : null,
      cogsRatioPct: b.revenue > 0 ? (b.spending / b.revenue) * 100 : null,
    }))

  // Category breakdown from line items
  const catMap: Record<string, number> = {}
  for (const li of lineItemsCurrent) {
    const cat = li.category ?? "Other"
    catMap[cat] = (catMap[cat] ?? 0) + li.extendedPrice
  }
  const totalCatSpend = Object.values(catMap).reduce((s, v) => s + v, 0)
  const categoryBreakdown: CategorySpending[] = Object.entries(catMap)
    .map(([category, totalSpend]) => ({
      category,
      totalSpend,
      percentOfTotal: totalCatSpend > 0 ? (totalSpend / totalCatSpend) * 100 : 0,
    }))
    .sort((a, b) => b.totalSpend - a.totalSpend)

  // Compute KPIs + comparison
  function computeKpis(
    otterRows: typeof otterCurrent,
    invRows: { totalAmount: number }[]
  ): OperationsKpis {
    const totalRevenue = otterRows.reduce(
      (s, r) => s + (r.fpGrossSales ?? 0) + (r.tpGrossSales ?? 0), 0
    )
    const totalOrders = otterRows.reduce(
      (s, r) => s + (r.fpOrderCount ?? 0) + (r.tpOrderCount ?? 0), 0
    )
    const totalSpending = invRows.reduce((s, r) => s + r.totalAmount, 0)
    return {
      costPerOrder: totalOrders > 0 ? totalSpending / totalOrders : 0,
      grossMarginPct: totalRevenue > 0
        ? ((totalRevenue - totalSpending) / totalRevenue) * 100
        : null,
      totalSpending,
      totalRevenue,
      totalOrders,
    }
  }

  const current = computeKpis(otterCurrent, invoicesCurrent)
  const previous = computeKpis(otterPrevious, invoicesPrevious)

  const pctChange = (cur: number, prev: number) =>
    prev > 0 ? ((cur - prev) / prev) * 100 : null

  const comparison = {
    current,
    previous,
    costPerOrderChange: pctChange(current.costPerOrder, previous.costPerOrder),
    grossMarginChange:
      current.grossMarginPct !== null && previous.grossMarginPct !== null
        ? current.grossMarginPct - previous.grossMarginPct
        : null,
    spendingChange: pctChange(current.totalSpending, previous.totalSpending) ?? 0,
    revenueChange: pctChange(current.totalRevenue, previous.totalRevenue) ?? 0,
    ordersChange: pctChange(current.totalOrders, previous.totalOrders) ?? 0,
  }

  return {
    weeklyBuckets,
    categoryBreakdown,
    comparison,
    dateRange: {
      startDate: rangeStart.toISOString().slice(0, 10),
      endDate: rangeEnd.toISOString().slice(0, 10),
    },
    weekCount: weeklyBuckets.length,
  }
}
