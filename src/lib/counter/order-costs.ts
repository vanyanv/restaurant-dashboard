/**
 * Per-line "what did the channel take, what did it cost us" for one order.
 *
 * Deliberately a pure function with no Prisma access: the caller (a page
 * adapter, built in a later task) resolves `recipeBySku` from
 * `OtterItemMapping` / `OtterSubItemMapping` and `costByRecipe` from
 * `batchRecipeCosts`, then hands both in as plain maps. That split is what
 * makes this testable without mocking the database, and it means a change to
 * how mappings or recipe costs are queried never has to touch this file.
 */

export interface LineCostInput {
  /** `OtterOrderItem` and `OtterOrderSubItem` flattened, in render order. */
  lines: Array<{
    key: string
    name: string
    /** A sub-item — the prototype's `l.mod`. */
    modifier: boolean
    skuId: string
    quantity: number
    /** What the channel charged for this line. */
    price: number
  }>
  /** skuId -> recipeId, from OtterItemMapping / OtterSubItemMapping. */
  recipeBySku: Map<string, string>
  /** recipeId -> { totalCost, partial }, from batchRecipeCosts. */
  costByRecipe: Map<string, { totalCost: number; partial: boolean }>
  /** The order's commission as a fraction of its ticket. */
  commissionRate: number
  /**
   * What the customer was actually charged for the whole order — `ticketOf`,
   * i.e. `subtotal + discount`. See `lineScale` for what it is used for and
   * why the LINES cannot be trusted to carry the discount themselves.
   */
  ticket: number
}

/**
 * How much of its own price a line was actually paid, in [0, 1].
 *
 * ## The measurement this is built on
 *
 * Over the 500 most recently drained orders (live database, 2026-08-26),
 * `Σ line.price` against the order's own columns:
 *
 *   Σ line.price === subtotal (lines are PRE-discount)   324
 *   Σ line.price === ticket   (lines are POST-discount)   98
 *   neither (lines missing, partial, or both)             78
 *
 * So the lines are pre-discount roughly two thirds of the time and already
 * discounted a fifth of the time, and NOTHING on the row says which. 315 of
 * the 500 carry an order-level discount at all, and on those the line total
 * runs a median 24.95% (max 100.15%) above the ticket.
 *
 * That is why `keep = price × (1 − commissionRate)` was wrong: the rate was
 * right — `commissionRateOf` divides by `ticketOf` — but it was applied to a
 * price the customer never paid, so every per-line margin under a discount was
 * inflated by the discount, directly beneath an order-level Contribution that
 * was computed correctly from `netOf`.
 *
 * ## The rule, and why it is one expression rather than three branches
 *
 * The lines are scaled DOWN to the ticket when they exceed it, and never
 * scaled up:
 *
 *   scale = Σ price > ticket ? ticket / Σ price : 1
 *
 * - pre-discount lines, all present: `Σ price === subtotal > ticket`, so the
 *   scale is exactly `ticket / subtotal` — the fraction of menu price paid.
 * - already-discounted lines: `Σ price === ticket`, so the scale is 1 and the
 *   discount is not applied twice.
 * - lines missing with no discount: `Σ price < ticket`, so the scale is 1.
 *   Scaling UP would spread the value of the absent lines across the present
 *   ones and report keeping more per line than the order actually left. The
 *   shortfall is stated by the Items table instead (`buildOrderItems`), never
 *   distributed.
 *
 * A line is therefore never credited with more than its own price, and
 * `Σ charged = min(Σ price, ticket) <= ticket` always — so the residual the
 * table has to explain is never negative.
 */
export function lineScale(lineTotal: number, ticket: number): number {
  if (lineTotal <= 0 || ticket <= 0) return 1
  return lineTotal > ticket ? ticket / lineTotal : 1
}

export interface LineCost {
  key: string
  name: string
  modifier: boolean
  quantity: number
  /** What the channel listed this line at. Pre-discount on two orders in three. */
  price: number
  /**
   * What the customer actually paid for this line — `price × lineScale`.
   *
   * Equal to `price` on an order with no order-level discount, which is 37% of
   * them, and lower on the rest.
   */
  charged: number
  /** charged × (1 − commissionRate) — the prototype's `l.keep`, on the DISCOUNTED price. */
  keep: number
  /** null when this line has no recipe behind it, or its recipe does not fully price. */
  cost: number | null
  /** Why there is no cost, for the queue item. */
  uncostedReason: "unmapped" | "partial" | null
}

export function resolveLineCosts(input: LineCostInput): LineCost[] {
  const { lines, recipeBySku, costByRecipe, commissionRate, ticket } = input

  const scale = lineScale(
    lines.reduce((t, l) => t + l.price, 0),
    ticket,
  )

  return lines.map((line) => {
    const charged = line.price * scale
    const keep = charged * (1 - commissionRate)

    const recipeId = recipeBySku.get(line.skuId)
    if (!recipeId) {
      return {
        key: line.key,
        name: line.name,
        modifier: line.modifier,
        quantity: line.quantity,
        price: line.price,
        charged,
        keep,
        cost: null,
        uncostedReason: "unmapped",
      }
    }

    const recipeCost = costByRecipe.get(recipeId)
    // No entry for a mapped recipe is the same failure mode as "partial":
    // batchRecipeCosts didn't produce a full price for it.
    if (!recipeCost || recipeCost.partial) {
      return {
        key: line.key,
        name: line.name,
        modifier: line.modifier,
        quantity: line.quantity,
        price: line.price,
        charged,
        keep,
        cost: null,
        uncostedReason: "partial",
      }
    }

    return {
      key: line.key,
      name: line.name,
      modifier: line.modifier,
      quantity: line.quantity,
      price: line.price,
      charged,
      keep,
      cost: recipeCost.totalCost * line.quantity,
      uncostedReason: null,
    }
  })
}
