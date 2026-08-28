/**
 * Where a dot sits in the menu matrix, and where the two split lines go.
 *
 * The arithmetic only — `Matrix` is the DOM, the same split `chart-geometry.ts`
 * and `donut-geometry.ts` already keep. Nothing here is a colour: a quadrant
 * carries its own class (`.mdot.STAR`) and `counter-components.css` owns what
 * that looks like.
 *
 * ## The prototype's scales, and why ours cannot be them
 *
 * `P.menu.desk()` places a dot with `x = min(96, units / 660 * 100)` and
 * `y = (margin - 50) / 32 * 100`. Both constants are fixtures: 660 is its
 * busiest item and 50–82 is the margin range its invented menu happens to
 * span. A real menu that sold 900 of something would pile every other dot into
 * the left third, and one whose margins ran 20–95% would push half of them off
 * the plot entirely.
 *
 * So both axes are scaled to the DATA, with the split lines placed where the
 * medians actually fall rather than at a hardcoded 50%. That is the same
 * decision `service-profile.ts` made about the prototype's twelve-hour axis:
 * a fixture's bounds are not a scale.
 */

export type MenuQuadrant = "STAR" | "PLOWHORSE" | "PUZZLE" | "DOG"

export interface MatrixPoint {
  key: string
  label: string
  /** Units sold — the x axis. */
  units: number
  /** Margin percent — the y axis. */
  margin: number
  quadrant: MenuQuadrant
  /** The tooltip's own lines, pre-formatted by the adapter. */
  detail: string[]
}

export interface MatrixSpec {
  points: MatrixPoint[]
  /** The vertical split: the median units. */
  medianUnits: number
  /** The horizontal split: the median margin. */
  medianMargin: number
}

export interface PlacedPoint extends MatrixPoint {
  /** Percent from the left edge, 0–100. */
  left: number
  /** Percent from the BOTTOM edge, 0–100 — `.mdot` is positioned with `bottom`. */
  bottom: number
}

export interface MatrixPlacement {
  points: PlacedPoint[]
  /** Percent from the left where the vertical median line sits. */
  splitLeft: number
  /** Percent from the bottom where the horizontal median line sits. */
  splitBottom: number
  /** The axis's own end labels — the data's range, not a fixture's. */
  minUnits: number
  maxUnits: number
}

/**
 * Inset so a dot on either extreme is still a whole dot inside the frame.
 * `.mdot` is 11px wide and translated -50%, so a point at exactly 0% would
 * hang half of itself over the axis line.
 */
const PAD = 4

function place(value: number, min: number, max: number): number {
  if (!(max > min)) return 50
  const t = (value - min) / (max - min)
  return PAD + t * (100 - PAD * 2)
}

/**
 * Both axes span the data's own range, widened to include the median so a
 * split line is always drawn inside the plot.
 *
 * An empty set returns an empty placement rather than a NaN one — the same
 * hardening `chartScale` carries for a series that is entirely null.
 */
export function placeMatrix(spec: MatrixSpec): MatrixPlacement {
  const { points, medianUnits, medianMargin } = spec
  if (points.length === 0) {
    return {
      points: [],
      splitLeft: 50,
      splitBottom: 50,
      minUnits: 0,
      maxUnits: 0,
    }
  }

  const units = points.map((p) => p.units)
  const margins = points.map((p) => p.margin)
  const minU = Math.min(...units, medianUnits)
  const maxU = Math.max(...units, medianUnits)
  const minM = Math.min(...margins, medianMargin)
  const maxM = Math.max(...margins, medianMargin)

  return {
    points: points.map((p) => ({
      ...p,
      left: place(p.units, minU, maxU),
      bottom: place(p.margin, minM, maxM),
    })),
    splitLeft: place(medianUnits, minU, maxU),
    splitBottom: place(medianMargin, minM, maxM),
    minUnits: minU,
    maxUnits: maxU,
  }
}

/** The four quadrant names, in the corners the prototype writes them. */
export const QUADRANT_CORNERS = [
  { quadrant: "PUZZLE" as const, label: "Puzzles", corner: "top-left" as const },
  { quadrant: "STAR" as const, label: "Stars", corner: "top-right" as const },
  { quadrant: "DOG" as const, label: "Dogs", corner: "bottom-left" as const },
  { quadrant: "PLOWHORSE" as const, label: "Plowhorses", corner: "bottom-right" as const },
]
