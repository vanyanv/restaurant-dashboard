"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import type { InvoiceKpis, ProductAnalytics } from "@/types/invoice"

export async function getInvoiceSummary(options?: {
  storeId?: string
  days?: number
}): Promise<InvoiceKpis> {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return {
      totalSpend: 0, invoiceCount: 0, avgInvoiceTotal: 0,
      pendingReviewCount: 0, vendorCount: 0,
      spendByVendor: [], spendByCategory: [],
    }
  }

  const { storeId, days = 30 } = options ?? {}
  const sinceDate = new Date()
  sinceDate.setDate(sinceDate.getDate() - days)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { ownerId: session.user.id }
  if (storeId) where.storeId = storeId
  if (days) where.invoiceDate = { gte: sinceDate }

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
  page?: number
  limit?: number
}) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return { invoices: [], total: 0, page: 1, totalPages: 0 }

  const { storeId, status, page = 1, limit = 25 } = filters ?? {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { ownerId: session.user.id }
  if (storeId) where.storeId = storeId
  if (status) where.status = status

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        store: { select: { name: true } },
        _count: { select: { lineItems: true } },
      },
      orderBy: { createdAt: "desc" },
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
}): Promise<ProductAnalytics> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return { topProducts: [] }

  const { storeId, days = 90 } = options ?? {}
  const sinceDate = new Date()
  sinceDate.setDate(sinceDate.getDate() - days)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoiceWhere: any = { ownerId: session.user.id }
  if (storeId) invoiceWhere.storeId = storeId
  if (days) invoiceWhere.invoiceDate = { gte: sinceDate }

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

export async function getLastInvoiceSyncAt(): Promise<string | null> {
  const lastSync = await prisma.invoiceSyncLog.findFirst({
    where: { completedAt: { not: null } },
    orderBy: { startedAt: "desc" },
    select: { completedAt: true },
  })
  return lastSync?.completedAt?.toISOString() ?? null
}
