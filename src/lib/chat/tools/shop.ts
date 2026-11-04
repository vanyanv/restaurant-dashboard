import { z } from "zod"
import type { ChatTool } from "./types"
import { shop, shopEnabledFor, type ShopOrderFilter } from "@/lib/shop/client"

/**
 * The merch shop: sales, open orders, and products with stock. The shop lives
 * in the website's own database; this reads the same signed private API the
 * Shop pages read (`@/lib/shop/client`), so the chat never touches that
 * database and an account that does not own the shop gets "not connected"
 * without a network call.
 *
 * Read-only. Shipping, refunds and stock changes stay on the Shop pages.
 * Customer emails, phone numbers and addresses are never returned; an order
 * carries the customer's first name only.
 */

const FILTERS = ["open", "paid", "ready_for_pickup", "fulfilled", "picked_up", "refunded", "cancelled", "all"] as const

const params = z
  .object({
    orders: z
      .enum(FILTERS)
      .optional()
      .default("open")
      .describe("Which orders to list: open (still to ship or hand over, the default), a single status, or all (newest 50)."),
  })
  .strict()

const dollars = (cents: number) => Math.round(cents) / 100

export type ShopResult =
  | { connected: false; note: string }
  | {
      connected: true
      /** The shop's own 30-day window, by day. Dollars, not cents. */
      sales: { paid: number; refunded: number; orders: number; days: Array<{ date: string; paid: number; refunded: number; orders: number }> }
      toDo: { toShip: number; lateToShip: number; toBag: number; readyForPickup: number; shippedLast7: number; pickedUpLast7: number }
      paused: boolean
      /** True when more orders match than the 50 listed. */
      ordersTruncated: boolean
      orders: Array<{ number: string; status: string; fulfilment: string; placed: string; customer: string | null; items: string; total: number }>
      products: Array<{ name: string; status: string; price: number; stock: number | null }>
      lowStock: Array<{ name: string; remaining: number }>
    }

export const getShopOrders: ChatTool<typeof params, ShopResult> = {
  name: "getShopOrders",
  description:
    "The merch shop on chrisneddys.com: paid and refunded sales by day (last 30 days), orders to ship or bag, late orders, ready for pickup, the order list by status (number, items, total, first name), and every product with price and stock left, plus low-stock items. Use for 'how is merch selling', 'any shop orders to ship', 'how many shirts are left'. Not restaurant food sales.",
  parameters: params,
  async execute(args, ctx) {
    if (!shopEnabledFor(ctx.accountId)) {
      return { connected: false, note: "The shop is not connected to this dashboard account." }
    }
    const filter: ShopOrderFilter = args.orders ?? "open"
    const [summary, list, products] = await Promise.all([
      shop.summary(ctx.accountId),
      shop.orders(ctx.accountId, filter),
      shop.products(ctx.accountId),
    ])
    return {
      connected: true,
      sales: {
        paid: dollars(summary.sales.paidCents),
        refunded: dollars(summary.sales.refundedCents),
        orders: summary.sales.orders,
        days: summary.sales.days.map((d) => ({
          date: d.date,
          paid: dollars(d.paidCents),
          refunded: dollars(d.refundedCents),
          orders: d.orders,
        })),
      },
      toDo: summary.counts,
      paused: summary.settings.shopPaused,
      ordersTruncated: list.nextCursor != null || list.rows.length > 50,
      orders: list.rows.slice(0, 50).map((o) => ({
        number: o.number,
        status: o.status,
        fulfilment: o.fulfilment,
        placed: new Date(o.createdAt).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }),
        customer: o.customerName ? o.customerName.trim().split(/\s+/)[0] : null,
        items: o.itemsSummary,
        total: dollars(o.totalCents),
      })),
      products: products.map((p) => ({
        name: p.name,
        status: p.status,
        price: dollars(p.priceCents),
        stock: p.inventory.mode === "quantity" ? p.inventory.quantity : null,
      })),
      lowStock: summary.lowStock.map((l) => ({ name: l.name, remaining: l.remaining })),
    }
  },
}
