import { money, pct, plural } from "@/lib/counter/format"

/**
 * Orders and one order "made plain" (owner's go on the mock, 2026-11-18:
 * https://claude.ai/artifact/Sr98ngzuijqUUhPbJNJAv4).
 *
 * Neither builder computes money of its own. The range's count, sales,
 * ticket and app fees are `OrderListResponse`'s totals, the same ones the
 * strip prints; one order's ticket, fee, food and keep are `orderMoney`'s,
 * the same ones its strip prints.
 */

/** "off" states a direction without judging it: fewer orders is not by itself bad (ruling O-R2). */
export type PlainTone = "good" | "warn" | "bad" | "off"

export interface OrdersPlainLatest {
  key: string
  href: string
  /** "9:32pm · DoorDash" */
  what: string
  /** "#4821 · 3 items" */
  sub: string
  ticket: string
  net: string
}

export interface OrdersPlain {
  sentence: string
  orders: number
  vs: { text: string; tone: "up" | "down" | "flat" } | null
  sub: string
  statuses: Array<{ tone: PlainTone; text: string }>
  latest: OrdersPlainLatest[]
}

export interface OrdersPlainInput {
  orders: number
  netSales: number
  /** Null with no orders: a range with none has no average ticket. */
  ticket: number | null
  /** Marketplace fees, recorded plus estimated; null when nothing could be priced. */
  fees: number | null
  thirdPartyCount: number
  thirdPartyNetSales: number
  /** Share of marketplace orders whose fee is an estimate, 0–100. */
  estimatedPct: number
  unpriced: number
  undrained: number
  /** The strip's own comparison words for the order count, or null with none set. */
  vs: { text: string; tone: string } | null
  latest: ReadonlyArray<{
    key: string
    href: string
    id: string
    time: string
    channel: { label: string }
    items: string
    ticket: string
    net: string
  }>
}

/** Orders listed in the answer. The full list is folded below. */
export const LATEST_SHOWN = 5

const toneOf = (t: string): "up" | "down" | "flat" => (t === "is-down" ? "down" : t === "is-flat" ? "flat" : "up")

export function buildOrdersPlain(input: OrdersPlainInput): OrdersPlain {
  const parts: string[] = []
  if (input.orders === 0) {
    parts.push("No orders came in for this range yet.")
  } else {
    const change = input.vs ? ` (${input.vs.text})` : ""
    parts.push(
      `${plural(input.orders, "order")}${change} brought in ${money(input.netSales)}, an average ticket of ${money(input.ticket, { cents: true })}.`,
    )
    if (input.thirdPartyCount > 0) {
      if (input.fees === null) {
        parts.push("App fees are not on file for these orders yet.")
      } else {
        const share = input.thirdPartyNetSales > 0 ? input.fees / input.thirdPartyNetSales : null
        parts.push(
          `Delivery apps took ${input.estimatedPct > 0 ? "about " : ""}${money(input.fees)} in fees${share === null ? "" : `, ${pct(share * 100, { scaled: true })} of their sales`}.`,
        )
      }
    }
    if (input.undrained > 0) {
      parts.push(`${plural(input.undrained, "order is", "orders are")} still missing item details.`)
    }
  }

  const statuses: OrdersPlain["statuses"] = []
  if (input.vs && input.orders > 0) {
    const t = toneOf(input.vs.tone)
    statuses.push({
      tone: "off",
      text: t === "down" ? "Fewer orders than the comparison" : t === "flat" ? "Orders level" : "More orders than the comparison",
    })
  }
  if (input.estimatedPct > 0) statuses.push({ tone: "warn", text: `App fees estimated on ${input.estimatedPct}% of app orders` })
  if (input.unpriced > 0) statuses.push({ tone: "warn", text: `${plural(input.unpriced, "app order")} with no fee or rate` })
  if (input.undrained > 0) statuses.push({ tone: "warn", text: `${plural(input.undrained, "order")} missing item details` })
  if (input.orders > 0 && statuses.every((s) => s.tone === "good" || s.tone === "off")) statuses.push({ tone: "good", text: "Every order has its details" })

  return {
    sentence: parts.join(" "),
    orders: input.orders,
    vs: input.vs ? { text: input.vs.text, tone: toneOf(input.vs.tone) } : null,
    sub: input.orders > 0 ? `${money(input.netSales)} in sales` : "",
    statuses,
    latest: input.latest.slice(0, LATEST_SHOWN).map((r) => ({
      key: r.key,
      href: r.href,
      what: `${r.time} · ${r.channel.label}`,
      sub: `${r.id} · ${r.items}`,
      ticket: r.ticket,
      net: r.net,
    })),
  }
}

/* ── One order ──────────────────────────────────────────────────────── */

export interface OrderPlainLine {
  key: string
  label: string
  value: string
  total?: boolean
}

export interface OrderPlain {
  sentence: string
  big: { label: string; value: string; sub: string; missing?: string }
  lines: OrderPlainLine[]
  statuses: Array<{ tone: PlainTone; text: string }>
}

export interface OrderPlainInput {
  /** "DoorDash" */
  platform: string
  house: boolean
  ticket: number
  commission: number
  /** Commission as a fraction of the ticket. */
  rate: number
  /** Ticket less the marketplace's share: the strip's "You keep". */
  keep: number
  /** Recipe cost of the costed lines, or null when none is costed. */
  cost: number | null
  uncosted: number
}

export function buildOrderPlain(o: OrderPlainInput): OrderPlain {
  const c = (v: number) => money(v, { cents: true })
  const left = o.cost === null ? null : o.keep - o.cost

  const parts: string[] = [`The guest paid ${c(o.ticket)}.`]
  if (o.commission > 0) parts.push(`${o.platform} took ${c(o.commission)}.`)
  if (left !== null) {
    parts.push(`Food cost ${c(o.cost!)}, so ${left >= 0 ? `${c(left)} is left` : `the order lost ${c(-left)}`}.`)
  } else {
    parts.push(`You keep ${c(o.keep)} before food, which is not costed for this order.`)
  }
  if (left !== null && o.uncosted > 0) parts.push(`${plural(o.uncosted, "line")} not costed, so the true figure is lower.`)

  const lines: OrderPlainLine[] = [{ key: "paid", label: "Paid", value: c(o.ticket) }]
  if (o.commission > 0) {
    lines.push({ key: "fee", label: `${o.platform} fee (${pct(o.rate * 100, { scaled: true })})`, value: `−${c(o.commission)}` })
  }
  lines.push(
    o.cost === null
      ? { key: "food", label: "Food (recipe cost)", value: "not costed" }
      : { key: "food", label: o.uncosted > 0 ? "Food (costed lines)" : "Food (recipe cost)", value: `−${c(o.cost)}` },
  )
  lines.push({ key: "left", label: left === null ? "You keep, before food" : "Left after fees and food", value: c(left ?? o.keep), total: true })

  const statuses: OrderPlain["statuses"] = []
  if (o.cost === null) statuses.push({ tone: "warn", text: "Food not costed" })
  else if (o.uncosted > 0) statuses.push({ tone: "warn", text: `${plural(o.uncosted, "line")} not costed` })
  else statuses.push({ tone: "good", text: "Every line costed" })
  if (left !== null && left < 0) statuses.push({ tone: "bad", text: "Lost money on this order" })
  if (o.house) statuses.push({ tone: "good", text: "No app fee" })

  return {
    sentence: parts.join(" "),
    big:
      left === null
        ? { label: "You keep, before food", value: c(o.keep), sub: `${pct((1 - o.rate) * 100, { scaled: true })} of the ticket`, missing: "food not costed" }
        : {
            label: "Left after fees and food",
            value: c(left),
            sub: o.ticket > 0 ? `${pct((left / o.ticket) * 100, { scaled: true })} of the ticket` : "",
          },
    lines,
    statuses,
  }
}

