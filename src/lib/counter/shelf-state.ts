/**
 * The shelf, one state per line of the count list.
 *
 * This is the one function that says what a line's block looks like on the
 * shelf map, what its row says on the Shelf tab, and whether it is one of the
 * "N to order now" the store switcher, the Overview headline and the store
 * cards all print. Nothing else may decide that: the three figures on a screen
 * agree because they are one count of one list of states.
 *
 * The rule table, first match wins:
 *
 *   | The line                                              | State         |
 *   | ----------------------------------------------------- | ------------- |
 *   | no line on the store's last finished count            | `not_counted` |
 *   | a box with something in it and no size, or a partial  | `cant_tell`   |
 *   |   line (another stop of the same item has such a box) |               |
 *   | counted zero, and nothing has come in since           | `out`         |
 *   | has a use rate: the draft order's own reading         | `order_now` / |
 *   |                                                       | `order_soon` /|
 *   |                                                       | `ok`          |
 *   | has a use rate the draft cannot read (below zero, or  | `cant_tell`   |
 *   |   no count it may start from)                         |               |
 *   | counted, nothing on the menu uses it                  | `in_stock`    |
 *
 * It never guesses. A line the app cannot read is `cant_tell`, never "fine",
 * and a line nobody counted is `not_counted`, never zero.
 */

/**
 * The view of every store at once. It is never written to the URL: across the
 * app no `?store=` already means all stores, and the rail and the phone tab
 * bar carry `?store=` between sections, so a made-up id would travel with it.
 */
export const ALL_STORES = "all"

export const SHELF_STATES = ["out", "order_now", "order_soon", "ok", "in_stock", "cant_tell", "not_counted"] as const
export type ShelfState = (typeof SHELF_STATES)[number]

/** The draft order's reading of an item (`StockRow.status`). */
export type ShelfFlow = "now" | "soon" | "ok" | "unknown"

export interface ShelfStateInput {
  /**
   * This item on the store's last finished count: the total counted, in recipe
   * units, and whether any box with something in it had no size (the saved
   * line is then only a floor). Null when the count has no line for it.
   */
  counted: { qty: number; unsized: boolean } | null
  /**
   * On hand now: the count rolled forward by deliveries, use and waste. Null
   * when there is no count it may roll forward from.
   */
  onHandNow: number | null
  /** Null when nothing on the menu uses the item, so it has no run-out date. */
  flow: ShelfFlow | null
}

export function shelfState(input: ShelfStateInput): ShelfState {
  const { counted, onHandNow, flow } = input
  if (counted === null) return "not_counted"
  if (counted.unsized) return "cant_tell"
  // A delivery since the count puts something back on the shelf: the line is
  // then read like any other, not left at "Out".
  if (!(counted.qty > 0) && !(onHandNow !== null && onHandNow > 0)) return "out"
  if (flow === "now") return "order_now"
  if (flow === "soon") return "order_soon"
  if (flow === "ok") return "ok"
  if (flow === "unknown") return "cant_tell"
  return "in_stock"
}

/** Legend and row wording. `order_soon` is the fallback when rows name different days. */
export const SHELF_STATE_LABEL: Record<ShelfState, string> = {
  out: "Out",
  order_now: "Order today",
  order_soon: "Order soon",
  ok: "Fine",
  in_stock: "In stock, no run-out date",
  cant_tell: "Can't tell yet",
  not_counted: "Not counted",
}

/** States that belong on today's order. */
export function needsOrderNow(state: ShelfState): boolean {
  return state === "out" || state === "order_now"
}

/**
 * "N to order now": items, not stops. An item counted at two stops (beef in
 * the walk-in and on the line) is ordered once.
 */
export function toOrderNow(lines: ReadonlyArray<{ ingredientId: string; state: ShelfState }>): number {
  return new Set(lines.filter((l) => needsOrderNow(l.state)).map((l) => l.ingredientId)).size
}

export function stateCounts(lines: ReadonlyArray<{ state: ShelfState }>): Record<ShelfState, number> {
  const out = Object.fromEntries(SHELF_STATES.map((s) => [s, 0])) as Record<ShelfState, number>
  for (const l of lines) out[l.state]++
  return out
}

export interface ShelfCoverage {
  /** Lines on the count list. */
  lines: number
  /** Lines on the last finished count. */
  counted: number
  /** Counted lines with a dollar value: every box sized and a price on file. */
  valued: number
  /** Counted lines with no dollar value yet. Never added in as $0. */
  notValued: number
  notCounted: number
  /** Σ of the valued lines. Null when no line is valued: an unknown, not $0. */
  dollars: number | null
}

/**
 * "X of Y lines, Z not valued yet", and the dollars those X lines add up to.
 * The total only ever covers the lines it names.
 */
export function shelfCoverage(lines: ReadonlyArray<{ state: ShelfState; dollars: number | null }>): ShelfCoverage {
  let counted = 0
  let valued = 0
  let dollars = 0
  for (const l of lines) {
    if (l.state === "not_counted") continue
    counted++
    if (l.dollars !== null) {
      valued++
      dollars += l.dollars
    }
  }
  return {
    lines: lines.length,
    counted,
    valued,
    notValued: counted - valued,
    notCounted: lines.length - counted,
    dollars: valued > 0 ? dollars : null,
  }
}

/**
 * The title of the "order soon" group: the day itself when every row shares
 * one ("Order by Thu Nov 12"), otherwise the plain word and each row says its
 * own day.
 */
export function orderSoonTitle(whens: ReadonlyArray<string | null>): string {
  const days = new Set(whens.filter((w): w is string => !!w && w.startsWith("Order by ")))
  return days.size === 1 && days.size === new Set(whens).size ? [...days][0] : SHELF_STATE_LABEL.order_soon
}
