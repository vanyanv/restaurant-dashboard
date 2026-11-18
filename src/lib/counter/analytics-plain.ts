import { money, pct } from "@/lib/counter/format"

/**
 * Analytics "made plain" (owner's go on the mock, 2026-11-18:
 * https://claude.ai/artifact/Sr98ngzuijqUUhPbJNJAv4), for the group page and
 * one store's page.
 *
 * Nothing is computed here. Sales and the comparison are the strip's own
 * (`comparisonPhrase` over the statement's gross sales); the channel totals,
 * marketplace share and commission are `channelSeries`'; the best weekday is
 * `dayOfWeekProfile`'s, the same reading the weekday panel draws.
 */

export interface AnalyticsPlainInput {
  sales: number
  /** The strip's comparison words, or null when there is no real baseline. */
  vs: { text: string; tone: string } | null
  /** Marketplace share of the four channels' sales, 0..100. */
  marketplaceShare: number
  commission: number
  /** The four channels' total, the denominator of every share. */
  channelTotal: number
  channels: ReadonlyArray<{ name: string; total: number }>
  /** The best weekday; `averaged` is false when every weekday is one day's reading. */
  best: { name: string; average: number; averaged: boolean } | null
}

export interface AnalyticsPlainChannel {
  key: string
  name: string
  sales: string
  share: string
  /** 0..100, of the biggest channel, for the bar. */
  bar: number
}

export interface AnalyticsPlain {
  sentence: string
  big: { label: string; value: string }
  vs: { change: string; tone: "up" | "down" | "flat"; against: string } | null
  channels: AnalyticsPlainChannel[]
}

export function buildAnalyticsPlain(o: AnalyticsPlainInput): AnalyticsPlain {
  if (o.sales === 0 && o.channelTotal <= 0) {
    return { sentence: "No sales in this range yet.", big: { label: "Sales", value: money(0) }, vs: null, channels: [] }
  }

  const parts: string[] = [`Sales were ${money(o.sales)}${o.vs ? ` (${o.vs.text})` : ""}.`]
  if (o.best !== null) {
    parts.push(
      o.best.averaged
        ? `${o.best.name} is the best day, averaging ${money(o.best.average)}.`
        : `${o.best.name} sold the most, ${money(o.best.average)}.`,
    )
  }
  if (o.channelTotal > 0 && o.marketplaceShare > 0) {
    parts.push(
      `Delivery apps brought ${pct(o.marketplaceShare, { scaled: true })} of channel sales${o.commission > 0 ? ` and took ${money(o.commission)} in commission` : ""}.`,
    )
  } else if (o.channelTotal > 0) {
    parts.push("Every channel sale came in direct, with no app commission.")
  }

  const top = Math.max(0, ...o.channels.map((c) => c.total))
  const channels = o.channels
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total)
    .map((c) => ({
      key: c.name,
      name: c.name,
      sales: money(c.total),
      share: o.channelTotal > 0 ? pct((c.total / o.channelTotal) * 100, { scaled: true }) : "—",
      bar: top > 0 ? Math.round((c.total / top) * 100) : 0,
    }))

  const tone: "up" | "down" | "flat" = o.vs?.tone === "is-down" ? "down" : o.vs?.tone === "is-flat" ? "flat" : "up"
  // The strip's text is "▲ 9.9% vs last week": split it so the change is coloured and the rest is not.
  const vs = o.vs
    ? (() => {
        const i = o.vs.text.indexOf(" vs ")
        return i < 0
          ? { change: o.vs.text, tone, against: "" }
          : { change: o.vs.text.slice(0, i), tone, against: o.vs.text.slice(i + 1) }
      })()
    : null

  return { sentence: parts.join(" "), big: { label: "Sales", value: money(o.sales) }, vs, channels }
}
