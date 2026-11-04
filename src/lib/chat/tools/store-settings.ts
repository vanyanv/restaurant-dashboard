import { z } from "zod"
import { resolveStoreIds } from "./_shared"
import type { ChatTool } from "./types"
import { loadObservedRates, type ObservedRate } from "@/lib/counter/commission"
import { MONTHLY_FROM, type ExpenseCadence } from "@/lib/counter/expense-cadence"

/**
 * The numbers the owner typed into each store's settings: delivery
 * commission rates by platform, employer payroll tax, the monthly fixed costs
 * (rent, salaried labour, towels, cleaning), extra fixed-expense lines, the
 * lifecycle stage, the COGS target and whether checks are paused.
 *
 * The values are the `Store` columns the settings form edits and the P&L
 * reads, unformatted. The observed rates come from `loadObservedRates`, the
 * function behind the settings page's "your orders: 25.3%" line: what
 * recorded fees actually ran at over 90 days. They are for spotting drift;
 * the P&L charges the typed rate. Monthly equivalents of expense lines use
 * `MONTHLY_FROM`, the table the settings page uses.
 *
 * Not read through the store-file adapter on purpose: that module imports
 * component types whose barrel pulls a PNG, which the scripts typecheck
 * (the eval loads this file) cannot resolve.
 */

const params = z
  .object({
    storeIds: z
      .array(z.string().min(1))
      .optional()
      .describe("Restrict to these store ids from listStores. Omit for every store."),
  })
  .strict()

/** A stored fraction (0.25) as the percent the settings page prints (25). */
const pct = (f: number | null) => (f === null ? null : Math.round(f * 10000) / 100)

const STAGE: Record<string, string> = {
  pre_open: "Pre-open (sales sync skipped)",
  warming_up: "Opening (warming up)",
  ready: "Open",
}

export type StoreSettingsResult = {
  stores: Array<{
    storeId: string
    storeName: string
    stage: string
    commissionPct: {
      doordashDelivery: number | null
      doordashPickup: number | null
      uberDelivery: number | null
      uberPickup: number | null
      grubhub: number | null
    }
    /** What recorded order fees actually ran at over the last 90 days, per platform and mode. */
    observedCommission: Array<{ platform: string; mode: string; ratePct: number | null; orders: number }>
    employerPayrollTaxPct: number | null
    monthlyFixed: { rent: number | null; salariedLabor: number | null; towels: number | null; cleaning: number | null }
    otherFixedExpenses: Array<{ label: string; amount: number; frequency: string; monthly: number }>
    cogsTargetPct: number | null
    checksPausedSince: string | null
  }>
  note: string
}

export const getStoreSettings: ChatTool<typeof params, StoreSettingsResult> = {
  name: "getStoreSettings",
  description:
    "Each store's settings as the owner entered them: commission % per platform (DoorDash / Uber Eats delivery and pickup, Grubhub) with what recorded fees actually ran at over 90 days, employer payroll tax %, monthly rent, salaried labor, towels and cleaning, other fixed-expense lines, lifecycle stage (pre-open / opening / open), COGS target, and whether store checks are paused. Use for 'what commission are we paying DoorDash', 'what's rent at Glendale', 'is Van Nuys set to open'.",
  parameters: params,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const rows = await ctx.prisma.store.findMany({
      where: { id: { in: storeIds }, accountId: ctx.accountId },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, lifecycleStage: true,
        uberCommissionRate: true, doordashCommissionRate: true, uberPickupCommissionRate: true,
        doordashPickupCommissionRate: true, grubhubCommissionRate: true, employerPayrollTaxRate: true,
        fixedMonthlyRent: true, fixedMonthlyLabor: true, fixedMonthlyTowels: true, fixedMonthlyCleaning: true,
        targetCogsPct: true,
        checkPauses: { where: { resumedAt: null }, select: { pausedAt: true }, take: 1 },
        fixedExpenses: { where: { isActive: true }, select: { label: true, amount: true, frequency: true } },
      },
    })
    const now = new Date()
    const out = await Promise.all(
      rows.map(async (r) => {
        const observed: ObservedRate[] = await loadObservedRates({ accountId: ctx.accountId, storeId: r.id, asOf: now })
        return {
          storeId: r.id,
          storeName: r.name,
          stage: STAGE[r.lifecycleStage] ?? String(r.lifecycleStage),
          commissionPct: {
            doordashDelivery: pct(r.doordashCommissionRate),
            doordashPickup: pct(r.doordashPickupCommissionRate),
            uberDelivery: pct(r.uberCommissionRate),
            uberPickup: pct(r.uberPickupCommissionRate),
            grubhub: pct(r.grubhubCommissionRate),
          },
          observedCommission: observed.map((o) => ({
            platform: o.platform,
            mode: o.mode,
            ratePct: o.rate === null ? null : Math.round(o.rate * 1000) / 10,
            orders: o.orders,
          })),
          employerPayrollTaxPct: pct(r.employerPayrollTaxRate),
          monthlyFixed: {
            rent: r.fixedMonthlyRent,
            salariedLabor: r.fixedMonthlyLabor,
            towels: r.fixedMonthlyTowels,
            cleaning: r.fixedMonthlyCleaning,
          },
          otherFixedExpenses: [...r.fixedExpenses]
            .sort((a, b) => a.label.localeCompare(b.label))
            .map((l) => {
              const cadence = (l.frequency in MONTHLY_FROM ? l.frequency : "MONTHLY") as ExpenseCadence
              return {
                label: l.label,
                amount: l.amount,
                frequency: cadence.toLowerCase(),
                monthly: Math.round(l.amount * MONTHLY_FROM[cadence] * 100) / 100,
              }
            }),
          cogsTargetPct: r.targetCogsPct,
          checksPausedSince: r.checkPauses[0]
            ? r.checkPauses[0].pausedAt.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" })
            : null,
        }
      }),
    )
    return {
      stores: out,
      note:
        "A null rate or cost means it was never entered: the P&L flags it, it does not charge $0. " +
        "Website and in-store orders pay no commission.",
    }
  },
}
