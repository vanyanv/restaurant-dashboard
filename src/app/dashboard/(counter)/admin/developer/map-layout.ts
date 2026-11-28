import type { DeveloperMapGroup } from "@/lib/counter/adapters/developer"

/**
 * Where everything on the connections map sits: the app in the middle, the
 * groups in two columns, one wire from the app to each group.
 *
 * Pure numbers, so the drawing (`developer-map.tsx`) holds no arithmetic and
 * a test can check that nothing overlaps or leaves the picture.
 */

export const MAP_W = 940
const BOX_W = 280
const ROW_H = 26
const HEAD_H = 34
const GAP = 18
export const HUB = { x: 385, w: 170, h: 96 }

export type Flow = "in" | "out" | "both"

export interface PlacedRow {
  /** Top of the row. */
  y: number
}

export interface PlacedGroup {
  group: DeveloperMapGroup
  side: "left" | "right"
  x: number
  y: number
  w: number
  h: number
  rows: PlacedRow[]
  /** The wire, drawn from the app out to the group. */
  wire: string
  /** Which way data runs on that wire, read from the group's connections. */
  flow: Flow
}

export interface MapLayout {
  w: number
  h: number
  /** Vertical middle, where the app sits. */
  cy: number
  groups: PlacedGroup[]
}

const heightOf = (g: DeveloperMapGroup) => HEAD_H + g.connections.length * ROW_H + 8

/** In when every connection only sends to the app, out when it only receives, both otherwise. */
export function flowOf(g: DeveloperMapGroup): Flow {
  const flows = new Set(g.connections.map((c) => c.flow))
  if (flows.size === 1) return [...flows][0]
  return "both"
}

/** The first half of the groups goes left, the rest right, each column centred. */
export function layoutMap(groups: DeveloperMapGroup[]): MapLayout {
  const split = Math.ceil(groups.length / 2)
  const columns: Array<["left" | "right", DeveloperMapGroup[]]> = [
    ["left", groups.slice(0, split)],
    ["right", groups.slice(split)],
  ]
  const columnH = (gs: DeveloperMapGroup[]) =>
    gs.reduce((sum, g) => sum + heightOf(g), 0) + GAP * Math.max(0, gs.length - 1)
  const h = Math.max(HUB.h, ...columns.map(([, gs]) => columnH(gs))) + 20
  const cy = h / 2

  const placed: PlacedGroup[] = []
  for (const [side, gs] of columns) {
    let y = (h - columnH(gs)) / 2
    const x = side === "left" ? 1 : MAP_W - BOX_W - 1
    for (const group of gs) {
      const gh = heightOf(group)
      const my = y + gh / 2
      // From the app's edge to the group's inner edge, leaving both level.
      const x1 = side === "left" ? HUB.x : HUB.x + HUB.w
      const x2 = side === "left" ? x + BOX_W : x
      const pull = side === "left" ? -55 : 55
      placed.push({
        group,
        side,
        x,
        y,
        w: BOX_W,
        h: gh,
        rows: group.connections.map((_, i) => ({ y: y + HEAD_H + i * ROW_H })),
        wire: `M${x1},${cy} C${x1 + pull},${cy} ${x2 - pull},${my} ${x2},${my}`,
        flow: flowOf(group),
      })
      y += gh + GAP
    }
  }
  return { w: MAP_W, h, cy, groups: placed }
}
