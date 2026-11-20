import { count, money, plural } from "@/lib/counter/format"

/**
 * One menu item "made plain" (owner's go, 2026-11-19; mock
 * https://claude.ai/artifact/YNwJ7EneNdAaC7vDp4HhBe, screen 4): what one
 * plate really keeps, and on which channel a deal or the commission eats it.
 *
 * A channel's keep per plate is what a unit collected there, less its deal,
 * less the app's commission at the store's contract rate, less the plate
 * cost: `(revenue − discount − commission) / units − plateCost`. The same
 * inputs the page's channel table prints its Net each and Margin from. No
 * plate cost, or no rate on file for the channel, reads as a gap in words,
 * never $0.
 */

export interface ItemPlainChannel {
  channel: string
  /** The channel colour, `var(--ch-*)`, for the bar. */
  tint: string
  qty: number
  revenue: number
  discount: number
  /** Null where the schema publishes no rate for the channel. */
  commission: number | null
}

export interface ItemPlainInput {
  name: string
  /** The POS rollup's count, what every menu page prints as Sold. */
  qty: number
  plateCost: number | null
  dealRunning: boolean
  mapped: boolean
  unmappedModifiers: number
  channels: ItemPlainChannel[]
  /** The recipe page, when one is mapped. */
  recipeHref: string | null
}

export interface ItemPlainBar {
  key: string
  channel: string
  tint: string
  /** "$5.62", or why there is no figure. */
  value: string
  /** 0..1 of the widest bar; 0 when there is no figure. */
  share: number
  sold: string
}

export interface ItemPlain {
  sentence: string
  big: { label: string; value: string | null; sub: string; missing?: string }
  bars: ItemPlainBar[]
  statuses: Array<{ tone: "good" | "warn" | "bad"; text: string }>
  recipe: { label: string; href: string } | null
}

const keepEach = (c: ItemPlainChannel, plate: number | null) =>
  plate === null || c.commission === null || c.qty <= 0 ? null : (c.revenue - c.discount - c.commission) / c.qty - plate

export function buildItemPlain(o: ItemPlainInput): ItemPlain {
  const keeps = o.channels.map((c) => ({ c, keep: keepEach(c, o.plateCost) }))
  const priced = keeps.filter((k) => k.keep !== null)
  const unpriced = keeps.filter((k) => k.keep === null && o.plateCost !== null)

  // Overall: every channel with a rate, weighted by its units.
  const units = priced.reduce((t, k) => t + k.c.qty, 0)
  const overall = units > 0 ? priced.reduce((t, k) => t + (k.keep as number) * k.c.qty, 0) / units : null

  const parts: string[] = [`Sold ${count(o.qty)}.`]
  if (o.plateCost === null) {
    parts.push("No recipe costs it yet, so what a plate keeps isn't counted.")
  } else if (overall === null) {
    parts.push("No channel it sold on has a commission rate on file, so what a plate keeps can't be worked out.")
  } else {
    parts.push(`Each one keeps ${money(overall, { cents: true })} after food, deals and app commission.`)
    const sorted = [...priced].sort((a, b) => (a.keep as number) - (b.keep as number))
    const low = sorted[0]
    const high = sorted[sorted.length - 1]
    if (sorted.length > 1 && (high.keep as number) - (low.keep as number) >= 0.5) {
      parts.push(
        `It keeps ${money(high.keep, { cents: true })} on ${high.c.channel} but only ${money(low.keep, { cents: true })} on ${low.c.channel}${
          o.dealRunning && low.c.discount > 0 ? ", because of the deal and the commission" : ""
        }.`,
      )
    }
  }

  const widest = Math.max(0, ...priced.map((k) => Math.abs(k.keep as number)))
  const bars: ItemPlainBar[] = [...keeps]
    .sort((a, b) => b.c.qty - a.c.qty)
    .map((k) => ({
      key: k.c.channel,
      channel: k.c.channel,
      tint: k.c.tint,
      value:
        k.keep !== null ? money(k.keep, { cents: true }) : o.plateCost === null ? "not costed" : "no rate on file",
      share: k.keep !== null && widest > 0 ? Math.max(0, k.keep) / widest : 0,
      sold: `${count(k.c.qty)} sold`,
    }))

  const statuses: ItemPlain["statuses"] = []
  statuses.push(o.mapped ? { tone: "good", text: "Recipe linked" } : { tone: "bad", text: "No recipe linked" })
  if (o.dealRunning) statuses.push({ tone: "warn", text: "Deal running" })
  if (unpriced.length > 0) statuses.push({ tone: "warn", text: `${plural(unpriced.length, "channel")} with no rate on file` })
  if (o.unmappedModifiers > 0) statuses.push({ tone: "warn", text: `${plural(o.unmappedModifiers, "modifier")} not costed` })

  return {
    sentence: parts.join(" "),
    big: {
      label: "Kept per plate",
      value: overall === null ? null : money(overall, { cents: true }),
      sub: o.plateCost === null ? "no plate cost" : `plate costs ${money(o.plateCost, { cents: true })}`,
      missing: unpriced.length > 0 ? `${plural(unpriced.length, "channel")} not counted` : undefined,
    },
    bars,
    statuses,
    recipe: o.recipeHref ? { label: "Open the recipe", href: o.recipeHref } : null,
  }
}
