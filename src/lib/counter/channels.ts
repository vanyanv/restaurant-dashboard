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

export interface Channel {
  id: ChannelId
  name: string
  /** The commission this marketplace takes on an order. In-house takes none. */
  commission: number
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
  { id: "house", name: "In-house", commission: 0, markClass: "text-ct-ch-house", bandClass: "bg-ct-mx-1", markVar: "var(--ch-house)", bandVar: "var(--mx-1)" },
  { id: "doordash", name: "DoorDash", commission: 0.25, markClass: "text-ct-ch-dd", bandClass: "bg-ct-mx-2", markVar: "var(--ch-dd)", bandVar: "var(--mx-2)" },
  { id: "ubereats", name: "Uber Eats", commission: 0.23, markClass: "text-ct-ch-ue", bandClass: "bg-ct-mx-3", markVar: "var(--ch-ue)", bandVar: "var(--mx-3)" },
  { id: "grubhub", name: "Grubhub", commission: 0.20, markClass: "text-ct-ch-gh", bandClass: "bg-ct-mx-4", markVar: "var(--ch-gh)", bandVar: "var(--mx-4)" },
] as const

export function channelById(id: ChannelId): Channel {
  const c = CHANNELS.find((x) => x.id === id)
  // Throwing rather than returning undefined: a missing channel is a
  // programming error, and a silent undefined would render a blank swatch.
  if (!c) throw new Error(`unknown channel: ${id}`)
  return c
}

export const commissionFor = (id: ChannelId): number => channelById(id).commission
export const bandClassFor = (id: ChannelId): string => channelById(id).bandClass
export const markClassFor = (id: ChannelId): string => channelById(id).markClass
export const markVarFor = (id: ChannelId): string => channelById(id).markVar
export const bandVarFor = (id: ChannelId): string => channelById(id).bandVar
