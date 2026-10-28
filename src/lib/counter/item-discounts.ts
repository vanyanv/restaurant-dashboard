import type { PrismaClient } from "@/generated/prisma/client"
import { prisma } from "@/lib/prisma"

/**
 * What an item actually collected once the deals came off — the one function
 * every per-item margin reads its discount from.
 *
 * `DailyCogsItem.salesRevenue` (and `OtterMenuItem`'s totals under it) is the
 * price BEFORE discounts. On a buy-one-get-one that is twice what the kitchen
 * is paid: the delivery-app "Signature Double Patty & Cheese Slider" rings up
 * as 2 × $13.49 with a −$13.49 discount on the order, so a margin over
 * `salesRevenue` read ~11% food cost on a plate that really runs ~23%. COGS was
 * never wrong — each slider is costed — only the denominator was. The P&L
 * already takes discounts off on their own line (GL 4110), so this is about
 * per-item margins agreeing with it, not about the statement.
 *
 * Discounts live on the ORDER (`OtterOrder.discount`, signed negative), not
 * the line, so `allocateOrderDiscount` decides which items an order's discount
 * belongs to. Spreading it by subtotal share is wrong for the case that
 * matters: on a BOGO order that also bought fries, a third of the free slider
 * landed on the fries (measured: Loaded Fries read 36% off, Straight-Cut 31%,
 * neither of which runs a deal). So a discount that is a whole number of some
 * item's unit price goes to that item; anything else is spread by value.
 *
 * Applied as a SHARE (`discount / gross`, both from the order feed) to the
 * POS-rollup revenue rather than by subtracting dollars, because the two feeds
 * are known to disagree by a few percent on quantity (see `menu-item.ts`'s
 * channel note); a share carries across that gap, a dollar figure would not.
 */
export interface ItemDiscount {
  /** Line value on the order feed — price × quantity — before discounts. */
  gross: number
  /** Dollars of order discount attributed to the item, as a POSITIVE number. */
  discount: number
}

export interface ItemDiscountEntry extends ItemDiscount {
  /** The same split by `OtterOrder.platform` ("ubereats", "doordash", …). */
  byPlatform: Map<string, ItemDiscount>
}

/**
 * A deal is "running" on an item when more than this share of what it rang up
 * was taken back off. 10% is above the everyday noise of one-off promo codes
 * (the combos run ~4%) and well below a BOGO (~50%).
 */
export const DEAL_THRESHOLD = 0.1

/** Discount over gross, clamped to [0, 1]; 0 with nothing to divide by. */
export function discountShare(d: ItemDiscount | null | undefined): number {
  if (!d || !(d.gross > 0) || !(d.discount > 0)) return 0
  return Math.min(1, d.discount / d.gross)
}

export function isDealRunning(d: ItemDiscount | null | undefined): boolean {
  return discountShare(d) > DEAL_THRESHOLD
}

/** `revenue` less the item's discount share — what was actually collected. */
export function netOfDiscount(revenue: number, d: ItemDiscount | null | undefined): number {
  return revenue * (1 - discountShare(d))
}

/** One line of a discounted order, as `allocateOrderDiscount` reads it. */
export interface OrderLine {
  name: string
  price: number
  quantity: number
}

/** Cents of slack when testing "is this discount a whole number of that price". */
const PRICE_MATCH_TOLERANCE = 0.02

/**
 * Who an order's discount belongs to, as dollars per item name.
 *
 * A discount equal to a whole number of one item's unit price, with at least
 * as many paid units of it as free ones, is that item's deal — the BOGO shape, `−$13.49` on
 * `2 × $13.49`. Where several items fit, the one with the most units wins,
 * since a buy-one-get-one needs at least two. Anything else is spread across
 * the items by their share of the order's value.
 */
export function allocateOrderDiscount(discount: number, lines: OrderLine[]): Map<string, number> {
  const out = new Map<string, number>()
  if (!(discount > 0) || lines.length === 0) return out

  const matches = lines
    .filter((l) => l.price > 0 && l.quantity > 0)
    .filter((l) => {
      const units = Math.round(discount / l.price)
      return (
        units >= 1 &&
        // A free unit needs a paid one beside it: "$3 off" on one $3 side
        // is a coupon, not that side's deal.
        units * 2 <= l.quantity &&
        Math.abs(units * l.price - discount) <= PRICE_MATCH_TOLERANCE
      )
    })
    .sort((a, b) => b.quantity - a.quantity)
  if (matches.length > 0) {
    out.set(matches[0].name, discount)
    return out
  }

  const total = lines.reduce((t, l) => t + Math.max(0, l.price * l.quantity), 0)
  if (!(total > 0)) return out
  for (const l of lines) {
    const value = Math.max(0, l.price * l.quantity)
    if (value === 0) continue
    out.set(l.name, (out.get(l.name) ?? 0) + (discount * value) / total)
  }
  return out
}

/**
 * Per item name (the order feed's `OtterOrderItem.name`), the gross and the
 * discount attributed to it over the window, overall and per platform.
 *
 * `accountId` is the tenancy boundary: the stores are re-checked against it in
 * both queries, so a store id that is not this account's contributes nothing.
 */
export async function getItemDiscounts(input: {
  accountId: string
  storeIds: string[]
  startDate: Date
  endDate: Date
  /** Limit to one item name — the menu item page. */
  itemName?: string
  /** Defaults to the app client; the chat tools pass their context's. */
  db?: Pick<PrismaClient, "$queryRaw">
}): Promise<Map<string, ItemDiscountEntry>> {
  const { accountId, storeIds, startDate, endDate, itemName } = input
  const db = input.db ?? prisma
  const out = new Map<string, ItemDiscountEntry>()
  if (storeIds.length === 0) return out
  const only = itemName ?? null

  const [grossRows, discountedLines] = await Promise.all([
    db.$queryRaw<{ name: string; platform: string; gross: number }[]>`
      SELECT i."name" AS name,
             o."platform" AS platform,
             SUM(i."price" * i."quantity")::float AS gross
      FROM "OtterOrderItem" i
      JOIN "OtterOrder" o ON o."id" = i."orderId"
      JOIN "Store" s ON s."id" = o."storeId"
      WHERE s."accountId" = ${accountId}
        AND o."storeId" = ANY(${storeIds})
        AND o."referenceTimeLocal" BETWEEN ${startDate} AND ${endDate}
        AND (${only}::text IS NULL OR i."name" = ${only})
      GROUP BY i."name", o."platform"`,
    // Every line of every discounted order — not only the named item's —
    // because whether the discount is that item's depends on what else the
    // order held.
    db.$queryRaw<
      { orderId: string; platform: string; discount: number; name: string; price: number; quantity: number }[]
    >`
      SELECT o."id" AS "orderId",
             o."platform" AS platform,
             (-o."discount")::float AS discount,
             i."name" AS name,
             i."price"::float AS price,
             i."quantity"::float AS quantity
      FROM "OtterOrder" o
      JOIN "Store" s ON s."id" = o."storeId"
      JOIN "OtterOrderItem" i ON i."orderId" = o."id"
      WHERE s."accountId" = ${accountId}
        AND o."storeId" = ANY(${storeIds})
        AND o."referenceTimeLocal" BETWEEN ${startDate} AND ${endDate}
        AND o."discount" < 0
        AND (${only}::text IS NULL OR EXISTS (
          SELECT 1 FROM "OtterOrderItem" x WHERE x."orderId" = o."id" AND x."name" = ${only}
        ))`,
  ])

  const entryFor = (name: string) => {
    const entry = out.get(name) ?? { gross: 0, discount: 0, byPlatform: new Map() }
    out.set(name, entry)
    return entry
  }
  const platformOf = (entry: ItemDiscountEntry, platform: string) => {
    const p = entry.byPlatform.get(platform) ?? { gross: 0, discount: 0 }
    entry.byPlatform.set(platform, p)
    return p
  }

  for (const r of grossRows) {
    const gross = Number(r.gross) || 0
    const entry = entryFor(r.name)
    entry.gross += gross
    platformOf(entry, r.platform).gross += gross
  }

  const orders = new Map<string, { platform: string; discount: number; lines: OrderLine[] }>()
  for (const r of discountedLines) {
    const o = orders.get(r.orderId) ?? {
      platform: r.platform,
      discount: Number(r.discount) || 0,
      lines: [],
    }
    o.lines.push({ name: r.name, price: Number(r.price) || 0, quantity: Number(r.quantity) || 0 })
    orders.set(r.orderId, o)
  }
  for (const o of orders.values()) {
    for (const [name, dollars] of allocateOrderDiscount(o.discount, o.lines)) {
      if (only !== null && name !== only) continue
      const entry = entryFor(name)
      entry.discount += dollars
      platformOf(entry, o.platform).discount += dollars
    }
  }
  return out
}
