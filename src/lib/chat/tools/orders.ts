// Phase 1 — Coverage gap: order-level drilldown.
//
// Daily/hourly summaries are already exposed via sales.ts; these tools let
// the chat answer order-grain questions ("show me the biggest order last
// Friday", "what was on order #1234?") without dumping the full Otter API.

import { z } from "zod"
import { feeAmount, netOf, ticketOf } from "@/lib/counter/order-signs"
import {
  dateRangeSchema,
  parseDateRange,
  resolveStoreIds,
  storeIdsSchema,
} from "./_shared"
import type { ChatTool } from "./types"

// ---------------------------------------------------------------------------
// getOrderById
// ---------------------------------------------------------------------------

const orderByIdParams = z
  .object({
    orderId: z
      .string()
      .min(1)
      .describe(
        "Either the externalDisplayId (the customer-facing order number, e.g. '1234') or the internal otterOrderId. Internal ids are exact match; externalDisplayId is matched within the owner's stores.",
      ),
  })
  .strict()

export type OrderItemChatRow = {
  name: string
  quantity: number
  price: number
  modifiers: { name: string; quantity: number; price: number; group: string | null }[]
}

/*
 * ## Why this result carries no raw money column
 *
 * `OtterOrder.discount` and `OtterOrder.commission` are stored as SIGNED
 * DEDUCTIONS — negative numbers ADDED to reach a net (0 of 40,055 discount
 * rows positive, 0 of 25,648 commission rows positive; see
 * `src/lib/counter/order-signs.ts`). This tool returned both at their raw
 * stored sign, and NOTHING in the model's reachable context said so:
 * `describe-schema.ts` does not mention `OtterOrder`, and the system prompt's
 * only sign paragraph is scoped to `getPnlSummary`'s row matrix.
 *
 * On the real row `3926DEFE` (subtotal 74.94, discount −37.47, commission
 * −9.37) the model's natural derivations gave a $112.41 ticket and $121.78
 * kept, where the order page says $37.47 and $28.10, and described the fee as
 * "a commission of −$9.37", which reads as a credit. The chat was a fifth
 * surface answering the question the Orders pages answer, and the only one
 * answering it wrong.
 *
 * So the columns do not leave the tool. Every figure below is the one the
 * pages print, through `ticketOf` / `feeAmount` / `netOf`, and every deduction
 * is a POSITIVE amount named as a deduction. A sign contract the model has to
 * apply correctly is weaker than a number that is already right.
 */
export type OrderDetailChatResult = {
  found: boolean
  storeId?: string
  platform?: string
  externalDisplayId?: string | null
  referenceTimeLocal?: string
  fulfillmentMode?: string | null
  orderStatus?: string | null
  customerName?: string | null
  /** Menu price of the lines, BEFORE any discount. Not what the customer paid. */
  subtotal?: number
  /** The discount given, as a positive amount. Already taken off `ticket`. */
  discountGiven?: number
  /** What the customer was charged: `subtotal − discountGiven`. THE ticket. */
  ticket?: number
  /** What the marketplace took, as a positive amount. 0 on an in-house order. */
  marketplaceFee?: number
  /** `marketplaceFee / ticket`, 0..1. The rate this order was actually billed at. */
  marketplaceFeeRate?: number
  /** `ticket − marketplaceFee` — what the order left behind before food cost. */
  netToRestaurant?: number
  /** Collected and remitted by the platform. Never the restaurant's money. */
  tax?: number
  tip?: number
  /** The platform's own grand total column: net + tax + tip. */
  total?: number
  items?: OrderItemChatRow[]
}

export const getOrderById: ChatTool<typeof orderByIdParams, OrderDetailChatResult> = {
  name: "getOrderById",
  description:
    "Returns full detail for one order: line items, modifiers, totals, fees. Accepts the public order number (externalDisplayId, like '1234') or the internal otterOrderId. Owner-scoped — orders from another account return found=false. Use for 'what was on order 1234?', 'why was order X so expensive?', 'show me the items in last night's biggest ticket'. Money is pre-derived and every deduction is a POSITIVE amount: ticket = what the customer was charged (subtotal less discountGiven), marketplaceFee = what the platform took, netToRestaurant = ticket - marketplaceFee. Use those directly; do NOT re-derive a ticket or a net from subtotal, and do not add or subtract tax or tip to reach them.",
  parameters: orderByIdParams,
  async execute(args, ctx) {
    const ownerStoreIds = await resolveStoreIds(ctx, undefined)
    const order = await ctx.prisma.otterOrder.findFirst({
      where: {
        OR: [
          { otterOrderId: args.orderId },
          { externalDisplayId: args.orderId },
        ],
        storeId: { in: ownerStoreIds },
      },
      include: {
        items: { include: { subItems: true } },
      },
    })
    if (!order) return { found: false }
    return {
      found: true,
      storeId: order.storeId,
      platform: order.platform,
      externalDisplayId: order.externalDisplayId,
      referenceTimeLocal: order.referenceTimeLocal.toISOString(),
      fulfillmentMode: order.fulfillmentMode,
      orderStatus: order.orderStatus,
      customerName: order.customerName,
      subtotal: order.subtotal,
      // Positive, and named as what it is. The column is negative.
      discountGiven: -order.discount,
      ticket: ticketOf(order),
      marketplaceFee: feeAmount(order),
      marketplaceFeeRate:
        ticketOf(order) > 0 ? feeAmount(order) / ticketOf(order) : 0,
      netToRestaurant: netOf(order),
      tax: order.tax,
      tip: order.tip,
      total: order.total,
      items: order.items.map((it) => ({
        name: it.name,
        quantity: it.quantity,
        price: it.price,
        modifiers: it.subItems.map((s) => ({
          name: s.name,
          quantity: s.quantity,
          price: s.price,
          group: s.subHeader,
        })),
      })),
    }
  },
}

// ---------------------------------------------------------------------------
// listOrdersByDay
// ---------------------------------------------------------------------------

const ordersByDayParams = z
  .object({
    storeIds: storeIdsSchema,
    dateRange: dateRangeSchema,
    platform: z
      .string()
      .optional()
      .describe(
        "Filter by platform string (e.g. 'doordash', 'ubereats', 'css-pos', 'bnm-web'). Omit for all platforms.",
      ),
    minTotal: z
      .number()
      .optional()
      .describe("Only return orders >= this total dollar value."),
    limit: z.number().int().min(1).max(100).optional().default(25),
    sortBy: z
      .enum(["timeDesc", "totalDesc"])
      .optional()
      .default("totalDesc")
      .describe(
        "timeDesc = most recent first; totalDesc = biggest tickets first within the window.",
      ),
  })
  .strict()

export type OrderListChatRow = {
  id: string
  externalDisplayId: string | null
  storeId: string
  platform: string
  referenceTimeLocal: string
  fulfillmentMode: string | null
  /** The platform's own grand total column: net + tax + tip. */
  total: number
  /** Menu price of the lines, BEFORE any discount. Not what the customer paid. */
  subtotal: number
  /** What the customer was charged. This, not `subtotal`, is the ticket. */
  ticket: number
  /** What the marketplace took, as a positive amount. */
  marketplaceFee: number
  /** `ticket − marketplaceFee`. */
  netToRestaurant: number
  itemCount: number
}

export const listOrdersByDay: ChatTool<typeof ordersByDayParams, OrderListChatRow[]> = {
  name: "listOrdersByDay",
  description:
    "Returns individual orders for an owner-scoped slice of stores and a date range. Use for order-grain questions: 'biggest tickets last Friday', 'all orders over $200 this week', 'what came through DoorDash yesterday'. Default sort is totalDesc (biggest first). Use sortBy='timeDesc' for chronological. Cap is 100; for trend questions, use getDailySales / getHourlyTrend instead. `ticket` is what the customer was charged and `subtotal` is the PRE-discount menu price — quote `ticket` when asked what an order was worth. `marketplaceFee` and `netToRestaurant` are pre-derived positives; do not re-derive them.",
  parameters: ordersByDayParams,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const { from, to } = parseDateRange(args.dateRange)
    // dateRange.to is inclusive on YYYY-MM-DD — extend to end-of-day for the
    // referenceTimeLocal comparison (those are timestamps, not dates).
    const toEnd = new Date(to)
    toEnd.setUTCHours(23, 59, 59, 999)

    const orders = await ctx.prisma.otterOrder.findMany({
      where: {
        storeId: { in: storeIds },
        referenceTimeLocal: { gte: from, lte: toEnd },
        ...(args.platform ? { platform: args.platform } : {}),
        ...(args.minTotal !== undefined ? { total: { gte: args.minTotal } } : {}),
      },
      orderBy:
        args.sortBy === "timeDesc"
          ? { referenceTimeLocal: "desc" }
          : { total: "desc" },
      take: args.limit ?? 25,
      select: {
        id: true,
        externalDisplayId: true,
        storeId: true,
        platform: true,
        referenceTimeLocal: true,
        fulfillmentMode: true,
        total: true,
        subtotal: true,
        // Selected so the row can carry a ticket. Returning `subtotal` under a
        // description that invites the model to call it the ticket is the same
        // defect as handing over the raw columns, one step quieter.
        discount: true,
        commission: true,
        _count: { select: { items: true } },
      },
    })

    return orders.map((o) => ({
      id: o.id,
      externalDisplayId: o.externalDisplayId,
      storeId: o.storeId,
      platform: o.platform,
      referenceTimeLocal: o.referenceTimeLocal.toISOString(),
      fulfillmentMode: o.fulfillmentMode,
      total: o.total,
      subtotal: o.subtotal,
      ticket: ticketOf(o),
      marketplaceFee: feeAmount(o),
      netToRestaurant: netOf(o),
      itemCount: o._count.items,
    }))
  },
}

// ---------------------------------------------------------------------------
// getOrderItemFrequency — "what gets ordered together?"
// ---------------------------------------------------------------------------

const itemFrequencyParams = z
  .object({
    storeIds: storeIdsSchema,
    dateRange: dateRangeSchema,
    minOrders: z.number().int().min(1).optional().default(5),
    limit: z.number().int().min(1).max(50).optional().default(20),
  })
  .strict()

export type OrderItemFrequencyChatRow = {
  itemName: string
  orderCount: number
  totalQty: number
  totalRevenue: number
  avgPrice: number
}

export const getOrderItemFrequency: ChatTool<
  typeof itemFrequencyParams,
  OrderItemFrequencyChatRow[]
> = {
  name: "getOrderItemFrequency",
  description:
    "Per-item order frequency from order-level data (OtterOrderItem) over a window — distinct from getTopMenuItems (which uses summary tables). Returns how many orders contained each item, total qty, total revenue, and avg price. Use when the user wants order-level signal ('how many orders had a side of fries?') vs daily revenue rollup. Sorted by orderCount desc.",
  parameters: itemFrequencyParams,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const { from, to } = parseDateRange(args.dateRange)
    const toEnd = new Date(to)
    toEnd.setUTCHours(23, 59, 59, 999)

    // Aggregate in two queries: groupBy for sums, then a distinct-order count
    // (Prisma can't combine these in one groupBy because OtterOrderItem
    // doesn't carry the storeId column directly).
    const items = await ctx.prisma.otterOrderItem.findMany({
      where: {
        order: {
          storeId: { in: storeIds },
          referenceTimeLocal: { gte: from, lte: toEnd },
        },
      },
      select: {
        name: true,
        quantity: true,
        price: true,
        orderId: true,
      },
    })

    const byName = new Map<
      string,
      { orderIds: Set<string>; qty: number; revenue: number; priceTotal: number; priceN: number }
    >()
    for (const it of items) {
      let bucket = byName.get(it.name)
      if (!bucket) {
        bucket = { orderIds: new Set(), qty: 0, revenue: 0, priceTotal: 0, priceN: 0 }
        byName.set(it.name, bucket)
      }
      bucket.orderIds.add(it.orderId)
      bucket.qty += it.quantity
      bucket.revenue += it.quantity * it.price
      bucket.priceTotal += it.price
      bucket.priceN += 1
    }

    const minOrders = args.minOrders ?? 5
    const rows: OrderItemFrequencyChatRow[] = []
    for (const [name, b] of byName.entries()) {
      if (b.orderIds.size < minOrders) continue
      rows.push({
        itemName: name,
        orderCount: b.orderIds.size,
        totalQty: b.qty,
        totalRevenue: b.revenue,
        avgPrice: b.priceN > 0 ? b.priceTotal / b.priceN : 0,
      })
    }
    rows.sort((a, b) => b.orderCount - a.orderCount)
    return rows.slice(0, args.limit ?? 20)
  },
}
