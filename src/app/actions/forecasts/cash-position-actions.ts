"use server"

import { startOfDayUTC as startOfDay, ymdUTC as ymd } from "@/lib/date-utils"
// F25 — Cash position forecast. Projects cash inflow vs outflow daily for
// the next 14 days, derived from existing signals only:
//
//   inflow_per_day  = predicted_revenue × (1 − blended_commission_rate)
//   outflow_per_day = Σ Invoice.dueDate matches  +  pro-rated monthly fixed costs
//   cumulative      = Σ (inflow − outflow) up to that day
//
// `blended_commission_rate` is a rate against TOTAL revenue, because that is
// what `predicted_revenue` is. It used to be `(uberRate + doordashRate) / 2` —
// two marketplace rates, averaged without reference to how much each channel
// actually sold, and then charged against every dollar the store took,
// in-house counter sales included. With rates of 21% and 25% that is 23% off
// the top of revenue that mostly pays no commission at all: on a store that
// does half its trade in-house, daily cash inflow came out roughly 11% low,
// compounding across the horizon into the cumulative line and into the cash
// warning `build-briefing` raises off it. The 0.13 fallback below is the
// giveaway — someone picked that as a whole-revenue blend, and the computed
// branch has been returning nearly double it.
//
// The rate is now `Σ (channel sales × that store's rate for that channel) /
// Σ all sales` over the trailing window, per store, from OtterDailySummary.
// Grubhub and the smaller marketplaces have no rate column, so they sit in
// the denominator with nothing in the numerator — the same convention
// `channel-series.ts` applies to its blended commission, and for the same
// reason: Otter publishes no commission row for them.
//
// Notes / honest framing for the dashboard prose:
//   - Without a starting bank balance, this is a DELTA forecast (cumulative
//     change from today, not absolute balance). The dashboard shows the
//     delta and lets the operator add their own starting balance mentally.
//   - We don't model payout-delay precisely (Otter pays 3P weekly; FP card
//     hits in 1-2 days). We collapse all of that into the daily blended-net
//     inflow because cash-position questions over 14 days don't materially
//     hinge on D+1 vs D+7 alignment.
//   - A day with no revenue forecast is NOT a day of no revenue. Its inflow,
//     net and cumulative are null, and every later day's cumulative is null
//     too, because a running total cannot step over an unknown. Two stores
//     have no successfully trained forecast at all; with `?? 0` their whole
//     horizon read as fixed costs and payables against nothing coming in,
//     and the briefing announced a cash crisis that was a training failure.

import { getServerSession } from "next-auth"
import { Prisma } from "@/generated/prisma/client"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getAccountStores } from "@/lib/account-stores"
import { monthlyCostForDays } from "@/lib/pnl"
import {
  COMMISSION_MIX_DAYS,
  FALLBACK_BLENDED_RATE,
  weightedCommissionRate,
  type CommissionRateStore,
} from "@/lib/commission-blend"

interface SessionUser {
  id: string
  accountId: string
}
interface SessionLike {
  user?: SessionUser | null
}

export interface CashPositionDay {
  date: Date
  predictedRevenue: number | null
  /** Null on a day with no revenue forecast — unknown, not zero. */
  estimatedNetInflow: number | null
  scheduledPayables: number
  proRatedFixedCosts: number
  netCashFlow: number | null
  /** Null once any earlier day in the horizon was unforecast. */
  cumulativeNet: number | null
}

export interface CashPositionData {
  storeId: string | null
  storeName: string | null
  horizonDays: number
  blendedCommissionRate: number
  /** Daily fixed-cost allocation, prorated over the average month. */
  proRatedFixedDaily: number
  /** Days in the horizon with no revenue forecast at all. */
  unforecastDays: number
  /** Sum of all invoices with due dates in the horizon, regardless of day. */
  totalScheduledPayables: number
  /** Summed over the forecast days only; `unforecastDays` says how many are missing. */
  totalEstimatedInflow: number
  /** Null when any day in the horizon was unforecast. */
  endingCumulativeNet: number | null
  days: CashPositionDay[]
}

export type GetCashPositionResult =
  | { ok: true; data: CashPositionData }
  | { ok: false; error: "store_not_in_account" }

export async function getCashPositionForecast(input: {
  storeId?: string
  horizonDays?: number
  asOf?: Date
}): Promise<GetCashPositionResult | null> {
  const session = (await getServerSession(authOptions)) as SessionLike | null
  const user = session?.user ?? null
  if (!user) return null

  let storeIds: string[]
  let storeName: string | null = null
  let proRatedFixedDaily = 0
  /** The stores whose commission rates weight the blend. */
  let rateStores: CommissionRateStore[] = []

  if (input.storeId) {
    const store = await prisma.store.findUnique({
      where: { id: input.storeId },
      select: {
        id: true,
        name: true,
        accountId: true,
        uberCommissionRate: true,
        doordashCommissionRate: true,
        fixedMonthlyLabor: true,
        fixedMonthlyRent: true,
        fixedMonthlyTowels: true,
        fixedMonthlyCleaning: true,
      },
    })
    if (!store || store.accountId !== user.accountId) {
      return { ok: false, error: "store_not_in_account" }
    }
    storeIds = [store.id]
    storeName = store.name
    rateStores = [store]
    // `monthlyCostForDays(x, 1)`, not `x / 30`. The rest of the app prorates a
    // monthly fixed cost over the AVERAGE month, 365.25/12 ≈ 30.4375 days, and
    // a second divisor here made the daily rent on this page 1.5% higher than
    // the same rent on the P&L.
    proRatedFixedDaily =
      monthlyCostForDays(
        (store.fixedMonthlyLabor ?? 0) +
          (store.fixedMonthlyRent ?? 0) +
          (store.fixedMonthlyTowels ?? 0) +
          (store.fixedMonthlyCleaning ?? 0),
        1,
      ) ?? 0
  } else {
    // Whole rows from the one store query a request makes — all seven columns
    // this used to select are on them. See `@/lib/account-stores`.
    const stores = await getAccountStores(user.accountId)
    storeIds = stores.map((s) => s.id)
    storeName = "All stores"
    if (stores.length > 0) {
      rateStores = stores
      proRatedFixedDaily =
        monthlyCostForDays(
          stores.reduce(
            (s, st) =>
              s +
              (st.fixedMonthlyLabor ?? 0) +
              (st.fixedMonthlyRent ?? 0) +
              (st.fixedMonthlyTowels ?? 0) +
              (st.fixedMonthlyCleaning ?? 0),
            0,
          ),
          1,
        ) ?? 0
    }
  }

  const horizonDays = input.horizonDays ?? 14
  const asOf = input.asOf ?? new Date()
  const today = startOfDay(asOf)
  const horizonEnd = new Date(today)
  horizonEnd.setUTCDate(horizonEnd.getUTCDate() + horizonDays)

  const mixStart = new Date(today)
  mixStart.setUTCDate(mixStart.getUTCDate() - COMMISSION_MIX_DAYS)

  const [revenueRows, payableInvoiceGroups, mixRows] = await Promise.all([
    prisma.$queryRaw<Array<{ forecastDate: Date; predictedRevenue: number | null }>>(
      Prisma.sql`
        SELECT
          latest."forecastDate",
          SUM(latest."predictedRevenue")::double precision AS "predictedRevenue"
        FROM (
          SELECT DISTINCT ON ("storeId", "forecastDate")
            "storeId",
            "forecastDate",
            "predictedRevenue"
          FROM "ForecastDailyRevenue"
          WHERE "storeId" IN (${Prisma.join(storeIds)})
            AND "hourBucket" = 0
            AND "forecastDate" >= ${today}
            AND "forecastDate" < ${horizonEnd}
          ORDER BY "storeId", "forecastDate", "generatedAt" DESC
        ) latest
        GROUP BY latest."forecastDate"
      `,
    ),
    prisma.invoice.groupBy({
      by: ["dueDate"],
      where: {
        accountId: user.accountId,
        ...(input.storeId ? { storeId: input.storeId } : {}),
        dueDate: { gte: today, lt: horizonEnd },
        isReturn: false,
      },
      _sum: { totalAmount: true },
    }),
    // What each channel actually sold over the trailing window, per store.
    // Both halves summed: a platform row carries its sales in the FP columns
    // or the TP ones depending on who took the order, never in both.
    prisma.$queryRaw<Array<{ storeId: string; platform: string; net: number | null }>>(
      Prisma.sql`
        SELECT
          "storeId",
          "platform",
          SUM(COALESCE("fpNetSales", 0) + COALESCE("tpNetSales", 0))::double precision AS "net"
        FROM "OtterDailySummary"
        WHERE "storeId" IN (${Prisma.join(storeIds)})
          AND "date" >= ${mixStart}
          AND "date" < ${today}
        GROUP BY "storeId", "platform"
      `,
    ),
  ])

  const blendedCommissionRate =
    weightedCommissionRate(
      rateStores,
      mixRows.map((r) => ({
        storeId: r.storeId,
        platform: r.platform,
        net: r.net ?? 0,
      })),
    ) ?? FALLBACK_BLENDED_RATE

  const revenueByDate = new Map<string, number>()
  for (const r of revenueRows) {
    const key = ymd(r.forecastDate as Date)
    revenueByDate.set(
      key,
      (revenueByDate.get(key) ?? 0) + (r.predictedRevenue ?? 0),
    )
  }

  // Bucket invoice payables by due date
  const payablesByDate = new Map<string, number>()
  for (const inv of payableInvoiceGroups) {
    if (!inv.dueDate) continue
    const key = ymd(inv.dueDate as Date)
    payablesByDate.set(
      key,
      (payablesByDate.get(key) ?? 0) + (inv._sum.totalAmount ?? 0),
    )
  }

  const days: CashPositionDay[] = []
  // Null from the first unforecast day onward: a running total cannot step
  // over an unknown and come out the other side meaning anything.
  let cumulative: number | null = 0
  let totalInflow = 0
  let totalPayables = 0
  let unforecastDays = 0

  for (let offset = 0; offset < horizonDays; offset++) {
    const dayDate = new Date(today)
    dayDate.setUTCDate(dayDate.getUTCDate() + offset)
    const key = ymd(dayDate)
    const predictedRevenue = revenueByDate.get(key) ?? null
    const scheduled = payablesByDate.get(key) ?? 0
    const fixed = proRatedFixedDaily
    totalPayables += scheduled

    if (predictedRevenue === null) {
      // No forecast row for this day. NOT a day of no revenue — see the
      // header. `?? 0` here charged the day's fixed costs and payables
      // against nothing coming in.
      unforecastDays += 1
      cumulative = null
      days.push({
        date: dayDate,
        predictedRevenue: null,
        estimatedNetInflow: null,
        scheduledPayables: scheduled,
        proRatedFixedCosts: fixed,
        netCashFlow: null,
        cumulativeNet: null,
      })
      continue
    }

    const netInflow = predictedRevenue * (1 - blendedCommissionRate)
    const net = netInflow - scheduled - fixed
    if (cumulative !== null) cumulative += net
    totalInflow += netInflow
    days.push({
      date: dayDate,
      predictedRevenue,
      estimatedNetInflow: netInflow,
      scheduledPayables: scheduled,
      proRatedFixedCosts: fixed,
      netCashFlow: net,
      cumulativeNet: cumulative,
    })
  }

  return {
    ok: true,
    data: {
      storeId: input.storeId ?? null,
      storeName,
      horizonDays,
      blendedCommissionRate,
      proRatedFixedDaily,
      unforecastDays,
      totalScheduledPayables: totalPayables,
      totalEstimatedInflow: totalInflow,
      endingCumulativeNet: cumulative,
      days,
    },
  }
}

