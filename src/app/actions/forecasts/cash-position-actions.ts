"use server"

// F25 — Cash position forecast. Projects cash inflow vs outflow daily for
// the next 14 days, derived from existing signals only:
//
//   inflow_per_day  = predicted_revenue × (1 − blended_commission_rate)
//   outflow_per_day = Σ Invoice.dueDate matches  +  pro-rated monthly fixed costs
//   cumulative      = Σ (inflow − outflow) up to that day
//
// Notes / honest framing for the dashboard prose:
//   - Without a starting bank balance, this is a DELTA forecast (cumulative
//     change from today, not absolute balance). The dashboard shows the
//     delta and lets the operator add their own starting balance mentally.
//   - We don't model payout-delay precisely (Otter pays 3P weekly; FP card
//     hits in 1-2 days). We collapse all of that into the daily blended-net
//     inflow because cash-position questions over 14 days don't materially
//     hinge on D+1 vs D+7 alignment.

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

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
  estimatedNetInflow: number
  scheduledPayables: number
  proRatedFixedCosts: number
  netCashFlow: number
  cumulativeNet: number
}

export interface CashPositionData {
  storeId: string | null
  storeName: string | null
  horizonDays: number
  blendedCommissionRate: number
  /** Daily fixed-cost allocation = monthly total / 30. */
  proRatedFixedDaily: number
  /** Sum of all invoices with due dates in the horizon, regardless of day. */
  totalScheduledPayables: number
  totalEstimatedInflow: number
  endingCumulativeNet: number
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
  let blendedCommissionRate = 0.13 // default if no per-store rates set
  let proRatedFixedDaily = 0

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
    blendedCommissionRate =
      ((store.uberCommissionRate ?? 0.21) + (store.doordashCommissionRate ?? 0.25)) / 2
    proRatedFixedDaily =
      ((store.fixedMonthlyLabor ?? 0) +
        (store.fixedMonthlyRent ?? 0) +
        (store.fixedMonthlyTowels ?? 0) +
        (store.fixedMonthlyCleaning ?? 0)) /
      30
  } else {
    const stores = await prisma.store.findMany({
      where: { accountId: user.accountId, isActive: true },
      select: {
        id: true,
        uberCommissionRate: true,
        doordashCommissionRate: true,
        fixedMonthlyLabor: true,
        fixedMonthlyRent: true,
        fixedMonthlyTowels: true,
        fixedMonthlyCleaning: true,
      },
    })
    storeIds = stores.map((s) => s.id)
    if (stores.length > 0) {
      const avg = (xs: (number | null | undefined)[]) =>
        xs.reduce<number>((s, x) => s + (x ?? 0), 0) / xs.length
      blendedCommissionRate =
        (avg(stores.map((s) => s.uberCommissionRate ?? 0.21)) +
          avg(stores.map((s) => s.doordashCommissionRate ?? 0.25))) /
        2
      proRatedFixedDaily =
        stores.reduce(
          (s, st) =>
            s +
            (st.fixedMonthlyLabor ?? 0) +
            (st.fixedMonthlyRent ?? 0) +
            (st.fixedMonthlyTowels ?? 0) +
            (st.fixedMonthlyCleaning ?? 0),
          0,
        ) / 30
    }
  }

  const horizonDays = input.horizonDays ?? 14
  const asOf = input.asOf ?? new Date()
  const today = startOfDay(asOf)
  const horizonEnd = new Date(today)
  horizonEnd.setUTCDate(horizonEnd.getUTCDate() + horizonDays)

  const [revenueRows, payableInvoices] = await Promise.all([
    prisma.forecastDailyRevenue.findMany({
      where: {
        storeId: { in: storeIds },
        hourBucket: 0,
        forecastDate: { gte: today, lt: horizonEnd },
      },
      orderBy: [{ forecastDate: "asc" }, { generatedAt: "desc" }],
      select: { forecastDate: true, predictedRevenue: true, generatedAt: true },
    }),
    prisma.invoice.findMany({
      where: {
        accountId: user.accountId,
        ...(input.storeId ? { storeId: input.storeId } : {}),
        dueDate: { gte: today, lt: horizonEnd },
        isReturn: false,
      },
      select: { dueDate: true, totalAmount: true },
    }),
  ])

  // Latest-generation per (date) for revenue
  type RevRow = (typeof revenueRows)[number]
  const latestRevenue = new Map<string, RevRow>()
  for (const r of revenueRows) {
    // When multi-store rolled, sum predicted revenues across stores per date.
    // To keep this generic, sum all predictedRevenue across rows for the same
    // date (latest gen each).
    const key = ymd(r.forecastDate as Date)
    const existing = latestRevenue.get(key)
    if (!existing || r.generatedAt > existing.generatedAt) latestRevenue.set(key, r)
  }
  // Build a per-day revenue map. For multi-store, sum across stores' latest
  // generations on the same date.
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
  for (const inv of payableInvoices) {
    if (!inv.dueDate) continue
    const key = ymd(inv.dueDate as Date)
    payablesByDate.set(key, (payablesByDate.get(key) ?? 0) + inv.totalAmount)
  }

  const days: CashPositionDay[] = []
  let cumulative = 0
  let totalInflow = 0
  let totalPayables = 0

  for (let offset = 0; offset < horizonDays; offset++) {
    const dayDate = new Date(today)
    dayDate.setUTCDate(dayDate.getUTCDate() + offset)
    const key = ymd(dayDate)
    const predictedRevenue = revenueByDate.get(key) ?? null
    const grossInflow = predictedRevenue ?? 0
    const netInflow = grossInflow * (1 - blendedCommissionRate)
    const scheduled = payablesByDate.get(key) ?? 0
    const fixed = proRatedFixedDaily
    const net = netInflow - scheduled - fixed
    cumulative += net
    totalInflow += netInflow
    totalPayables += scheduled
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
      totalScheduledPayables: totalPayables,
      totalEstimatedInflow: totalInflow,
      endingCumulativeNet: cumulative,
      days,
    },
  }
}

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  return out
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}
