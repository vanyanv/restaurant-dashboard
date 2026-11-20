import { z } from "zod"
import {
  dateRangeSchema,
  parseDateRange,
  resolveStoreIds,
  storeIdsSchema,
} from "./_shared"
import type { ChatTool } from "./types"
import { monthlyFromFrequency, rowSales, type ExpenseFrequency } from "@/lib/pnl"

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
    "Per-store gross / net / order-count summary across a date range, plus each store's share of total gross and a per-platform mini-breakdown. Use this for 'how does Hollywood compare to Glendale?', 'which store is doing best?', 'show me a per-store view', store ranking, best-performing store, and rent-vs-revenue questions.",
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
        fpServiceCharges: true,
        tpServiceCharges: true,
        fpDiscounts: true,
        tpDiscounts: true,
        tpRefundsAdjustments: true,
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
      // The statement's own definition (`rowSales` in `@/lib/pnl`): gross is
      // the platform's own side (fp in-house, tp on a marketplace); net adds
      // service charges, discounts and refunds — so chat matches the P&L.
      const { gross, net } = rowSales({ platform: row.platform, fpTaxCollected: null, tpTaxCollected: null, ...s })
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
  /**
   * The store's other fixed-expense lines (the settings page's list, active
   * lines only), each with its monthly equivalent by `monthlyFromFrequency`,
   * the function the P&L prorates them with.
   */
  otherFixedExpenses: Array<{ label: string; amount: number; frequency: string; monthly: number }>
  /**
   * Monthly fixed costs as the P&L charges them: the four fixed inputs plus
   * every other fixed-expense line. Inputs never entered count as nothing
   * here and are listed in `missingFixedInputs`; null when nothing at all is
   * entered.
   */
  totalFixedMonthly: number | null
  /** Which of rent / salariedLabor / towels / cleaning were never entered. */
  missingFixedInputs: string[]
  /** Delivery commission rates as stored (fractions, 0.25 = 25%). */
  uberCommissionRate: number
  doordashCommissionRate: number
  /** Pickup rates and Grubhub; null means never entered — not free. */
  uberPickupCommissionRate: number | null
  doordashPickupCommissionRate: number | null
  grubhubCommissionRate: number | null
  /** Owner's COGS target percent (e.g. 28.5). Null until set. */
  targetCogsPct: number | null
}

export const getOperationalCosts: ChatTool<typeof operationalParams, OperationalCostRow[]> = {
  name: "getOperationalCosts",
  description:
    "Per-store fixed monthly inputs (labor, rent, towels, cleaning), platform commission rates (Uber, DoorDash), and the COGS target percent. Use this for 'what are our fixed costs?', 'how much is rent at Hollywood?', 'what's our COGS target?', rent-vs-revenue, and food-cost-vs-target context. Reports the monthly figures as stored — does not annualize.",
  parameters: operationalParams,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    // The `Store` columns the settings form edits and the P&L reads, and the
    // active fixed-expense lines the P&L adds as their own rows — one query.
    const stores = await ctx.prisma.store.findMany({
      where: { id: { in: storeIds }, accountId: ctx.accountId },
      select: {
        id: true,
        name: true,
        fixedMonthlyLabor: true,
        fixedMonthlyRent: true,
        fixedMonthlyTowels: true,
        fixedMonthlyCleaning: true,
        uberCommissionRate: true,
        doordashCommissionRate: true,
        uberPickupCommissionRate: true,
        doordashPickupCommissionRate: true,
        grubhubCommissionRate: true,
        targetCogsPct: true,
        fixedExpenses: {
          where: { isActive: true },
          select: { label: true, amount: true, frequency: true },
        },
      },
      orderBy: { name: "asc" },
    })

    return stores.map((s): OperationalCostRow => {
      const fixed: Array<[string, number | null]> = [
        ["salariedLabor", s.fixedMonthlyLabor],
        ["rent", s.fixedMonthlyRent],
        ["towels", s.fixedMonthlyTowels],
        ["cleaning", s.fixedMonthlyCleaning],
      ]
      const otherFixedExpenses = [...s.fixedExpenses]
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((l) => ({
          label: l.label,
          amount: l.amount,
          frequency: String(l.frequency).toLowerCase(),
          monthly:
            Math.round(monthlyFromFrequency(l.amount, l.frequency as ExpenseFrequency) * 100) / 100,
        }))
      const missingFixedInputs = fixed.filter(([, v]) => v == null).map(([k]) => k)
      const anyKnown = missingFixedInputs.length < fixed.length || otherFixedExpenses.length > 0
      const totalFixedMonthly = anyKnown
        ? fixed.reduce<number>((sum, [, v]) => sum + (v ?? 0), 0) +
          s.fixedExpenses.reduce(
            (sum, l) => sum + monthlyFromFrequency(l.amount, l.frequency as ExpenseFrequency),
            0,
          )
        : null
      return {
        storeId: s.id,
        storeName: s.name,
        fixedMonthlyLabor: s.fixedMonthlyLabor,
        fixedMonthlyRent: s.fixedMonthlyRent,
        fixedMonthlyTowels: s.fixedMonthlyTowels,
        fixedMonthlyCleaning: s.fixedMonthlyCleaning,
        otherFixedExpenses,
        totalFixedMonthly,
        missingFixedInputs,
        uberCommissionRate: s.uberCommissionRate,
        doordashCommissionRate: s.doordashCommissionRate,
        uberPickupCommissionRate: s.uberPickupCommissionRate,
        doordashPickupCommissionRate: s.doordashPickupCommissionRate,
        grubhubCommissionRate: s.grubhubCommissionRate,
        targetCogsPct: s.targetCogsPct,
      }
    })
  },
}
