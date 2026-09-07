/**
 * Channels have two visual jobs and they must not be confused.
 *
 * IDENTITY — `markClassFor` returns the brand colour, for a small mark that
 * sits beside a text label. DoorDash red, Grubhub orange, and so on.
 *
 * DATA — `bandClassFor` returns a step on the `mx` ramp, which is separated by
 * LIGHTNESS, not hue. Notes 36 and 41: run the four brand hexes through a
 * colour-vision check and they clear only dE 8.5 as a set, so a stacked chart
 * drawn in brand colours is unreadable for a large minority of people. The mx
 * ramp clears dE 15 under all three CVD models.
 *
 * The band is fixed to the CHANNEL, not to its rank in the data. A range where
 * DoorDash outsells in-house must not repaint the chart.
 */

export type ChannelId = "house" | "doordash" | "ubereats" | "grubhub"

/**
 * What a raw Otter platform slug is CALLED on screen.
 *
 * HERE and not in `channel-mix.ts`, where `CHANNEL_FOR_PLATFORM` lives, for a
 * reason worth stating: that module opens with `import { prisma }`, and this
 * map is now read by `src/lib/chat/present.ts` to label a chart axis inside an
 * answer. A pure string map has no business dragging a database client behind
 * it. This file is the pure half of the channel vocabulary and already knows
 * every one of these four by id.
 *
 * There is exactly one of these because a slug has exactly one name. The
 * Orders page has printed them for months (it held the only copy); an answer's
 * bar chart would otherwise `titleCase` the slug and label a bar "Css-Pos".
 *
 * Not every slug is listed, deliberately: `chownow` and whatever Otter adds
 * next fall through to the slug itself — ugly and honest, rather than a
 * guessed name.
 */
export const PLATFORM_LABEL: Record<string, string> = {
  "css-pos": "In-house",
  "bnm-web": "Own web",
  doordash: "DoorDash",
  ubereats: "Uber Eats",
  grubhub: "Grubhub",
}

/** That name, or the slug when there is none for it. */
export function platformLabel(slug: string): string {
  return PLATFORM_LABEL[slug] ?? slug
}

export interface Channel {
  id: ChannelId
  name: string
  /** Brand colour utility — identity only, always beside a text label. */
  markClass: string
  /** mx ramp step — data only, fixed to this channel forever. */
  bandClass: string
  /**
   * The same two colours as the ported sheet's own custom properties.
   *
   * `counter-components.css` styles `.chip i` as `background: var(--pc)` and
   * reads the band steps as `var(--mx-N)`. A Tailwind utility cannot reach
   * either — `--pc` is set per element and `.chip i` is not ours to reclass —
   * so a component emitting the prototype's DOM needs the variable, not the
   * class. Same two decisions, one declaration: `markVar` and `markClass`
   * resolve to `--ct-ch-*`, `bandVar` and `bandClass` to `--ct-mx-*`.
   */
  markVar: string
  bandVar: string
}

export const CHANNELS: readonly Channel[] = [
  { id: "house", name: "In-house", markClass: "text-ct-ch-house", bandClass: "bg-ct-mx-1", markVar: "var(--ch-house)", bandVar: "var(--mx-1)" },
  { id: "doordash", name: "DoorDash", markClass: "text-ct-ch-dd", bandClass: "bg-ct-mx-2", markVar: "var(--ch-dd)", bandVar: "var(--mx-2)" },
  { id: "ubereats", name: "Uber Eats", markClass: "text-ct-ch-ue", bandClass: "bg-ct-mx-3", markVar: "var(--ch-ue)", bandVar: "var(--mx-3)" },
  { id: "grubhub", name: "Grubhub", markClass: "text-ct-ch-gh", bandClass: "bg-ct-mx-4", markVar: "var(--ch-gh)", bandVar: "var(--mx-4)" },
] as const

export function channelById(id: ChannelId): Channel {
  const c = CHANNELS.find((x) => x.id === id)
  // Throwing rather than returning undefined: a missing channel is a
  // programming error, and a silent undefined would render a blank swatch.
  if (!c) throw new Error(`unknown channel: ${id}`)
  return c
}

export const bandClassFor = (id: ChannelId): string => channelById(id).bandClass
export const markClassFor = (id: ChannelId): string => channelById(id).markClass
export const markVarFor = (id: ChannelId): string => channelById(id).markVar
export const bandVarFor = (id: ChannelId): string => channelById(id).bandVar
