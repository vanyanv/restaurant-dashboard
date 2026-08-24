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
import { TABULAR, money } from "@/lib/counter/format"

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
  /** Accessible name (`aria-label`/`role="img"`) and the hidden summary table's caption. */
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
              <YAxis stroke="var(--ct-line-strong)" tick={{ fill: "var(--ct-ink-3)" }} />
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
                  connectNulls
                />
              ))}
            </LineChart>
          ) : (
            <BarChart data={rows}>
              <XAxis dataKey="label" stroke="var(--ct-line-strong)" tick={{ fill: "var(--ct-ink-3)" }} />
              <YAxis stroke="var(--ct-line-strong)" tick={{ fill: "var(--ct-ink-3)" }} />
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
                    const { x, y, width: w, height: h, index, fillOpacity } = shapeProps
                    const barIndex = (shapeProps as unknown as Record<string, unknown>)["data-bar-index"] ?? index
                    const style: CSSProperties | undefined =
                      animate && barStaggerMs > 0
                        ? {
                            animationName: "ct-bar-grow",
                            animationDuration: "300ms",
                            animationTimingFunction: "var(--ct-ease)",
                            animationDelay: `${index * barStaggerMs}ms`,
                            animationFillMode: "both",
                            transformOrigin: "bottom",
                            transformBox: "fill-box",
                          }
                        : undefined
                    return (
                      <rect
                        className="recharts-rectangle"
                        data-bar-index={barIndex}
                        x={x}
                        y={y}
                        width={w}
                        height={h}
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
            <tr key={labels[i]}>
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
