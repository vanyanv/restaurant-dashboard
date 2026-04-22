import { cache } from "react"
import { prisma } from "@/lib/prisma"
import {
  getInvoiceSummary,
  getInvoiceList,
  getProductAnalytics,
  getLastInvoiceSyncAt,
  getInvoiceSpendTimeline,
} from "@/app/actions/invoice-actions"

export type InvoicePeriodKey = "week" | "month" | "3months" | "year" | "custom"

export interface InvoiceFilters {
  storeId?: string
  status?: string
  vendor?: string
  period: InvoicePeriodKey
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  page?: number
}

export interface ResolvedPeriod {
  period: InvoicePeriodKey
  startDate: string
  endDate: string
  label: string
  granularity: "day" | "week" | "month"
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function parseIsoDate(s: string | undefined): Date | null {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isFinite(d.getTime()) ? d : null
}

function formatRangeLabel(start: Date, end: Date): string {
  const sameYear = start.getFullYear() === end.getFullYear()
  const startFmt = start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  })
  const endFmt = end.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  return `${startFmt} — ${endFmt}`
}

export function resolvePeriod(
  period: InvoicePeriodKey,
  customStart?: string,
  customEnd?: string
): ResolvedPeriod {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const end = new Date(today)
  let start = new Date(today)
  let granularity: "day" | "week" | "month" = "week"

  if (period === "week") {
    start.setDate(start.getDate() - 6)
    granularity = "day"
  } else if (period === "month") {
    start.setDate(start.getDate() - 29)
    granularity = "week"
  } else if (period === "3months") {
    start.setDate(start.getDate() - 89)
    granularity = "week"
  } else if (period === "year") {
    start.setFullYear(start.getFullYear() - 1)
    start.setDate(start.getDate() + 1)
    granularity = "month"
  } else if (period === "custom") {
    const ps = parseIsoDate(customStart)
    const pe = parseIsoDate(customEnd)
    if (ps && pe && ps <= pe) {
      start = ps
      end.setTime(pe.getTime())
    } else {
      start.setDate(start.getDate() - 29)
    }
    const spanDays =
      (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
    granularity = spanDays <= 14 ? "day" : spanDays <= 120 ? "week" : "month"
  }

  return {
    period,
    startDate: toIsoDate(start),
    endDate: toIsoDate(end),
    label: formatRangeLabel(start, end),
    granularity,
  }
}

export function parseInvoiceFilters(sp: {
  storeId?: string
  status?: string
  vendor?: string
  period?: string
  startDate?: string
  endDate?: string
  page?: string
}): InvoiceFilters {
  const page = sp.page ? Number.parseInt(sp.page, 10) : undefined
  const periodRaw = (sp.period ?? "month").toLowerCase()
  const period: InvoicePeriodKey = (
    ["week", "month", "3months", "year", "custom"] as const
  ).includes(periodRaw as InvoicePeriodKey)
    ? (periodRaw as InvoicePeriodKey)
    : "month"

  const resolved = resolvePeriod(period, sp.startDate, sp.endDate)

  return {
    storeId: sp.storeId && sp.storeId !== "all" ? sp.storeId : undefined,
    status: sp.status && sp.status !== "all" ? sp.status : undefined,
    vendor: sp.vendor?.trim() ? sp.vendor.trim() : undefined,
    period,
    startDate: resolved.startDate,
    endDate: resolved.endDate,
    page: Number.isFinite(page) && page! > 0 ? page : undefined,
  }
}

export const fetchSummary = cache(
  (storeId: string | undefined, startDate: string, endDate: string) =>
    getInvoiceSummary({ storeId, startDate, endDate })
)

export const fetchProducts = cache(
  (storeId: string | undefined, startDate: string, endDate: string) =>
    getProductAnalytics({ storeId, startDate, endDate })
)

export const fetchLastSync = cache(() => getLastInvoiceSyncAt())

export const fetchInvoiceList = cache(
  (
    storeId: string | undefined,
    status: string | undefined,
    vendor: string | undefined,
    startDate: string,
    endDate: string,
    page: number | undefined
  ) =>
    getInvoiceList({ storeId, status, vendor, startDate, endDate, page })
)

export const fetchSpendTimeline = cache(
  (
    storeId: string | undefined,
    startDate: string,
    endDate: string,
    granularity: "day" | "week" | "month"
  ) =>
    getInvoiceSpendTimeline({ storeId, startDate, endDate, granularity })
)

export const fetchStoresForUser = cache(async (userId: string) =>
  prisma.store.findMany({
    where: { ownerId: userId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
)
