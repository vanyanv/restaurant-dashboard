import { money } from "@/lib/counter/format"

/**
 * `.dayattr` — why the model called the day the number it called.
 *
 * `ForecastDailyRevenue.attribution` is a TreeSHAP waterfall written by
 * `ml/models/attribution.py`: `{ base, groups: [{ label, value }] }`, summing
 * to `predictedRevenue`, already collapsed from 43 features into the six
 * things that actually differ between one day and another. The drawer that
 * was meant to read it never existed, so every nightly since 2026-08-19 has
 * written an explanation nothing displays.
 *
 * ## Why a waterfall and not the prototype's `.attr` bar
 *
 * `.attr` (counter-components.css:397) is a label, a proportional bar and a
 * value — three columns, one direction. A SHAP decomposition is signed and
 * cumulative: "Day of week +$1,340, warm and dry +$420, school holiday −$160"
 * only means anything if each bar starts where the last one ended and the
 * final position IS the forecast. A bar chart of magnitudes drops both the
 * sign and the accumulation, which is most of the claim.
 *
 * So: one scale (`pxPerDollar`), every step starting at the previous step's
 * end, a dashed connector down from each end, and the axis at the right drawn
 * where the arithmetic actually lands. If the bars do not reach the FORECAST
 * axis, the parts do not sum to the total and the drawing is wrong — which is
 * the property a hand-placed bar chart cannot have.
 *
 * Server component: it is arithmetic and SVG, no state.
 */

export interface AttributionGroup {
  label: string
  value: number
}

export interface AttributionProps {
  /** TreeSHAP's bias term — what a day with no distinguishing features earns. */
  base: number
  /** Ordered by the writer, largest first. Rendered in that order. */
  groups: AttributionGroup[]
  /** The prediction the parts sum to. */
  total: number
}

/*
 * viewBox units, chosen to sit near 1:1 in the column this section actually
 * gets.
 *
 * The SVG is `width: 100%` on a fixed viewBox, so the whole drawing — type
 * included — scales with the container. At 640 units in the ~940px left
 * column of a full-width section that is a 1.47x blow-up: 12px labels
 * rendering at 18px, beside 13px body text. 940 units puts the drawing at
 * roughly its intended size on a desk and lets it shrink on the way down to
 * the 860px breakpoint, which is the direction that degrades gracefully.
 */
const W = 940
/** The label gutter ends here; the plot runs from it to `PLOT_X1`. */
const PLOT_X0 = 232
/** Short of `W` by enough for the widest value label to sit outside a bar. */
const PLOT_X1 = 726
const ROW_H = 30
const TOP = 22

export function Attribution({ base, groups, total }: AttributionProps) {
  /*
   * ONE SCALE, FITTED TO THE PATH THE ARITHMETIC ACTUALLY TAKES.
   *
   * An earlier version anchored BASE on the left and the total on the right
   * and derived dollars-per-pixel from `total - base`. That is only correct
   * when the day is forecast ABOVE its own base. On a quiet Tuesday — base
   * $12,276, forecast $10,146 — the span is negative, the scale inverts, and
   * every bar is drawn off the left edge of the drawing. It rendered as one
   * red bar sliding out of frame and a group label with nothing beside it.
   *
   * So the scale is fitted to the cumulative path instead: walk the steps,
   * take the extremes the running total ever reaches, and map THAT range onto
   * the plot. Both axes are then drawn where they land rather than where they
   * were assumed to be, which is what makes "the bars reach the FORECAST axis"
   * a real check on the arithmetic instead of a consequence of the layout.
   */
  const cumulative: number[] = [base]
  for (const g of groups) cumulative.push(cumulative[cumulative.length - 1] + g.value)
  const reached = cumulative[cumulative.length - 1]

  const points = [...cumulative, total]
  const lo = Math.min(...points)
  const hi = Math.max(...points)
  // A day whose groups all cancel has no range to map. Everything then lands
  // on one x, which is the honest drawing of "nothing moved it".
  const range = hi - lo || 1
  const x = (v: number) => PLOT_X0 + ((v - lo) / range) * (PLOT_X1 - PLOT_X0)

  const height = TOP + (groups.length + 1) * ROW_H + 42

  const label =
    `A base of ${money(base)}` +
    groups
      .map((g) => `, ${g.label} ${g.value >= 0 ? "adds" : "takes off"} ${money(Math.abs(g.value))}`)
      .join("") +
    `, reaching ${money(total)}.`

  const steps = groups.map((g, i) => {
    const from = x(cumulative[i])
    const to = x(cumulative[i + 1])
    return {
      ...g,
      y: TOP + (i + 1) * ROW_H,
      from,
      left: Math.min(from, to),
      width: Math.max(Math.abs(to - from), 2),
      up: g.value >= 0,
    }
  })

  const baseX = x(base)
  const totalX = x(reached)

  return (
    <svg
      className="wfall"
      viewBox={`0 0 ${W} ${height}`}
      width="100%"
      role="img"
      aria-label={label}
    >
      {/* The two axes: where a day starts, and where this one ended up. */}
      <line x1={baseX} y1={10} x2={baseX} y2={height - 32} className="wf-axis" />
      <text x={baseX} y={height - 18} className="wf-tick" textAnchor="middle">
        {money(base)}
      </text>
      <text x={baseX} y={height - 6} className="wf-cap" textAnchor="middle">
        BASE
      </text>
      <line x1={totalX} y1={10} x2={totalX} y2={height - 32} className="wf-axis is-total" />
      <text x={totalX} y={height - 18} className="wf-tick is-total" textAnchor="middle">
        {money(total)}
      </text>
      <text x={totalX} y={height - 6} className="wf-cap" textAnchor="middle">
        FORECAST
      </text>

      <g className="attrrow">
        <text x={0} y={TOP + 10} className="wf-lab">
          Typical day base
        </text>
        <circle cx={baseX} cy={TOP + 6} r={3.5} className="wf-dot" />
        <text x={baseX + 11} y={TOP + 10} className="wf-tick">
          {money(base)}
        </text>
      </g>

      {steps.map((s, i) => (
        <g key={`${s.label}-${i}`}>
          {/* Where the previous step ended — the reason this one starts here. */}
          <line
            x1={s.from}
            y1={s.y - ROW_H + 14}
            x2={s.from}
            y2={s.y}
            className="wf-link"
          />
          <g className="attrrow">
            <text x={0} y={s.y + 11} className="wf-lab">
              {s.label}
            </text>
            <rect
              x={s.left}
              y={s.y}
              width={s.width}
              height={14}
              rx={2}
              className={s.up ? "wf-bar is-up" : "wf-bar is-down"}
            />
            <text
              x={s.left + s.width + 8}
              y={s.y + 11}
              className={s.up ? "wf-val is-up" : "wf-val is-down"}
            >
              {s.up ? "+" : "\u2212"}
              {money(Math.abs(s.value))}
            </text>
          </g>
        </g>
      ))}

      {/* The landing. Drawn from the last step to the axis foot so the eye
          follows the arithmetic to where it stops. */}
      <line
        x1={totalX}
        y1={TOP + groups.length * ROW_H + 20}
        x2={totalX}
        y2={height - 32}
        className="wf-land"
      />
    </svg>
  )
}

/**
 * The right-hand column: how sure, and what to do about not being sure.
 *
 * The band is `ForecastDailyRevenue`'s conformal P10–P90 — CQR, calibrated
 * nightly, not a ±10% rule of thumb. It sits beside the waterfall rather than
 * under it because the two answer different questions about the same figure:
 * the waterfall is WHY, this is HOW MUCH TO TRUST IT.
 */
export function Sureness({
  band,
  children,
}: {
  band: string
  children: React.ReactNode
}) {
  return (
    <div className="attrside">
      <div className="k">How sure</div>
      <div className="band">{band}</div>
      <p>{children}</p>
    </div>
  )
}

/**
 * `.provenance` — which model, at what horizon, calibrated how.
 *
 * Not decoration. A forecast whose method is invisible is a number the owner
 * has to take on faith, and the three things that most change how much it
 * should be trusted — how far out it was made, whether the interval is
 * calibrated, whether the day was reconciled against its siblings — are
 * exactly the three that never reached the page.
 */
export function Provenance({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <div className="provenance">
      {items.map((i) => (
        <span key={i.label}>
          {i.label} <b>{i.value}</b>
        </span>
      ))}
    </div>
  )
}
