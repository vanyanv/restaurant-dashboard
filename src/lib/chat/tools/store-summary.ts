import { z } from "zod"
import {
  dateRangeSchema,
  parseDateRange,
  resolveStoreIds,
  storeIdsSchema,
} from "./_shared"
import type { ChatTool } from "./types"

const breakdownParams = z
  .object({
    storeIds: storeIdsSchema,
    dateRange: dateRangeSchema,
  })
  .strict()

export type StoreBreakdownPlatformRow = {
  platform: string
  gross: number
  net: number
  count: number
}

export type StoreBreakdownRow = {
  storeId: string
  storeName: string
  gross: number
  net: number
  count: number
  /** Decimal share of total gross across all returned stores (0..1). */
  share: number
  /** Per-platform mini-breakdown for this store. */
  platforms: StoreBreakdownPlatformRow[]
}

export const getStoreBreakdown: ChatTool<typeof breakdownParams, StoreBreakdownRow[]> = {
  name: "getStoreBreakdown",
  description:
    "Per-store gross / net / order-count summary across a date range, plus each store's share of total gross and a per-platform mini-breakdown. Use this for 'how does Hollywood compare to Glendale?' / 'which store is doing best?' / 'show me a per-store view'.",
  parameters: breakdownParams,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const { from, to } = parseDateRange(args.dateRange)

    const grouped = await ctx.prisma.otterDailySummary.groupBy({
      by: ["storeId", "platform"],
      where: {
        storeId: { in: storeIds },
        date: { gte: from, lte: to },
      },
      _sum: {
        fpGrossSales: true,
        tpGrossSales: true,
        fpNetSales: true,
        tpNetSales: true,
        fpOrderCount: true,
        tpOrderCount: true,
      },
    })

    const stores = await ctx.prisma.store.findMany({
      where: { id: { in: storeIds } },
      select: { id: true, name: true },
    })
    const storeNameById = new Map(stores.map((s) => [s.id, s.name]))

    type Acc = {
      gross: number
      net: number
      count: number
      platforms: Map<string, StoreBreakdownPlatformRow>
    }
    const byStore = new Map<string, Acc>()
    for (const id of storeIds) {
      byStore.set(id, { gross: 0, net: 0, count: 0, platforms: new Map() })
    }

    for (const row of grouped) {
      const acc = byStore.get(row.storeId)
      if (!acc) continue
      const s = row._sum
      const gross = (s.fpGrossSales ?? 0) + (s.tpGrossSales ?? 0)
      const net = (s.fpNetSales ?? 0) + (s.tpNetSales ?? 0)
      const count = (s.fpOrderCount ?? 0) + (s.tpOrderCount ?? 0)
      acc.gross += gross
      acc.net += net
      acc.count += count
      const cur = acc.platforms.get(row.platform) ?? {
        platform: row.platform,
        gross: 0,
        net: 0,
        count: 0,
      }
      cur.gross += gross
      cur.net += net
      cur.count += count
      acc.platforms.set(row.platform, cur)
    }

    const totalGross = Array.from(byStore.values()).reduce(
      (sum, a) => sum + a.gross,
      0,
    )

    return Array.from(byStore.entries())
      .map(([storeId, a]): StoreBreakdownRow => ({
        storeId,
        storeName: storeNameById.get(storeId) ?? storeId,
        gross: a.gross,
        net: a.net,
        count: a.count,
        share: totalGross > 0 ? a.gross / totalGross : 0,
        platforms: Array.from(a.platforms.values()).sort(
          (p, q) => q.gross - p.gross,
        ),
      }))
      .sort((a, b) => b.gross - a.gross)
  },
}

const operationalParams = z
  .object({
    storeIds: storeIdsSchema,
  })
  .strict()

export type OperationalCostRow = {
  storeId: string
  storeName: string
  fixedMonthlyLabor: number | null
  fixedMonthlyRent: number | null
  fixedMonthlyTowels: number | null
  fixedMonthlyCleaning: number | null
  /** Sum of the four monthly fixed inputs (treats nulls as 0). Null when every input is null. */
  totalFixedMonthly: number | null
  uberCommissionRate: number
  doordashCommissionRate: number
  /** Owner's COGS target percent (e.g. 28.5). Null until set. */
  targetCogsPct: number | null
}

export const getOperationalCosts: ChatTool<typeof operationalParams, OperationalCostRow[]> = {
  name: "getOperationalCosts",
  description:
    "Per-store fixed monthly inputs (labor, rent, towels, cleaning), platform commission rates (Uber, DoorDash), and the COGS target percent. Use this for 'what are our fixed costs?', 'how much is rent at Hollywood?', 'what's our COGS target?'. Reports the monthly figures as stored — does not annualize.",
  parameters: operationalParams,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const stores = await ctx.prisma.store.findMany({
      where: { id: { in: storeIds } },
      select: {
        id: true,
        name: true,
        fixedMonthlyLabor: true,
        fixedMonthlyRent: true,
        fixedMonthlyTowels: true,
        fixedMonthlyCleaning: true,
        uberCommissionRate: true,
        doordashCommissionRate: true,
        targetCogsPct: true,
      },
      orderBy: { name: "asc" },
    })

    return stores.map((s): OperationalCostRow => {
      const fixed = [
        s.fixedMonthlyLabor,
        s.fixedMonthlyRent,
        s.fixedMonthlyTowels,
        s.fixedMonthlyCleaning,
      ]
      const anyKnown = fixed.some((v) => v !== null && v !== undefined)
      const totalFixedMonthly = anyKnown
        ? fixed.reduce<number>((sum, v) => sum + (v ?? 0), 0)
        : null
      return {
        storeId: s.id,
        storeName: s.name,
        fixedMonthlyLabor: s.fixedMonthlyLabor,
        fixedMonthlyRent: s.fixedMonthlyRent,
        fixedMonthlyTowels: s.fixedMonthlyTowels,
        fixedMonthlyCleaning: s.fixedMonthlyCleaning,
        totalFixedMonthly,
        uberCommissionRate: s.uberCommissionRate,
        doordashCommissionRate: s.doordashCommissionRate,
        targetCogsPct: s.targetCogsPct,
      }
    })
  },
}
