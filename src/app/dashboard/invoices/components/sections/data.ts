import { cache } from "react"
import { prisma } from "@/lib/prisma"
import {
  getInvoiceSummary,
  getInvoiceList,
  getProductAnalytics,
  getPriceMovers,
  getLastInvoiceSyncAt,
} from "@/app/actions/invoice-actions"

export const fetchSummary = cache((storeId?: string) =>
  getInvoiceSummary({ storeId })
)

export const fetchProducts = cache((storeId?: string) =>
  getProductAnalytics({ storeId })
)

export const fetchPriceMovers = cache(() => getPriceMovers())

export const fetchLastSync = cache(() => getLastInvoiceSyncAt())

export const fetchInvoiceList = cache(
  (storeId?: string, status?: string, page?: number) =>
    getInvoiceList({ storeId, status, page })
)

export const fetchStoresForUser = cache(async (userId: string) =>
  prisma.store.findMany({
    where: { ownerId: userId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
)

export interface InvoiceFilters {
  storeId?: string
  status?: string
  page?: number
}

export function parseInvoiceFilters(sp: {
  storeId?: string
  status?: string
  page?: string
}): InvoiceFilters {
  const page = sp.page ? Number.parseInt(sp.page, 10) : undefined
  return {
    storeId: sp.storeId && sp.storeId !== "all" ? sp.storeId : undefined,
    status: sp.status && sp.status !== "all" ? sp.status : undefined,
    page: Number.isFinite(page) && page! > 0 ? page : undefined,
  }
}
