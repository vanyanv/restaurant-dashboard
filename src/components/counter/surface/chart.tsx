"use client"

import { useState, type CSSProperties } from "react"
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  type BarShapeProps,
} from "recharts"
import { useChartDraw } from "@/components/counter/motion/use-chart-draw"
import { TABULAR, money, moneyCompact } from "@/lib/counter/format"

export interface ChartSeries {
  name: string
  data: (number | null)[]
  /**
   * A Tailwind band class from `bandClassFor` (e.g. "bg-ct-mx-2"). Only the
   * `ct-mx-N` token name is read out of it — see `colorVarFor` below — so the
   * class itself never has to be applied to any element.
   */
  bandClass?: string
}

export interface ChartProps {
  variant: "line" | "bar"
  labels: string[]
  series: ChartSeries[]
  /**
   * Applied as `aria-label` on both the `role="img"` picture and the
   * sr-only summary table (there is no `<caption>` element) — the same
   * accessible name for the chart and for the reachable text it stands in
   * for.
   */
  title: string
  height?: number
  /** Defaults to `money`, which already renders an em-dash for `null`. */
  formatValue?: (v: number | null) => string
  /** What every series in this chart is being judged against, appended to the accessible name. */
  comparisonLabel?: string
}

const DEFAULT_WIDTH = 640
const DEFAULT_HEIGHT = 240

/**
 * The ramp a chart actually uses for a channel's numbers (DESIGN.md "Data
 * bands"): separated by lightness, not hue, and fixed to the channel rather
 * than to its rank. Used, in order, for series that don't name their own
 * band via `bandClassFor`.
 */
const DEFAULT_BAND_VARS = ["--ct-mx-1", "--ct-mx-2", "--ct-mx-3", "--ct-mx-4"]

/**
 * Recharts colour props want a colour STRING, and `npm run tokens`'
 * `no-colour-literal` rule forbids writing one in this file (hex/oklch/rgb/
 * hsl literals are banned outside `counter.css`). The fix is not to invent a
 * colour here at all: `var(--ct-mx-N)` is a reference to a custom property
 * declared once in `counter.css`, not a literal, so the linter's substring
 * check (`#`, `oklch(`, `rgb(`, `hsl(`) never matches it — and the browser
 * resolves it against whichever theme (light/dark) is active on `:root` at
 * paint time, same as any other CSS consumer of these tokens.
 */
function colorVarFor(s: ChartSeries, index: number): string {
  const match = s.bandClass ? /ct-(mx-\d+)/.exec(s.bandClass) : null
  const varName = match ? `--ct-${match[1]}` : DEFAULT_BAND_VARS[index % DEFAULT_BAND_VARS.length]
  return `var(${varName})`
}

function toNumberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

/**
 * The primitive every Counter page draws data with.
 *
 * Per Plan 2's R3, `Section` is the sole renderer of `SectionData` — a
 * `Chart` takes plain `labels`/`series` and has no loading/empty/failed
 * branches of its own. Nest it inside a `Section` to get the six-state
 * contract.
 *
 * A single reading is not a chart (see the guard at the top of the body):
 * the prototype draws it as a label/value pair instead of a one-bar chart
 * that fills the panel edge to edge and says nothing.
 */
export function Chart({ variant, labels, series, title, height, formatValue, comparisonLabel }: ChartProps) {
  const format = formatValue ?? ((v: number | null) => money(v))
  // Axis ticks need something narrower than `format`: a value axis crowded
  // with full `$7,468`-style labels is illegible, which is exactly why
  // `moneyCompact` (`$7K`) exists. Honour a caller's own `formatValue` if
  // they supplied one — it may already be compact for its domain (e.g. a
  // percentage) — and only fall back to `moneyCompact` when they didn't.
  const axisTick = (v: number) =>
    formatValue ? formatValue(toNumberOrNull(v)) : moneyCompact(toNumberOrNull(v))
  const { animate, lineDurationMs, barStaggerMs } = useChartDraw()
  const ariaLabel = comparisonLabel ? `${title}, compared to ${comparisonLabel}` : title
  // Bar-only: which reading (by data index, not series) is under the
  // pointer. Shared across every series' `Bar` so hovering any of them dims
  // the rest of the plot at that reading, per the spike's dimming contract.
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  // The single-reading degradation runs BEFORE any Recharts path — see the
  // module doc comment. This is intentionally not a `SectionData` state:
  // it is a property of the data shape (`labels.length < 2`), not one of
  // the six section states, and Chart never branches on those (R3).
  if (labels.length < 2) {
    return (
      <div className="flex flex-col gap-2 rounded-ct bg-ct-surface p-3">
        <span className="font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3">
          {labels[0] ?? "—"}
        </span>
        {series.map((s) => (
          <div key={s.name} className="flex items-baseline justify-between gap-3">
            <span className="text-ct-body text-ct-ink-2">{s.name}</span>
            <span className={`text-ct-mid font-semibold text-ct-ink ${TABULAR}`}>
              {format(toNumberOrNull(s.data[0]))}
            </span>
          </div>
        ))}
      </div>
    )
  }

  const rows: Array<Record<string, string | number | null>> = labels.map((label, i) => {
    const row: Record<string, string | number | null> = { label }
    for (const s of series) row[s.name] = s.data[i] ?? null
    return row
  })

  return (
    <div className="flex flex-col gap-2">
      {/*
        `role="img"` makes this whole SVG subtree presentational: there is no
        keyboard path into Recharts' own tooltip/focus handling, and the
        sr-only table below (not the SVG) is what carries every reading to a
        screen reader or keyboard user instead. That's the trade-off, made
        deliberately, not an oversight to "fix" by turning on Recharts'
        `accessibilityLayer` — that prop sets `role="application"` and
        `tabIndex` on the SVG, which directly contradicts `role="img"` here.
        Enabling it without removing `role="img"` (or vice versa) leaves the
        chart in an inconsistent accessibility state.
      */}
      <div
        role="img"
        aria-label={ariaLabel}
        className="w-full"
        style={{ height: height ?? DEFAULT_HEIGHT }}
      >
        <ResponsiveContainer
          width="100%"
          height={height ?? DEFAULT_HEIGHT}
          // In a real browser, `ResizeObserver` measures the actual
          // container the moment it mounts and this value is immediately
          // superseded — real responsiveness, unaffected. In jsdom (no
          // `ResizeObserver`), Recharts never gets a measurement and falls
          // back to exactly this size, so the chart still renders
          // deterministically under test.
          initialDimension={{ width: DEFAULT_WIDTH, height: height ?? DEFAULT_HEIGHT }}
        >
          {variant === "line" ? (
            <LineChart data={rows}>
              <XAxis dataKey="label" stroke="var(--ct-line-strong)" tick={{ fill: "var(--ct-ink-3)" }} />
              <YAxis stroke="var(--ct-line-strong)" tick={{ fill: "var(--ct-ink-3)" }} tickFormatter={axisTick} />
              <Tooltip
                cursor={{ stroke: "var(--ct-line-strong)" }}
                formatter={(value: unknown) => format(toNumberOrNull(value))}
                contentStyle={{
                  background: "var(--ct-surface)",
                  border: "1px solid var(--ct-line-strong)",
                  borderRadius: "var(--radius-ct-sm)",
                }}
              />
              {series.map((s, i) => (
                <Line
                  key={s.name}
                  type="monotone"
                  dataKey={s.name}
                  name={s.name}
                  stroke={colorVarFor(s, i)}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={animate}
                  animationDuration={lineDurationMs}
                  // No `connectNulls`: `format.ts`'s em-dash rule says a
                  // missing value must never read as a measurement ("zero is
                  // a measurement and absence is not"). Drawing a straight
                  // segment across a null reading is the visual equivalent
                  // of that — a continuous line where there was a gap in the
                  // data. Let a gap read as a gap.
                />
              ))}
            </LineChart>
          ) : (
            <BarChart data={rows}>
              <XAxis dataKey="label" stroke="var(--ct-line-strong)" tick={{ fill: "var(--ct-ink-3)" }} />
              <YAxis stroke="var(--ct-line-strong)" tick={{ fill: "var(--ct-ink-3)" }} tickFormatter={axisTick} />
              <Tooltip
                cursor={{ fill: "var(--ct-accent-wash)" }}
                formatter={(value: unknown) => format(toNumberOrNull(value))}
                contentStyle={{
                  background: "var(--ct-surface)",
                  border: "1px solid var(--ct-line-strong)",
                  borderRadius: "var(--radius-ct-sm)",
                }}
              />
              {series.map((s, si) => (
                <Bar
                  key={s.name}
                  dataKey={s.name}
                  name={s.name}
                  isAnimationActive={false}
                  onMouseEnter={(_, index) => setHoverIndex(index)}
                  onMouseLeave={() => setHoverIndex(null)}
                  // Recharts animates a whole `Bar` series on one shared
                  // timer (`animationBegin`/`animationDuration` are read
                  // once per `<Bar>`, not per rect — see the spike). A
                  // per-item 26ms stagger needs a custom `shape` instead,
                  // driven by CSS keyframes (`ct-bar-grow` in counter.css)
                  // with a hand-computed `animation-delay`.
                  shape={(shapeProps: BarShapeProps) => {
                    const { x, y, width: w, height: h, fillOpacity } = shapeProps
                    // `Cell` always supplies `data-bar-index` (see the
                    // `Cell` map below) — it's the pre-filter data index,
                    // and it's the one index space this shape uses for
                    // everything derived from "which reading is this",
                    // `animationDelay` included, so the attribute and the
                    // stagger never disagree about which bar they mean.
                    const { "data-bar-index": barIndex } = shapeProps as BarShapeProps & {
                      "data-bar-index": number
                    }
                    // `height` goes negative whenever the reading falls below
                    // the baseline (`baseValue = 0` on a domain that
                    // straddles zero) — Recharts' own `Rectangle` draws a
                    // path, which tolerates that, but a raw `<rect>` treats
                    // a negative `height` as invalid SVG and simply doesn't
                    // render. Flip the top up to the lower edge and use the
                    // absolute extent so a below-baseline bar still paints.
                    const top = h < 0 ? y + h : y
                    const style: CSSProperties | undefined =
                      animate && barStaggerMs > 0
                        ? {
                            animationName: "ct-bar-grow",
                            animationDuration: "300ms",
                            animationTimingFunction: "var(--ct-ease)",
                            animationDelay: `${barIndex * barStaggerMs}ms`,
                            animationFillMode: "both",
                            // The grow animation should still start from the
                            // baseline, not from whichever edge `top` ended
                            // up being: for a below-baseline bar that's the
                            // rect's top (the baseline is its bottom).
                            transformOrigin: h < 0 ? "top" : "bottom",
                            transformBox: "fill-box",
                          }
                        : undefined
                    return (
                      <rect
                        className="recharts-rectangle"
                        data-bar-index={barIndex}
                        x={x}
                        y={top}
                        width={w}
                        height={Math.abs(h)}
                        fill={colorVarFor(s, si)}
                        fillOpacity={fillOpacity}
                        style={style}
                      />
                    )
                  }}
                >
                  {rows.map((_, i) => (
                    <Cell
                      key={i}
                      data-bar-index={i}
                      fillOpacity={hoverIndex === null || hoverIndex === i ? 1 : 0.42}
                    />
                  ))}
                </Bar>
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {/* Reachable without the picture: every reading, in reading order. */}
      <table aria-label={title} className="sr-only">
        <thead>
          <tr>
            <th>Date</th>
            {series.map((s) => (
              <th key={s.name}>{s.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            // Index, not `labels[i]`: labels repeat (repeated hours,
            // repeated channel names) and a duplicate key produces a React
            // warning. Row order is the data order, so the index is stable.
            <tr key={i}>
              <td>{labels[i]}</td>
              {series.map((s) => (
                <td key={s.name}>{format(toNumberOrNull(row[s.name]))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
