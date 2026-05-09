"use server"

// F26 — Catering / bulk-order detection. Order-size outliers vs the
// per-(store, platform) baseline, surfaced as a queue the operator can use
// to triage prep ahead of pickup time.
//
// An order is flagged when ANY of:
//   - subtotal ≥ subtotalMultiplier × store-platform median (default 3×)
//   - subtotal ≥ minSubtotalAbsolute (default $200)
//   - sum(item.quantity) ≥ minItemCount (default 12)
//
// Lead time: we currently store referenceTimeLocal (when the order was
// placed / scheduled) but NOT a separate "pickup_at" timestamp distinct
// from "placed_at" — Otter's customer_orders dataset doesn't expose it
// reliably. So leadHours here is computed as referenceTimeLocal − syncedAt;
// when negative or > 168h it's clamped null (post-fact data, not actionable
// lead time). Documented limitation — a real fulfillment-time field is the
// proper fix.

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

const DEFAULT_LOOKBACK_DAYS = 60
const DEFAULT_SUBTOTAL_MULTIPLIER = 3
const DEFAULT_MIN_SUBTOTAL_ABSOLUTE = 200
const DEFAULT_MIN_ITEM_COUNT = 12

export interface CateringOrder {
  orderId: string
  externalDisplayId: string | null
  storeId: string
  platform: string
  referenceTimeLocal: Date
  customerName: string | null
  subtotal: number
  total: number
  itemCount: number
  itemQuantity: number
  storePlatformMedianSubtotal: number
  subtotalMultiplier: number
  /** Hours between sync and reference time. null when not actionable. */
  leadHours: number | null
  triggers: ("subtotal_multiplier" | "subtotal_absolute" | "item_quantity")[]
}

export interface CateringData {
  storeId: string | null
  storeName: string | null
  windowStart: Date
  windowEnd: Date
  orders: CateringOrder[]
  totalCateringRevenue: number
}

export type GetCateringResult =
  | { ok: true; data: CateringData }
  | { ok: false; error: "store_not_in_account" | "no_data" }

export async function getCateringDetection(input: {
  storeId?: string
  lookbackDays?: number
  subtotalMultiplier?: number
  minSubtotalAbsolute?: number
  minItemCount?: number
  asOf?: Date
}): Promise<GetCateringResult | null> {
  const session = (await getServerSession(authOptions)) as SessionLike | null
  const user = session?.user ?? null
  if (!user) return null

  const lookbackDays = input.lookbackDays ?? DEFAULT_LOOKBACK_DAYS
  const subtotalMultiplier =
    input.subtotalMultiplier ?? DEFAULT_SUBTOTAL_MULTIPLIER
  const minSubtotalAbsolute =
    input.minSubtotalAbsolute ?? DEFAULT_MIN_SUBTOTAL_ABSOLUTE
  const minItemCount = input.minItemCount ?? DEFAULT_MIN_ITEM_COUNT
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

  const orders = await prisma.otterOrder.findMany({
    where: {
      ...(storeId ? { storeId } : { store: { accountId: user.accountId } }),
      referenceTimeLocal: { gte: windowStart, lte: windowEnd },
    },
    select: {
      id: true,
      externalDisplayId: true,
      storeId: true,
      platform: true,
      referenceTimeLocal: true,
      customerName: true,
      subtotal: true,
      total: true,
      syncedAt: true,
      items: {
        select: { id: true, quantity: true },
      },
    },
  })

  if (orders.length === 0) return { ok: false, error: "no_data" }

  // Per (storeId, platform) median subtotal
  const grouper = new Map<string, number[]>()
  const groupKey = (sId: string, p: string) => `${sId}::${p}`
  for (const o of orders) {
    const key = groupKey(o.storeId, o.platform)
    const list = grouper.get(key) ?? []
    list.push(o.subtotal)
    grouper.set(key, list)
  }
  const medianByGroup = new Map<string, number>()
  for (const [k, vals] of grouper) {
    medianByGroup.set(k, median(vals))
  }

  const flagged: CateringOrder[] = []
  for (const o of orders) {
    const itemQuantity = o.items.reduce((s, it) => s + (it.quantity ?? 0), 0)
    const itemCount = o.items.length
    const groupMedian = medianByGroup.get(groupKey(o.storeId, o.platform)) ?? 0
    const multiplier = groupMedian > 0 ? o.subtotal / groupMedian : 0

    const triggers: CateringOrder["triggers"] = []
    if (multiplier >= subtotalMultiplier) triggers.push("subtotal_multiplier")
    if (o.subtotal >= minSubtotalAbsolute) triggers.push("subtotal_absolute")
    if (itemQuantity >= minItemCount) triggers.push("item_quantity")
    if (triggers.length === 0) continue

    const refMs = (o.referenceTimeLocal as Date).getTime()
    const syncMs = (o.syncedAt as Date).getTime()
    const leadHoursRaw = (refMs - syncMs) / 3_600_000
    const leadHours =
      leadHoursRaw > 0 && leadHoursRaw < 24 * 7
        ? Math.round(leadHoursRaw * 10) / 10
        : null

    flagged.push({
      orderId: o.id,
      externalDisplayId: o.externalDisplayId,
      storeId: o.storeId,
      platform: o.platform,
      referenceTimeLocal: o.referenceTimeLocal as Date,
      customerName: o.customerName,
      subtotal: o.subtotal,
      total: o.total,
      itemCount,
      itemQuantity,
      storePlatformMedianSubtotal: groupMedian,
      subtotalMultiplier: multiplier,
      leadHours,
      triggers,
    })
  }

  flagged.sort(
    (a, b) => b.referenceTimeLocal.getTime() - a.referenceTimeLocal.getTime(),
  )

  return {
    ok: true,
    data: {
      storeId,
      storeName,
      windowStart,
      windowEnd,
      orders: flagged,
      totalCateringRevenue: flagged.reduce((s, o) => s + o.subtotal, 0),
    },
  }
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function startOfDayUtc(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  return out
}
