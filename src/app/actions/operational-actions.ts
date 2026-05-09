"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getStores } from "./store-actions"
import { todayInLA, startOfDayLA, endOfDayLA } from "@/lib/dashboard-utils"
import {
  bucketDailyToWeekly,
  shapeCategoryBreakdown,
} from "@/lib/operational-analytics-aggregation"
import type {
  OperationsData,
  OperationsKpis,
} from "@/types/operations"

export async function getOperationalAnalytics(
  storeId?: string,
  options?: { days?: number; startDate?: string; endDate?: string }
): Promise<OperationsData | null> {
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

  const dayCount = Math.max(
    1,
    Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24))
  )

  const prevEnd = new Date(rangeStart.getTime() - 1)
  const prevStart = new Date(prevEnd)
  prevStart.setDate(prevStart.getDate() - dayCount)
  prevStart.setHours(0, 0, 0, 0)

  const accountId = session.user.accountId
  const invoiceWhereCurrent = {
    accountId,
    invoiceDate: { not: null, gte: rangeStart, lte: rangeEnd },
    ...(storeId ? { storeId } : {}),
  } as const
  const invoiceWherePrevious = {
    accountId,
    invoiceDate: { not: null, gte: prevStart, lte: prevEnd },
    ...(storeId ? { storeId } : {}),
  } as const

  const [
    otterCurrentByDay,
    otterPreviousAgg,
    invoicesCurrentByDay,
    invoicesPreviousAgg,
    lineItemCategoryAgg,
  ] = await Promise.all([
    prisma.otterDailySummary.groupBy({
      by: ["date"],
      where: { storeId: { in: storeIds }, date: { gte: rangeStart, lte: rangeEnd } },
      _sum: {
        fpGrossSales: true,
        tpGrossSales: true,
        fpOrderCount: true,
        tpOrderCount: true,
      },
    }),
    prisma.otterDailySummary.aggregate({
      where: { storeId: { in: storeIds }, date: { gte: prevStart, lte: prevEnd } },
      _sum: {
        fpGrossSales: true,
        tpGrossSales: true,
        fpOrderCount: true,
        tpOrderCount: true,
      },
    }),
    prisma.invoice.groupBy({
      by: ["invoiceDate"],
      where: invoiceWhereCurrent,
      _sum: { totalAmount: true },
    }),
    prisma.invoice.aggregate({
      where: invoiceWherePrevious,
      _sum: { totalAmount: true },
    }),
    prisma.invoiceLineItem.groupBy({
      by: ["category"],
      where: { invoice: invoiceWhereCurrent },
      _sum: { extendedPrice: true },
    }),
  ])

  const weeklyBuckets = bucketDailyToWeekly(
    otterCurrentByDay.map((r) => ({
      date: r.date,
      revenue: (r._sum.fpGrossSales ?? 0) + (r._sum.tpGrossSales ?? 0),
      orders: (r._sum.fpOrderCount ?? 0) + (r._sum.tpOrderCount ?? 0),
    })),
    invoicesCurrentByDay
      .filter((r): r is { invoiceDate: Date; _sum: { totalAmount: number | null } } =>
        r.invoiceDate !== null
      )
      .map((r) => ({
        date: r.invoiceDate,
        spending: r._sum.totalAmount ?? 0,
      }))
  )

  const categoryBreakdown = shapeCategoryBreakdown(
    lineItemCategoryAgg.map((r) => ({
      category: r.category,
      totalSpend: r._sum.extendedPrice ?? 0,
    }))
  )

  const currentRevenue =
    otterCurrentByDay.reduce(
      (s, r) => s + (r._sum.fpGrossSales ?? 0) + (r._sum.tpGrossSales ?? 0),
      0
    )
  const currentOrders =
    otterCurrentByDay.reduce(
      (s, r) => s + (r._sum.fpOrderCount ?? 0) + (r._sum.tpOrderCount ?? 0),
      0
    )
  const currentSpending = invoicesCurrentByDay.reduce(
    (s, r) => s + (r._sum.totalAmount ?? 0),
    0
  )

  const previousRevenue =
    (otterPreviousAgg._sum.fpGrossSales ?? 0) +
    (otterPreviousAgg._sum.tpGrossSales ?? 0)
  const previousOrders =
    (otterPreviousAgg._sum.fpOrderCount ?? 0) +
    (otterPreviousAgg._sum.tpOrderCount ?? 0)
  const previousSpending = invoicesPreviousAgg._sum.totalAmount ?? 0

  function kpis(
    revenue: number,
    orders: number,
    spending: number
  ): OperationsKpis {
    return {
      costPerOrder: orders > 0 ? spending / orders : 0,
      grossMarginPct:
        revenue > 0 ? ((revenue - spending) / revenue) * 100 : null,
      totalSpending: spending,
      totalRevenue: revenue,
      totalOrders: orders,
    }
  }

  const current = kpis(currentRevenue, currentOrders, currentSpending)
  const previous = kpis(previousRevenue, previousOrders, previousSpending)

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
