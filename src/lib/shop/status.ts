import type { ShopFulfilment, ShopOrderFilter, ShopOrderStatus } from "./client"

/**
 * What an order's status means on the desk: the glyph it wears, the word
 * beside it, and the one thing to do next.
 *
 * The site's order state machine decides what is legal; this only names it.
 * `next` and `canRefund` mirror the `from` lists in the site's
 * `src/lib/orders/fulfilment.ts`, so the dashboard never offers a button the
 * site would refuse. If the site refuses anyway, its sentence is shown.
 */

/** The same five shapes the Store checks pages use (`.ck-gl--*`). */
export type ShopGlyph = "open" | "late" | "ok" | "miss" | "up"

export type ShopNextStep = "ship" | "ready" | "picked_up"

export type OrderState = {
  glyph: ShopGlyph
  label: string
  next: ShopNextStep | null
  canRefund: boolean
  /** Still on the desk: to ship, to bag, or waiting at the counter. */
  open: boolean
}

/** A paid ship order is late once it has waited this long. */
export const LATE_TO_SHIP_MS = 24 * 60 * 60 * 1000

const REFUNDABLE: readonly ShopOrderStatus[] = ["paid", "fulfilled", "ready_for_pickup", "picked_up"]

export function orderState(
  o: { status: ShopOrderStatus; fulfilment: ShopFulfilment; paidAt?: string | null; createdAt: string },
  now: Date = new Date(),
): OrderState {
  const canRefund = REFUNDABLE.includes(o.status)
  switch (o.status) {
    case "paid": {
      if (o.fulfilment === "pickup") return { glyph: "open", label: "To bag", next: "ready", canRefund, open: true }
      // List rows carry no paidAt; checkout pays within minutes of creating.
      const since = Date.parse(o.paidAt ?? o.createdAt)
      const waited = now.getTime() - since
      if (Number.isFinite(since) && waited > LATE_TO_SHIP_MS) {
        return { glyph: "late", label: `To ship · waiting ${waitedLabel(waited)}`, next: "ship", canRefund, open: true }
      }
      return { glyph: "open", label: "To ship", next: "ship", canRefund, open: true }
    }
    case "ready_for_pickup":
      return { glyph: "open", label: "Ready for pickup", next: "picked_up", canRefund, open: true }
    case "fulfilled":
      return { glyph: "ok", label: "Shipped", next: null, canRefund, open: false }
    case "picked_up":
      return { glyph: "ok", label: "Picked up", next: null, canRefund, open: false }
    case "refunded":
      return { glyph: "miss", label: "Refunded", next: null, canRefund, open: false }
    case "cancelled":
      return { glyph: "up", label: "Cancelled", next: null, canRefund, open: false }
    case "pending":
      return { glyph: "up", label: "Not paid", next: null, canRefund, open: false }
  }
}

function waitedLabel(ms: number): string {
  const hours = Math.floor(ms / 3_600_000)
  if (hours < 48) return `${hours} h`
  return `${Math.floor(hours / 24)} days`
}

export const NEXT_STEP_LABEL: Record<ShopNextStep, string> = {
  ship: "Mark shipped",
  ready: "Bagged, ready for pickup",
  picked_up: "Picked up",
}

export function moneyLabel(cents: number): string {
  const sign = cents < 0 ? "-" : ""
  const abs = Math.abs(cents)
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`
}

/** "Hat, blue" from the two display lines, or the working name for an unnamed draft. */
export function productLabel(p: { displayName1: string; displayName2: string; name: string }): string {
  const shown = [p.displayName1, p.displayName2].filter(Boolean).join(" ")
  return shown || p.name
}

/** How many can still be sold online, or null when nobody counts it. */
export function remainingOf(
  inv: { mode: "untracked" } | { mode: "quantity"; quantity: number } | { mode: "edition"; available: number },
): number | null {
  if (inv.mode === "quantity") return inv.quantity
  if (inv.mode === "edition") return inv.available
  return null
}

/** The level the Today tab calls low. Matches `LOW_STOCK_AT_OR_BELOW` on the site. */
export const LOW_STOCK_AT = 3

export const CARRIERS = ["USPS", "UPS", "FedEx", "DHL", "Other"] as const

/**
 * A best guess at the carrier from the shape of a tracking number, so a
 * scanned label fills both boxes. Only a guess: the owner can change it.
 */
export function guessCarrier(tracking: string): (typeof CARRIERS)[number] | null {
  const t = tracking.replace(/\s+/g, "").toUpperCase()
  if (/^1Z[0-9A-Z]{16}$/.test(t)) return "UPS"
  // USPS: 20 to 22 digits starting 9, or 13 characters ending US.
  if (/^9\d{19,21}$/.test(t) || /^[A-Z]{2}\d{9}US$/.test(t)) return "USPS"
  // USPS IMpb barcodes carry a 420+ZIP routing prefix before the 9…
  if (/^420\d{5}(\d{4})?9\d{19,21}$/.test(t)) return "USPS"
  if (/^\d{12}$/.test(t) || /^\d{15}$/.test(t)) return "FedEx"
  if (/^\d{10}$/.test(t)) return "DHL"
  return null
}

/** A scanned USPS label reads 420 + ZIP before the tracking number; the customer email wants only the number. */
export function cleanTracking(raw: string): string {
  const t = raw.replace(/\s+/g, "").toUpperCase()
  const m = /^420\d{5}(?:\d{4})?(9\d{19,21})$/.exec(t)
  return m ? m[1] : t
}

/** The Orders tab's filters, in order. The site also knows paid, ready and cancelled; Open covers the first two. */
export const ORDER_TABS: ReadonlyArray<{ filter: ShopOrderFilter; label: string }> = [
  { filter: "open", label: "Open" },
  { filter: "fulfilled", label: "Shipped" },
  { filter: "picked_up", label: "Picked up" },
  { filter: "refunded", label: "Refunded" },
  { filter: "all", label: "All" },
]

export function orderFilterOf(raw: string | undefined): ShopOrderFilter {
  return ORDER_TABS.find((t) => t.filter === raw)?.filter ?? "open"
}
