import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { cached, stableKey } from "@/lib/cache/cached"
import { todayInLA } from "@/lib/dashboard-utils"
import { laDateMinusDays } from "@/lib/hourly-orders"
import {
  bucketHourlyRows,
  derivePeriodSpec,
  type AggregateHourlyRow,
} from "@/lib/hourly-orders"
import {
  buildPeriods,
  bucketSummariesByPeriod,
  computeStorePnL,
  type Granularity,
  type Period,
} from "@/lib/pnl"
import { CogsStatus, InvoiceStatus } from "@/generated/prisma/client"
import type { Prisma } from "@/generated/prisma/client"
import type {
  DailyTrend,
  HourlyComparisonPeriod,
  HourlyOrderPoint,
} from "@/types/analytics"

type MobileStore = { id: string; name: string }

export type MobileHomeSnapshot =
  | {
      stores: MobileStore[]
      validStoreId: string | null
      activeStoreName: string | null
      totalSales: number
      totalOrders: number
      netGrowth: number | null
      previousNet: number
      hourly: HourlyOrderPoint[] | null
      dailyTrends: DailyTrend[]
    }
  | null

export async function getMobileHomeSnapshot(input: {
  storeId: string | null
  periodStart: string
  periodEnd: string
  trendStart: string
  trendEnd: string
  hourlyPeriod: HourlyComparisonPeriod | null
}): Promise<MobileHomeSnapshot> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  const accountId = session.user.accountId
  const ttl = input.periodEnd === todayInLA() ? 60 : 300

  return cached(
    `mobile:home:${accountId}:${stableKey(input)}`,
    ttl,
    ["mobile", "otter", `account:${accountId}`],
    async () => {
      const stores = await prisma.store.findMany({
        where: { accountId, isActive: true },
        select: { id: true, name: true },
        orderBy: { createdAt: "desc" },
      })
      if (stores.length === 0) {
        return {
          stores,
          validStoreId: null,
          activeStoreName: null,
          totalSales: 0,
          totalOrders: 0,
          netGrowth: null,
          previousNet: 0,
          hourly: null,
          dailyTrends: [],
        }
      }

      const validStoreId =
        input.storeId && stores.some((s) => s.id === input.storeId)
          ? input.storeId
          : null
      const activeStoreName = validStoreId
        ? stores.find((s) => s.id === validStoreId)?.name ?? null
        : null
      const storeIds = validStoreId ? [validStoreId] : stores.map((s) => s.id)

      const periodStart = new Date(`${input.periodStart}T00:00:00.000Z`)
      const periodEnd = new Date(`${input.periodEnd}T23:59:59.999Z`)
      const trendStart = new Date(`${input.trendStart}T00:00:00.000Z`)
      const trendEnd = new Date(`${input.trendEnd}T23:59:59.999Z`)
      const dayCount = Math.max(
        1,
        Math.ceil(
          (periodEnd.getTime() - periodStart.getTime()) /
            (24 * 60 * 60 * 1000),
        ),
      )
      const prevEnd = new Date(periodStart)
      prevEnd.setUTCDate(prevEnd.getUTCDate() - 1)
      prevEnd.setUTCHours(23, 59, 59, 999)
      const prevStart = new Date(prevEnd)
      prevStart.setUTCDate(prevStart.getUTCDate() - dayCount)
      prevStart.setUTCHours(0, 0, 0, 0)

      const queryStart = new Date(
        Math.min(trendStart.getTime(), prevStart.getTime(), periodStart.getTime()),
      )
      const queryEnd = new Date(
        Math.max(trendEnd.getTime(), periodEnd.getTime()),
      )

      const [summaries, hourly] = await Promise.all([
        prisma.otterDailySummary.findMany({
          where: {
            storeId: { in: storeIds },
            date: { gte: queryStart, lte: queryEnd },
          },
          select: {
            date: true,
            platform: true,
            paymentMethod: true,
            fpNetSales: true,
            tpNetSales: true,
            fpGrossSales: true,
            tpGrossSales: true,
            fpOrderCount: true,
            tpOrderCount: true,
          },
          orderBy: { date: "asc" },
        }),
        input.hourlyPeriod
          ? getMobileHourly(validStoreId, input.hourlyPeriod)
          : Promise.resolve(null),
      ])

      const isFp = (platform: string) =>
        platform === "css-pos" || platform === "bnm-web"
      const dateKey = (date: Date) => date.toISOString().slice(0, 10)
      const inRange = (date: Date, start: Date, end: Date) =>
        date.getTime() >= start.getTime() && date.getTime() <= end.getTime()

      let totalSales = 0
      let totalOrders = 0
      let previousNet = 0
      const byDate = new Map<
        string,
        {
          grossRevenue: number
          netRevenue: number
          fpGross: number
          tpGross: number
          cashSales: number
          cardSales: number
        }
      >()

      for (const row of summaries) {
        const net = (row.fpNetSales ?? 0) + (row.tpNetSales ?? 0)
        const gross = (row.fpGrossSales ?? 0) + (row.tpGrossSales ?? 0)
        const orders = (row.fpOrderCount ?? 0) + (row.tpOrderCount ?? 0)
        if (inRange(row.date, periodStart, periodEnd)) {
          totalSales += net
          totalOrders += orders
        }
        if (inRange(row.date, prevStart, prevEnd)) previousNet += net
        if (!inRange(row.date, trendStart, trendEnd)) continue

        const key = dateKey(row.date)
        const d =
          byDate.get(key) ??
          {
            grossRevenue: 0,
            netRevenue: 0,
            fpGross: 0,
            tpGross: 0,
            cashSales: 0,
            cardSales: 0,
          }
        d.grossRevenue += gross
        d.netRevenue += net
        if (isFp(row.platform)) {
          d.fpGross += row.fpGrossSales ?? 0
          if (row.paymentMethod === "CASH") d.cashSales += row.fpGrossSales ?? 0
          if (row.paymentMethod === "CARD") d.cardSales += row.fpGrossSales ?? 0
        } else {
          d.tpGross += row.tpGrossSales ?? 0
        }
        byDate.set(key, d)
      }

      return {
        stores,
        validStoreId,
        activeStoreName,
        totalSales,
        totalOrders,
        previousNet,
        netGrowth:
          previousNet > 0 ? ((totalSales - previousNet) / previousNet) * 100 : null,
        hourly,
        dailyTrends: [...byDate.entries()]
          .map(([date, vals]) => ({ date, ...vals }))
          .sort((a, b) => a.date.localeCompare(b.date)),
      }
    },
  )
}

async function getMobileHourly(
  storeId: string | null,
  period: HourlyComparisonPeriod,
): Promise<HourlyOrderPoint[]> {
  const spec = derivePeriodSpec(period)
  const allDates = [...spec.currentDates, ...spec.comparisonGroups.flat()]
  const earliest = allDates.reduce((min, d) => (d < min ? d : min), allDates[0])
  const latest = allDates.reduce((max, d) => (d > max ? d : max), allDates[0])

  const rows = await prisma.otterHourlySummary.findMany({
    where: {
      ...(storeId ? { storeId } : {}),
      date: {
        gte: new Date(`${earliest}T00:00:00.000Z`),
        lte: new Date(`${latest}T00:00:00.000Z`),
      },
    },
    select: {
      date: true,
      hour: true,
      orderCount: true,
      netSales: true,
    },
  })

  const aggregated = new Map<string, AggregateHourlyRow>()
  for (const row of rows) {
    const date = row.date.toISOString().slice(0, 10)
    const key = `${date}|${row.hour}`
    const existing = aggregated.get(key)
    if (existing) {
      existing.orderCount += row.orderCount
      existing.netSales += row.netSales
    } else {
      aggregated.set(key, {
        date,
        hour: row.hour,
        orderCount: row.orderCount,
        netSales: row.netSales,
      })
    }
  }

  return bucketHourlyRows({
    rows: [...aggregated.values()],
    spec,
    period,
  }).hourly
}

export type MobileInvoiceSnapshot = {
  summary: {
    totalSpend: number
    invoiceCount: number
    pendingReviewCount: number
    vendorCount: number
  }
  list: {
    invoices: Array<{
      id: string
      vendorName: string
      invoiceNumber: string | null
      invoiceDate: string | null
      totalAmount: number | null
      status: string | null
      isReturn: boolean
      storeName: string | null
      storeId: string | null
      matchConfidence: number | null
      lineItemCount: number
      createdAt: string
    }>
    total: number
    page: number
    totalPages: number
  }
}

export async function getMobileInvoiceSnapshot(input: {
  status?: string
  page: number
  limit: number
}): Promise<MobileInvoiceSnapshot> {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return {
      summary: {
        totalSpend: 0,
        invoiceCount: 0,
        pendingReviewCount: 0,
        vendorCount: 0,
      },
      list: { invoices: [], total: 0, page: 1, totalPages: 0 },
    }
  }
  const accountId = session.user.accountId

  return cached(
    `mobile:invoices:${accountId}:${stableKey(input)}`,
    300,
    ["mobile", "invoices", `account:${accountId}`],
    async () => {
      const end = new Date()
      end.setHours(23, 59, 59, 999)
      const start = new Date(end)
      start.setHours(0, 0, 0, 0)
      start.setDate(start.getDate() - 29)
      const summaryWhere = {
        accountId,
        invoiceDate: { gte: start, lte: end },
      }
      const listWhere: Prisma.InvoiceWhereInput = { accountId }
      if (input.status && isInvoiceStatus(input.status)) {
        listWhere.status = input.status
      }

      const [vendorGroups, pendingReviewCount, invoices, total] =
        await Promise.all([
          prisma.invoice.groupBy({
            by: ["vendorName"],
            where: summaryWhere,
            _sum: { totalAmount: true },
            _count: { _all: true },
          }),
          prisma.invoice.count({
            where: { ...summaryWhere, status: "REVIEW" },
          }),
          prisma.invoice.findMany({
            where: listWhere,
            select: {
              id: true,
              vendorName: true,
              invoiceNumber: true,
              invoiceDate: true,
              totalAmount: true,
              status: true,
              isReturn: true,
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
            skip: (input.page - 1) * input.limit,
            take: input.limit,
          }),
          prisma.invoice.count({ where: listWhere }),
        ])

      const totalSpend = vendorGroups.reduce(
        (sum, g) => sum + (g._sum.totalAmount ?? 0),
        0,
      )
      const invoiceCount = vendorGroups.reduce(
        (sum, g) => sum + g._count._all,
        0,
      )

      return {
        summary: {
          totalSpend,
          invoiceCount,
          pendingReviewCount,
          vendorCount: vendorGroups.length,
        },
        list: {
          invoices: invoices.map((inv) => ({
            id: inv.id,
            vendorName: inv.vendorName,
            invoiceNumber: inv.invoiceNumber,
            invoiceDate: inv.invoiceDate?.toISOString().slice(0, 10) ?? null,
            totalAmount: inv.totalAmount,
            status: inv.status,
            isReturn: inv.isReturn,
            storeName: inv.store?.name ?? null,
            storeId: inv.storeId,
            matchConfidence: inv.matchConfidence,
            lineItemCount: inv._count.lineItems,
            createdAt: inv.createdAt.toISOString(),
          })),
          total,
          page: input.page,
          totalPages: Math.ceil(total / input.limit),
        },
      }
    },
  )
}

function isInvoiceStatus(status: string): status is InvoiceStatus {
  return Object.values(InvoiceStatus).includes(status as InvoiceStatus)
}

export type MobilePnLOverview =
  | {
      storeCount: number
      combined: {
        grossSales: number
        cogsValue: number
        cogsPct: number
        bottomLine: number
        marginPct: number
      }
      perStore: Array<{
        storeId: string
        storeName: string
        grossSales: number
        cogsPct: number
        marginPct: number
        bottomLine: number
      }>
    }
  | { error: string }

export async function getMobilePnLOverview(input: {
  startDate: Date
  endDate: Date
  granularity: Granularity
}): Promise<MobilePnLOverview> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return { error: "Unauthorized" }
  if (!hasOwnerAccess(session.user.role)) {
    return { error: "P&L is restricted to owners" }
  }
  const accountId = session.user.accountId

  return cached(
    `mobile:pnl:${accountId}:${stableKey({
      s: input.startDate.toISOString(),
      e: input.endDate.toISOString(),
      g: input.granularity,
    })}`,
    600,
    ["mobile", "pnl", `account:${accountId}`],
    async () => {
      try {
        const stores = await prisma.store.findMany({
          where: { accountId, isActive: true },
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
        const periods = buildPeriods(
          input.startDate,
          input.endDate,
          input.granularity,
        )
        if (stores.length === 0 || periods.length === 0) {
          return {
            storeCount: 0,
            combined: {
              grossSales: 0,
              cogsValue: 0,
              cogsPct: 0,
              bottomLine: 0,
              marginPct: 0,
            },
            perStore: [],
          }
        }

        const storeIds = stores.map((s) => s.id)
        const overallStart = periods[0].startDate
        const overallEnd = periods[periods.length - 1].endDate

        const [summaries, cogsRows] = await Promise.all([
          prisma.otterDailySummary.findMany({
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
          }),
          prisma.dailyCogsItem.findMany({
            where: {
              storeId: { in: storeIds },
              date: { gte: overallStart, lte: overallEnd },
            },
            select: {
              storeId: true,
              date: true,
              lineCost: true,
              status: true,
            },
          }),
        ])

        const byStore = new Map<string, typeof summaries>()
        for (const row of summaries) {
          const bucket = byStore.get(row.storeId) ?? []
          bucket.push(row)
          byStore.set(row.storeId, bucket)
        }
        const cogsByStore = new Map<
          string,
          Array<{ date: Date; lineCost: number; status: CogsStatus }>
        >()
        for (const row of cogsRows) {
          const bucket = cogsByStore.get(row.storeId) ?? []
          bucket.push(row)
          cogsByStore.set(row.storeId, bucket)
        }

        const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
        const perStore = stores.map((store) => {
          const bucketed = bucketSummariesByPeriod(
            byStore.get(store.id) ?? [],
            periods,
          )
          const cogsValues = summarizeMobileCogs(
            cogsByStore.get(store.id) ?? [],
            periods,
          )
          const computed = computeStorePnL({
            bucketed,
            periods,
            store,
            cogsValues,
          })
          const grossSales = sum(computed.totalSales)
          const cogsValue = sum(computed.cogsValues)
          const bottomLine = sum(computed.bottomLine)
          return {
            storeId: store.id,
            storeName: store.name,
            grossSales,
            cogsValue,
            cogsPct: grossSales === 0 ? 0 : cogsValue / grossSales,
            bottomLine,
            marginPct: grossSales === 0 ? 0 : bottomLine / grossSales,
          }
        })

        const grossSales = sum(perStore.map((s) => s.grossSales))
        const cogsValue = sum(perStore.map((s) => s.cogsValue))
        const bottomLine = sum(perStore.map((s) => s.bottomLine))
        return {
          storeCount: stores.length,
          combined: {
            grossSales,
            cogsValue,
            cogsPct: grossSales === 0 ? 0 : cogsValue / grossSales,
            bottomLine,
            marginPct: grossSales === 0 ? 0 : bottomLine / grossSales,
          },
          perStore,
        }
      } catch (error) {
        console.error("getMobilePnLOverview error:", error)
        const msg = error instanceof Error ? error.message : String(error)
        return { error: `Failed to load P&L: ${msg.slice(0, 300)}` }
      }
    },
  )
}

function summarizeMobileCogs(
  rows: Array<{ date: Date; lineCost: number; status: CogsStatus }>,
  periods: Period[],
): number[] {
  const values = periods.map(() => 0)
  for (const row of rows) {
    if (
      row.status === CogsStatus.UNMAPPED ||
      row.status === CogsStatus.MISSING_COST
    ) {
      continue
    }
    const t = row.date.getTime()
    const idx = periods.findIndex(
      (p) => t >= p.startDate.getTime() && t <= p.endDate.getTime(),
    )
    if (idx !== -1) values[idx] += row.lineCost
  }
  return values
}

export function trailingRevenueStart(periodEnd: string): string {
  return laDateMinusDays(periodEnd, 13)
}
