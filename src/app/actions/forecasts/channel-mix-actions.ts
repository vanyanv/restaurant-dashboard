"use server"

// F24 — Channel mix optimizer. Per platform (css-pos, doordash, ubereats,
// grubhub), compute over the lookback window:
//
//   grossSales      — fpGrossSales (FP) or tpGrossSales (3P), summed
//   fees            — fpFees (FP) or tpFees (3P), summed
//   netToOperator   — gross − fees       (what the operator actually sees)
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

const DEFAULT_LOOKBACK_DAYS = 90
const FP_PLATFORM = "css-pos"

export interface ChannelMixRow {
  platform: string
  isFirstParty: boolean
  grossSales: number
  fees: number
  netToOperator: number
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
  totalFees: number
  totalNet: number
  blendedNetRatePct: number | null
  rows: ChannelMixRow[]
  simulation: ChannelMixSimulation | null
}

export type GetChannelMixResult =
  | { ok: true; data: ChannelMixData }
  | { ok: false; error: "store_not_in_account" | "no_data" }

export async function getChannelMix(input: {
  storeId?: string
  lookbackDays?: number
  shiftPct?: number
  asOf?: Date
}): Promise<GetChannelMixResult | null> {
  const session = (await getServerSession(authOptions)) as SessionLike | null
  const user = session?.user ?? null
  if (!user) return null

  const lookbackDays = input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS
  const shiftPct = input.shiftPct ?? 0.1
  const asOf = input.asOf ?? new Date()
  const windowEnd = startOfDayUtc(asOf)
  const windowStart = new Date(windowEnd)
  windowStart.setUTCDate(windowStart.getUTCDate() - lookbackDays)

  let storeId: string | null = null
  let storeName: string | null = null
  if (input.storeId) {
    const store = await prisma.store.findFirst({
      where: { id: input.storeId, accountId: user.accountId },
      select: { id: true, name: true },
    })
    if (!store) return { ok: false, error: "store_not_in_account" }
    storeId = store.id
    storeName = store.name
  }

  const rows = await prisma.otterDailySummary.findMany({
    where: {
      ...(storeId ? { storeId } : { store: { accountId: user.accountId } }),
      date: { gte: windowStart, lte: windowEnd },
    },
    select: {
      platform: true,
      fpGrossSales: true,
      fpFees: true,
      fpOrderCount: true,
      tpGrossSales: true,
      tpFees: true,
      tpOrderCount: true,
    },
  })

  if (rows.length === 0) return { ok: false, error: "no_data" }

  const byPlatform = new Map<
    string,
    {
      platform: string
      isFirstParty: boolean
      gross: number
      fees: number
      orders: number
    }
  >()

  for (const r of rows) {
    const isFirstParty = r.platform === FP_PLATFORM
    const gross = isFirstParty ? r.fpGrossSales ?? 0 : r.tpGrossSales ?? 0
    const fees = isFirstParty ? r.fpFees ?? 0 : r.tpFees ?? 0
    const orders = isFirstParty ? r.fpOrderCount ?? 0 : r.tpOrderCount ?? 0
    if (gross <= 0 && orders <= 0) continue
    const bucket = byPlatform.get(r.platform) ?? {
      platform: r.platform,
      isFirstParty,
      gross: 0,
      fees: 0,
      orders: 0,
    }
    bucket.gross += gross
    bucket.fees += fees
    bucket.orders += orders
    byPlatform.set(r.platform, bucket)
  }

  if (byPlatform.size === 0) return { ok: false, error: "no_data" }

  const totalGross = Array.from(byPlatform.values()).reduce(
    (s, b) => s + b.gross,
    0,
  )
  const totalFees = Array.from(byPlatform.values()).reduce(
    (s, b) => s + b.fees,
    0,
  )
  const totalNet = totalGross - totalFees
  const blendedNetRatePct = totalGross > 0 ? totalNet / totalGross : null

  const channels: ChannelMixRow[] = Array.from(byPlatform.values())
    .map((b) => {
      const netToOperator = b.gross - b.fees
      const takeRatePct = b.gross > 0 ? b.fees / b.gross : null
      const netRatePct = b.gross > 0 ? netToOperator / b.gross : null
      const meanTicket = b.orders > 0 ? b.gross / b.orders : null
      const shareOfGross = totalGross > 0 ? b.gross / totalGross : 0
      return {
        platform: b.platform,
        isFirstParty: b.isFirstParty,
        grossSales: b.gross,
        fees: b.fees,
        netToOperator,
        takeRatePct,
        netRatePct,
        orderCount: b.orders,
        meanTicket,
        shareOfGross,
      }
    })
    .sort((a, b) => b.grossSales - a.grossSales)

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
        const newTotalNet = totalNet + incrementalNet
        simulation = {
          shiftPct,
          fromPlatform: worst.platform,
          toPlatform: best.platform,
          shiftedGross,
          incrementalNet,
          newBlendedNetRatePct: totalGross > 0 ? newTotalNet / totalGross : 0,
          oldBlendedNetRatePct: blendedNetRatePct ?? 0,
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

function startOfDayUtc(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  return out
}
