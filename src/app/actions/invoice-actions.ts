"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import type {
  InvoiceKpis,
  ProductAnalytics,
  InvoiceBreakdownData,
  InvoiceStoreRow,
  InvoiceVendorRow,
  PriceMoverRow,
} from "@/types/invoice"

function isoToStartOfDay(iso: string): Date {
  return new Date(`${iso}T00:00:00`)
}

function isoToEndOfDay(iso: string): Date {
  return new Date(`${iso}T23:59:59.999`)
}

export async function getInvoiceSummary(options?: {
  storeId?: string
  days?: number
  startDate?: string
  endDate?: string
}): Promise<InvoiceKpis> {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return {
      totalSpend: 0, invoiceCount: 0, avgInvoiceTotal: 0,
      pendingReviewCount: 0, vendorCount: 0,
      spendByVendor: [], spendByCategory: [],
    }
  }

  const { storeId, days, startDate, endDate } = options ?? {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { ownerId: session.user.id }
  if (storeId) where.storeId = storeId
  if (startDate && endDate) {
    where.invoiceDate = {
      gte: isoToStartOfDay(startDate),
      lte: isoToEndOfDay(endDate),
    }
  } else if (days) {
    const sinceDate = new Date()
    sinceDate.setDate(sinceDate.getDate() - days)
    where.invoiceDate = { gte: sinceDate }
  }

  const [invoices, pendingReview, lineItems] = await Promise.all([
    prisma.invoice.findMany({
      where,
      select: { vendorName: true, totalAmount: true },
    }),
    prisma.invoice.count({
      where: { ...where, status: "REVIEW" },
    }),
    prisma.invoiceLineItem.findMany({
      where: { invoice: where },
      select: { category: true, extendedPrice: true },
    }),
  ])

  const totalSpend = invoices.reduce((sum, i) => sum + i.totalAmount, 0)
  const invoiceCount = invoices.length
  const avgInvoiceTotal = invoiceCount > 0 ? totalSpend / invoiceCount : 0
  const vendorSet = new Set(invoices.map((i) => i.vendorName))

  // Spend by vendor
  const vendorMap: Record<string, number> = {}
  for (const inv of invoices) {
    vendorMap[inv.vendorName] = (vendorMap[inv.vendorName] ?? 0) + inv.totalAmount
  }
  const spendByVendor = Object.entries(vendorMap)
    .map(([vendor, total]) => ({ vendor, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)

  // Spend by category
  const categoryMap: Record<string, number> = {}
  for (const li of lineItems) {
    const cat = li.category ?? "Other"
    categoryMap[cat] = (categoryMap[cat] ?? 0) + li.extendedPrice
  }
  const spendByCategory = Object.entries(categoryMap)
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total)

  return {
    totalSpend,
    invoiceCount,
    avgInvoiceTotal,
    pendingReviewCount: pendingReview,
    vendorCount: vendorSet.size,
    spendByVendor,
    spendByCategory,
  }
}

export async function getInvoiceList(filters?: {
  storeId?: string
  status?: string
  vendor?: string
  startDate?: string
  endDate?: string
  page?: number
  limit?: number
}) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return { invoices: [], total: 0, page: 1, totalPages: 0 }

  const {
    storeId,
    status,
    vendor,
    startDate,
    endDate,
    page = 1,
    limit = 25,
  } = filters ?? {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { ownerId: session.user.id }
  if (storeId) where.storeId = storeId
  if (status) where.status = status
  if (vendor) {
    where.vendorName = { contains: vendor, mode: "insensitive" }
  }
  if (startDate && endDate) {
    where.invoiceDate = {
      gte: isoToStartOfDay(startDate),
      lte: isoToEndOfDay(endDate),
    }
  }

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      select: {
        id: true,
        vendorName: true,
        invoiceNumber: true,
        invoiceDate: true,
        totalAmount: true,
        status: true,
        storeId: true,
        matchConfidence: true,
        createdAt: true,
        store: { select: { name: true } },
        _count: { select: { lineItems: true } },
      },
      orderBy: [
        { invoiceDate: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
      ],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.invoice.count({ where }),
  ])

  return {
    invoices: invoices.map((inv) => ({
      id: inv.id,
      vendorName: inv.vendorName,
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate?.toISOString().slice(0, 10) ?? null,
      totalAmount: inv.totalAmount,
      status: inv.status,
      storeName: inv.store?.name ?? null,
      storeId: inv.storeId,
      matchConfidence: inv.matchConfidence,
      lineItemCount: inv._count.lineItems,
      createdAt: inv.createdAt.toISOString(),
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  }
}

export async function getProductAnalytics(options?: {
  storeId?: string
  days?: number
  startDate?: string
  endDate?: string
}): Promise<ProductAnalytics> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return { topProducts: [] }

  const { storeId, days, startDate, endDate } = options ?? {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoiceWhere: any = { ownerId: session.user.id }
  if (storeId) invoiceWhere.storeId = storeId
  if (startDate && endDate) {
    invoiceWhere.invoiceDate = {
      gte: isoToStartOfDay(startDate),
      lte: isoToEndOfDay(endDate),
    }
  } else {
    const fallbackDays = days ?? 90
    const sinceDate = new Date()
    sinceDate.setDate(sinceDate.getDate() - fallbackDays)
    invoiceWhere.invoiceDate = { gte: sinceDate }
  }

  const lineItems = await prisma.invoiceLineItem.findMany({
    where: { invoice: invoiceWhere },
    select: {
      sku: true,
      productName: true,
      category: true,
      quantity: true,
      unit: true,
      unitPrice: true,
      extendedPrice: true,
      invoiceId: true,
    },
  })

  // Group by productName (primary key for grouping)
  const productMap = new Map<string, {
    sku: string | null
    category: string | null
    totalQuantity: number
    totalSpend: number
    unit: string | null
    invoiceIds: Set<string>
    priceSum: number
    count: number
  }>()

  for (const li of lineItems) {
    const key = li.productName
    const existing = productMap.get(key)
    if (existing) {
      existing.totalQuantity += li.quantity
      existing.totalSpend += li.extendedPrice
      existing.invoiceIds.add(li.invoiceId)
      existing.priceSum += li.unitPrice
      existing.count++
      if (!existing.sku && li.sku) existing.sku = li.sku
    } else {
      productMap.set(key, {
        sku: li.sku,
        category: li.category,
        totalQuantity: li.quantity,
        totalSpend: li.extendedPrice,
        unit: li.unit,
        invoiceIds: new Set([li.invoiceId]),
        priceSum: li.unitPrice,
        count: 1,
      })
    }
  }

  const topProducts = Array.from(productMap.entries())
    .map(([productName, data]) => ({
      productName,
      sku: data.sku,
      category: data.category,
      totalQuantity: data.totalQuantity,
      totalSpend: data.totalSpend,
      unit: data.unit,
      avgUnitPrice: data.priceSum / data.count,
      invoiceCount: data.invoiceIds.size,
    }))
    .sort((a, b) => b.totalSpend - a.totalSpend)
    .slice(0, 20)

  return { topProducts }
}

export async function getInvoiceStoreBreakdown(options?: {
  days?: number
}): Promise<InvoiceBreakdownData> {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return {
      storeRows: [],
      vendorRows: [],
      storeTotals: { totalSpend: 0, invoiceCount: 0, avgInvoice: 0, vendorCount: 0, needsReview: 0 },
      vendorTotals: { totalSpend: 0, invoiceCount: 0, avgInvoice: 0, storeCount: 0, needsReview: 0 },
    }
  }

  const { days = 30 } = options ?? {}
  const sinceDate = new Date()
  sinceDate.setDate(sinceDate.getDate() - days)

  const baseWhere = {
    ownerId: session.user.id,
    invoiceDate: { gte: sinceDate },
  }

  const [byStore, byVendor, reviewByStore, reviewByVendor, pivot, stores] =
    await Promise.all([
      prisma.invoice.groupBy({
        by: ["storeId"],
        where: baseWhere,
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      prisma.invoice.groupBy({
        by: ["vendorName"],
        where: baseWhere,
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      prisma.invoice.groupBy({
        by: ["storeId"],
        where: { ...baseWhere, status: "REVIEW" },
        _count: { id: true },
      }),
      prisma.invoice.groupBy({
        by: ["vendorName"],
        where: { ...baseWhere, status: "REVIEW" },
        _count: { id: true },
      }),
      prisma.invoice.groupBy({
        by: ["storeId", "vendorName"],
        where: baseWhere,
        _sum: { totalAmount: true },
      }),
      prisma.store.findMany({
        where: { ownerId: session.user.id, isActive: true },
        select: { id: true, name: true },
      }),
    ])

  // Lookups
  const storeNameMap = new Map(stores.map((s) => [s.id, s.name]))
  const reviewByStoreMap = new Map(
    reviewByStore.map((r) => [r.storeId, r._count.id])
  )
  const reviewByVendorMap = new Map(
    reviewByVendor.map((r) => [r.vendorName, r._count.id])
  )

  // Store rows
  const storeRows: InvoiceStoreRow[] = byStore
    .map((row) => {
      const total = row._sum.totalAmount ?? 0
      const count = row._count.id
      const vendorsForStore = new Set(
        pivot.filter((p) => p.storeId === row.storeId).map((p) => p.vendorName)
      )
      return {
        storeId: row.storeId,
        storeName: row.storeId ? (storeNameMap.get(row.storeId) ?? "Unknown") : "Unassigned",
        totalSpend: total,
        invoiceCount: count,
        avgInvoice: count > 0 ? total / count : 0,
        vendorCount: vendorsForStore.size,
        needsReview: reviewByStoreMap.get(row.storeId) ?? 0,
      }
    })
    .sort((a, b) => b.totalSpend - a.totalSpend)

  // Vendor rows
  const vendorRows: InvoiceVendorRow[] = byVendor
    .map((row) => {
      const total = row._sum.totalAmount ?? 0
      const count = row._count.id
      const storesForVendor = new Set(
        pivot.filter((p) => p.vendorName === row.vendorName).map((p) => p.storeId)
      )
      return {
        vendorName: row.vendorName,
        totalSpend: total,
        invoiceCount: count,
        avgInvoice: count > 0 ? total / count : 0,
        storeCount: storesForVendor.size,
        needsReview: reviewByVendorMap.get(row.vendorName) ?? 0,
      }
    })
    .sort((a, b) => b.totalSpend - a.totalSpend)

  // Totals
  const storeTotals = {
    totalSpend: storeRows.reduce((s, r) => s + r.totalSpend, 0),
    invoiceCount: storeRows.reduce((s, r) => s + r.invoiceCount, 0),
    avgInvoice: 0,
    vendorCount: new Set(pivot.map((p) => p.vendorName)).size,
    needsReview: storeRows.reduce((s, r) => s + r.needsReview, 0),
  }
  storeTotals.avgInvoice =
    storeTotals.invoiceCount > 0
      ? storeTotals.totalSpend / storeTotals.invoiceCount
      : 0

  const vendorTotals = {
    totalSpend: vendorRows.reduce((s, r) => s + r.totalSpend, 0),
    invoiceCount: vendorRows.reduce((s, r) => s + r.invoiceCount, 0),
    avgInvoice: 0,
    storeCount: stores.length,
    needsReview: vendorRows.reduce((s, r) => s + r.needsReview, 0),
  }
  vendorTotals.avgInvoice =
    vendorTotals.invoiceCount > 0
      ? vendorTotals.totalSpend / vendorTotals.invoiceCount
      : 0

  return { storeRows, vendorRows, storeTotals, vendorTotals }
}

export async function getPriceMovers(options?: {
  periodDays?: number
  minPctChange?: number
  minLatestPrice?: number
  limit?: number
}): Promise<PriceMoverRow[]> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return []

  const periodDays = options?.periodDays ?? 90
  const minPctChange = options?.minPctChange ?? 5
  const minLatestPrice = options?.minLatestPrice ?? 0.5
  const limit = options?.limit ?? 20

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - periodDays)

  const lineItems = await prisma.invoiceLineItem.findMany({
    where: {
      invoice: {
        ownerId: session.user.id,
        invoiceDate: { gte: cutoff, not: null },
      },
      unitPrice: { gt: 0 },
    },
    select: {
      sku: true,
      productName: true,
      category: true,
      unit: true,
      unitPrice: true,
      canonicalIngredientId: true,
      canonicalIngredient: { select: { name: true } },
      invoice: {
        select: {
          vendorName: true,
          invoiceDate: true,
        },
      },
    },
  })

  interface Row {
    vendorName: string
    sku: string | null
    productName: string
    category: string | null
    unit: string | null
    unitPrice: number
    invoiceDate: Date
    canonicalIngredientId: string | null
    canonicalName: string | null
  }

  // Group by (vendor, canonical ingredient + unit) when matched; otherwise
  // (vendor, sku-or-productName) so unmatched items still surface. Unit is
  // part of the key — switching pack size is a re-quote, not a price change.
  const groups = new Map<string, Row[]>()
  for (const li of lineItems) {
    if (!li.invoice.invoiceDate) continue
    const vendor = li.invoice.vendorName
    const unitKey = li.unit?.trim().toUpperCase() || "∅"
    const idKey = li.canonicalIngredientId
      ? `canon:${li.canonicalIngredientId}`
      : `sku:${li.sku ?? li.productName.toLowerCase()}`
    const key = `${vendor}::${idKey}::${unitKey}`
    const arr = groups.get(key) ?? []
    arr.push({
      vendorName: vendor,
      sku: li.sku,
      productName: li.productName,
      category: li.category,
      unit: li.unit,
      unitPrice: li.unitPrice,
      invoiceDate: li.invoice.invoiceDate,
      canonicalIngredientId: li.canonicalIngredientId,
      canonicalName: li.canonicalIngredient?.name ?? null,
    })
    groups.set(key, arr)
  }

  const movers: PriceMoverRow[] = []
  for (const rows of groups.values()) {
    if (rows.length < 2) continue
    rows.sort((a, b) => b.invoiceDate.getTime() - a.invoiceDate.getTime())
    const [latest, prev] = rows
    if (latest.unitPrice < minLatestPrice) continue
    if (prev.unitPrice <= 0) continue
    const pctChange = ((latest.unitPrice - prev.unitPrice) / prev.unitPrice) * 100
    if (Math.abs(pctChange) < minPctChange) continue
    movers.push({
      vendorName: latest.vendorName,
      sku: latest.sku,
      productName: latest.productName,
      category: latest.category,
      unit: latest.unit,
      prevPrice: prev.unitPrice,
      prevDate: prev.invoiceDate.toISOString().slice(0, 10),
      latestPrice: latest.unitPrice,
      latestDate: latest.invoiceDate.toISOString().slice(0, 10),
      pctChange,
      canonicalIngredientId: latest.canonicalIngredientId,
      canonicalName: latest.canonicalName,
      sampleCount: rows.length,
    })
  }

  // Sort by magnitude of movement (up or down), largest first.
  movers.sort((a, b) => Math.abs(b.pctChange) - Math.abs(a.pctChange))
  return movers.slice(0, limit)
}

export interface SpendTimelineBucket {
  bucketStart: string // YYYY-MM-DD (inclusive)
  bucketEnd: string // YYYY-MM-DD (inclusive)
  label: string
  total: number
  invoiceCount: number
}

export interface SpendTimelineResult {
  buckets: SpendTimelineBucket[]
  granularity: "day" | "week" | "month"
  total: number
  invoiceCount: number
  avgPerBucket: number
  peakBucket: SpendTimelineBucket | null
}

function startOfWeekMonday(d: Date): Date {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  const day = copy.getDay() // 0 = Sun
  const diff = (day + 6) % 7
  copy.setDate(copy.getDate() - diff)
  return copy
}

function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export async function getInvoiceSpendTimeline(options: {
  storeId?: string
  startDate: string
  endDate: string
  granularity: "day" | "week" | "month"
}): Promise<SpendTimelineResult> {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return {
      buckets: [],
      granularity: options.granularity,
      total: 0,
      invoiceCount: 0,
      avgPerBucket: 0,
      peakBucket: null,
    }
  }

  const { storeId, startDate, endDate, granularity } = options

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    ownerId: session.user.id,
    invoiceDate: {
      gte: isoToStartOfDay(startDate),
      lte: isoToEndOfDay(endDate),
    },
  }
  if (storeId) where.storeId = storeId

  const invoices = await prisma.invoice.findMany({
    where,
    select: { invoiceDate: true, totalAmount: true },
  })

  // Build empty buckets across the range
  const start = isoToStartOfDay(startDate)
  const end = isoToStartOfDay(endDate)
  const buckets: SpendTimelineBucket[] = []

  if (granularity === "day") {
    const cursor = new Date(start)
    while (cursor <= end) {
      const s = isoDate(cursor)
      buckets.push({
        bucketStart: s,
        bucketEnd: s,
        label: cursor.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        total: 0,
        invoiceCount: 0,
      })
      cursor.setDate(cursor.getDate() + 1)
    }
  } else if (granularity === "week") {
    const cursor = startOfWeekMonday(start)
    while (cursor <= end) {
      const bucketEnd = new Date(cursor)
      bucketEnd.setDate(bucketEnd.getDate() + 6)
      buckets.push({
        bucketStart: isoDate(cursor),
        bucketEnd: isoDate(bucketEnd),
        label: `${cursor.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })}`,
        total: 0,
        invoiceCount: 0,
      })
      cursor.setDate(cursor.getDate() + 7)
    }
  } else {
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
    while (cursor <= end) {
      const monthEnd = new Date(
        cursor.getFullYear(),
        cursor.getMonth() + 1,
        0
      )
      buckets.push({
        bucketStart: isoDate(cursor),
        bucketEnd: isoDate(monthEnd),
        label: cursor.toLocaleDateString("en-US", {
          month: "short",
          year: "2-digit",
        }),
        total: 0,
        invoiceCount: 0,
      })
      cursor.setMonth(cursor.getMonth() + 1)
    }
  }

  // Fill buckets
  for (const inv of invoices) {
    if (!inv.invoiceDate) continue
    const d = inv.invoiceDate
    const idx = buckets.findIndex((b) => {
      const bs = isoToStartOfDay(b.bucketStart)
      const be = isoToEndOfDay(b.bucketEnd)
      return d >= bs && d <= be
    })
    if (idx === -1) continue
    buckets[idx].total += inv.totalAmount
    buckets[idx].invoiceCount += 1
  }

  const total = buckets.reduce((s, b) => s + b.total, 0)
  const invoiceCount = buckets.reduce((s, b) => s + b.invoiceCount, 0)
  const nonEmpty = buckets.filter((b) => b.total > 0)
  const peakBucket = nonEmpty.length
    ? nonEmpty.reduce((a, b) => (b.total > a.total ? b : a))
    : null
  const avgPerBucket = buckets.length > 0 ? total / buckets.length : 0

  return {
    buckets,
    granularity,
    total,
    invoiceCount,
    avgPerBucket,
    peakBucket,
  }
}

export async function getLastInvoiceSyncAt(): Promise<string | null> {
  const lastSync = await prisma.invoiceSyncLog.findFirst({
    where: { completedAt: { not: null } },
    orderBy: { startedAt: "desc" },
    select: { completedAt: true },
  })
  return lastSync?.completedAt?.toISOString() ?? null
}
