// Server-only, not a server action: nothing in the browser calls these, so
// they are plain functions and cannot be invoked from outside the server.
// Browser saves go through `src/lib/counter/actions/`.
import "server-only"
import { startOfDayUTC as startOfDayUtc } from "@/lib/date-utils"
// F24 — Channel mix optimizer. Per platform (css-pos, doordash, ubereats,
// grubhub), compute over the lookback window:
//
//   grossSales      — the statement's gross for the platform (`rowSales` in
//                     `@/lib/pnl`: fp on an in-house platform, tp elsewhere)
//   fees            — the marketplace's cut from `@/lib/counter/commission`,
//                     the same function the P&L's commission lines use
//                     (recorded fees, else the store's rate). 0 in-house;
//                     null when not one order could be priced — never a
//                     quiet $0. Otter's fpFees/tpFees are not used: the P&L
//                     does not use them either, so the two would disagree.
//   netToOperator   — gross − fees       (null when fees are unknown)
//   takeRatePct     — fees / gross       (effective platform take)
//   netRatePct      — netToOperator / gross
//   orderCount      — fpOrderCount or tpOrderCount, summed
//   meanTicket      — gross / orderCount (sanity check)
//
// Simulation: caller specifies a `shiftPct` and we compute what would
// happen if shiftPct of the worst-net-rate channel's gross migrated to
// the best-net-rate channel — purely as a directional read on
// "incremental dollars sit on the table at the current mix". No promise
// that the operator can actually shift orders; the operator interprets.

import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { getAccountStoreRows } from "@/lib/account-stores"
import { isFirstPartyPlatform } from "@/lib/first-party-platforms"
import { rowSales, summarySlices } from "@/lib/pnl"
import {
  commissionBasis,
  loadOrderFeeGroups,
  totalCommission,
  type StoreCommissionRates,
} from "@/lib/counter/commission"
import { getCachedSession, resolveStoreContext } from "./_shared"

const DEFAULT_LOOKBACK_DAYS = 90

export interface ChannelMixRow {
  platform: string
  isFirstParty: boolean
  grossSales: number
  /** Null when not one order on the platform could be priced (no recorded fee, no rate on file). */
  fees: number | null
  /** How `fees` was arrived at ("as recorded by the marketplaces", "estimated for 38% of orders", ...). Null in-house. */
  feesBasis: string | null
  netToOperator: number | null
  takeRatePct: number | null
  netRatePct: number | null
  orderCount: number
  meanTicket: number | null
  shareOfGross: number
}

export interface ChannelMixSimulation {
  shiftPct: number
  fromPlatform: string
  toPlatform: string
  shiftedGross: number
  /** Incremental dollars to the operator if the shift were costless. */
  incrementalNet: number
  newBlendedNetRatePct: number
  oldBlendedNetRatePct: number
}

export interface ChannelMixData {
  storeId: string | null
  storeName: string | null
  windowStart: Date
  windowEnd: Date
  totalGross: number
  /** Null when any marketplace platform's fees are unknown. */
  totalFees: number | null
  totalNet: number | null
  blendedNetRatePct: number | null
  rows: ChannelMixRow[]
  simulation: ChannelMixSimulation | null
}

export type GetChannelMixResult =
  | { ok: true; data: ChannelMixData }
  | { ok: false; error: "store_not_in_account" | "no_data" }

interface SummaryRow {
  storeId: string
  day: string
  platform: string
  fpGrossSales: number | null
  tpGrossSales: number | null
  fpOrderCount: number | null
  tpOrderCount: number | null
  fpDiscounts: number | null
  tpDiscounts: number | null
  fpServiceCharges: number | null
  tpServiceCharges: number | null
  fpTaxCollected: number | null
  tpTaxCollected: number | null
  tpRefundsAdjustments: number | null
}

export async function getChannelMix(input: {
  storeId?: string
  lookbackDays?: number
  shiftPct?: number
  asOf?: Date
}): Promise<GetChannelMixResult | null> {
  const session = await getCachedSession()
  const user = session?.user ?? null
  if (!user) return null
  const accountId = user.accountId

  const lookbackDays = input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS
  const shiftPct = input.shiftPct ?? 0.1
  const asOf = input.asOf ?? new Date()
  const windowEnd = startOfDayUtc(asOf)
  const windowStart = new Date(windowEnd)
  windowStart.setUTCDate(windowStart.getUTCDate() - lookbackDays)

  const resolved = await resolveStoreContext(input.storeId, accountId)
  if (!resolved.ok) return resolved
  const { storeIds, storeName, storeIdOut: storeId } = resolved.ctx

  if (storeIds.length === 0) return { ok: false, error: "no_data" }

  // Summary rows per store/day/platform (the commission check is per day),
  // the order fee groups, and the stores' rates — all independent.
  const [rows, groups, storeRows] = await Promise.all([
    prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
      SELECT
        d."storeId",
        to_char(d."date", 'YYYY-MM-DD') AS "day",
        d."platform",
        SUM(COALESCE(d."fpGrossSales", 0))::double precision         AS "fpGrossSales",
        SUM(COALESCE(d."tpGrossSales", 0))::double precision         AS "tpGrossSales",
        SUM(COALESCE(d."fpOrderCount", 0))::integer                  AS "fpOrderCount",
        SUM(COALESCE(d."tpOrderCount", 0))::integer                  AS "tpOrderCount",
        SUM(COALESCE(d."fpDiscounts", 0))::double precision          AS "fpDiscounts",
        SUM(COALESCE(d."tpDiscounts", 0))::double precision          AS "tpDiscounts",
        SUM(COALESCE(d."fpServiceCharges", 0))::double precision     AS "fpServiceCharges",
        SUM(COALESCE(d."tpServiceCharges", 0))::double precision     AS "tpServiceCharges",
        SUM(COALESCE(d."fpTaxCollected", 0))::double precision       AS "fpTaxCollected",
        SUM(COALESCE(d."tpTaxCollected", 0))::double precision       AS "tpTaxCollected",
        SUM(COALESCE(d."tpRefundsAdjustments", 0))::double precision AS "tpRefundsAdjustments"
      FROM "OtterDailySummary" d
      JOIN "Store" s ON s."id" = d."storeId"
      WHERE s."accountId" = ${accountId}
        AND d."storeId" IN (${Prisma.join(storeIds)})
        AND d."date" >= ${windowStart}
        AND d."date" <= ${windowEnd}
      GROUP BY d."storeId", d."date", d."platform"
    `),
    loadOrderFeeGroups({ accountId, storeIds, startDate: windowStart, endDate: windowEnd }),
    getAccountStoreRows(accountId),
  ])

  if (rows.length === 0) return { ok: false, error: "no_data" }

  const rates = new Map<string, StoreCommissionRates>(
    storeRows.filter((s) => storeIds.includes(s.id)).map((s) => [s.id, s]),
  )

  const byPlatform = new Map<
    string,
    {
      platform: string
      isFirstParty: boolean
      gross: number
      orders: number
    }
  >()

  for (const r of rows) {
    const isFirstParty = isFirstPartyPlatform(r.platform)
    const gross = rowSales(r).gross
    const orders = (isFirstParty ? r.fpOrderCount : r.tpOrderCount) ?? 0
    if (gross <= 0 && orders <= 0) continue
    const bucket = byPlatform.get(r.platform) ?? {
      platform: r.platform,
      isFirstParty,
      gross: 0,
      orders: 0,
    }
    bucket.gross += gross
    bucket.orders += orders
    byPlatform.set(r.platform, bucket)
  }

  if (byPlatform.size === 0) return { ok: false, error: "no_data" }

  // Commission per marketplace platform by the P&L's one rule, each day's
  // order rows checked against the summary so a day the order sync missed is
  // priced off its sales rather than counted as $0.
  const slices = summarySlices(rows.map((r) => ({ ...r, date: r.day })))
  const feesOf = (b: {
    platform: string
    isFirstParty: boolean
    gross: number
  }): { fees: number | null; basis: string | null } => {
    if (b.isFirstParty) return { fees: 0, basis: null }
    const t = totalCommission(groups, rates, (g) => g.platform === b.platform, slices)
    // Sales on file and not one order to price them from is a sync gap, not
    // a free marketplace.
    const fees = t.orders === 0 && b.gross > 0 ? null : t.amount
    return { fees, basis: t.orders === 0 ? null : commissionBasis(t) }
  }

  const totalGross = Array.from(byPlatform.values()).reduce(
    (s, b) => s + b.gross,
    0,
  )

  const channels: ChannelMixRow[] = Array.from(byPlatform.values())
    .map((b) => {
      const { fees, basis } = feesOf(b)
      const netToOperator = fees === null ? null : b.gross - fees
      const takeRatePct = fees !== null && b.gross > 0 ? fees / b.gross : null
      const netRatePct =
        netToOperator !== null && b.gross > 0 ? netToOperator / b.gross : null
      const meanTicket = b.orders > 0 ? b.gross / b.orders : null
      const shareOfGross = totalGross > 0 ? b.gross / totalGross : 0
      return {
        platform: b.platform,
        isFirstParty: b.isFirstParty,
        grossSales: b.gross,
        fees,
        feesBasis: basis,
        netToOperator,
        takeRatePct,
        netRatePct,
        orderCount: b.orders,
        meanTicket,
        shareOfGross,
      }
    })
    .sort((a, b) => b.grossSales - a.grossSales)

  // A total with an unpriced platform in it is not a total.
  const anyUnknown = channels.some((c) => c.fees === null)
  const totalFees = anyUnknown
    ? null
    : channels.reduce((s, c) => s + (c.fees ?? 0), 0)
  const totalNet = totalFees === null ? null : totalGross - totalFees
  const blendedNetRatePct =
    totalNet !== null && totalGross > 0 ? totalNet / totalGross : null

  // Simulation: only meaningful with at least 2 platforms and a positive
  // shiftPct. Pick the platform with the LOWEST netRatePct as donor and
  // the HIGHEST netRatePct as recipient.
  let simulation: ChannelMixSimulation | null = null
  if (channels.length >= 2 && shiftPct > 0 && shiftPct <= 0.5) {
    const ratesAvailable = channels.filter((c) => c.netRatePct != null)
    if (ratesAvailable.length >= 2) {
      const best = ratesAvailable.reduce((acc, c) =>
        (c.netRatePct ?? 0) > (acc.netRatePct ?? 0) ? c : acc,
      )
      const worst = ratesAvailable.reduce((acc, c) =>
        (c.netRatePct ?? 1) < (acc.netRatePct ?? 1) ? c : acc,
      )
      if (best.platform !== worst.platform) {
        const shiftedGross = worst.grossSales * shiftPct
        const incrementalNet =
          shiftedGross *
          ((best.netRatePct ?? 0) - (worst.netRatePct ?? 0))
        const newTotalNet = totalNet === null ? null : totalNet + incrementalNet
        if (newTotalNet !== null && blendedNetRatePct !== null) simulation = {
          shiftPct,
          fromPlatform: worst.platform,
          toPlatform: best.platform,
          shiftedGross,
          incrementalNet,
          newBlendedNetRatePct: totalGross > 0 ? newTotalNet / totalGross : 0,
          oldBlendedNetRatePct: blendedNetRatePct,
        }
      }
    }
  }

  return {
    ok: true,
    data: {
      storeId,
      storeName,
      windowStart,
      windowEnd,
      totalGross,
      totalFees,
      totalNet,
      blendedNetRatePct,
      rows: channels,
      simulation,
    },
  }
}

