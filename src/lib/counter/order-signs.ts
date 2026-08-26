/**
 * How `OtterOrder`'s money columns are actually signed, and the three figures
 * everything else should read instead of the raw columns.
 *
 * ## The measurement
 *
 * `discount` and `commission` are stored as SIGNED DEDUCTIONS — negative
 * numbers that are ADDED to reach a net, not positive amounts to subtract.
 * Counted against the live database on 2026-08-26:
 *
 *   discount   > 0:      0 rows        commission > 0:      0 rows
 *   discount   < 0: 40,055 rows        commission < 0: 25,648 rows
 *
 * The sync writes them that way: `otter-orders-sync.ts` sums Otter's own
 * `restaurant_funded_discount + ofo_funded_discount` into `discount` and maps
 * `adjusted_commission` straight into `commission`, and Otter signs both as
 * adjustments.
 *
 * A worked row, `3926DEFE` on DoorDash:
 *
 *   subtotal   74.94
 *   discount  −37.47   ->  ticket  = 74.94 + (−37.47) = 37.47
 *   commission −9.37   ->  rate    = 9.37 / 37.47      = 25.0%   (DoorDash's rate)
 *                          net     = 37.47 + (−9.37)   = 28.10
 *   total      41.40   (= net + tax + tip)
 *
 * Every DoorDash sample checks out at exactly 25.0% once the ticket is taken
 * as `subtotal + discount`, which is also the proof that the commission is
 * charged on the DISCOUNTED ticket rather than the gross one.
 *
 * ## Why this file exists rather than three inline expressions
 *
 * `subtotal − discount` reads like the obviously-right formula and is wrong in
 * the direction that FLATTERS: on that row it returns 112.41 against a real
 * ticket of 37.47, and `ticket − commission` then reports 121.78 kept on an
 * order that actually left 28.10 behind. Both the orders adapter and
 * `getOrdersList`'s range aggregate had it that way, and the fixtures that
 * covered them all used positive discounts, so nothing was red.
 *
 * A figure this wrong is not caught by review — it is caught by counting rows
 * in the database, which is what should happen before any column is trusted.
 */

/** What the customer was charged, after discounts and before the marketplace's cut. */
export function ticketOf(order: { subtotal: number; discount: number }): number {
  return order.subtotal + order.discount
}

/**
 * The fee the marketplace took, as a POSITIVE amount, or 0 when it took none.
 *
 * `Math.max(0, …)` rather than a bare negation: an in-house order stores `0`,
 * and were a positive commission ever to appear it would mean the column's
 * convention had changed, in which case reporting no fee is the safe reading.
 */
export function feeAmount(order: { commission: number }): number {
  return Math.max(0, -order.commission)
}

/**
 * The ticket less the marketplace's cut — what the order left behind before food.
 *
 * Built from `feeAmount`, not from the raw column. Adding `order.commission`
 * directly gives the same answer for every row in the database, but it breaks
 * this module's own invariant on the one shape `feeAmount` guards against: a
 * POSITIVE commission would make the net exceed the ticket, and
 * `buildOrderKeep` would then draw `ticket → net` with no operation between
 * them and a bottom line larger than the top.
 */
export function netOf(order: { subtotal: number; discount: number; commission: number }): number {
  return ticketOf(order) - feeAmount(order)
}
