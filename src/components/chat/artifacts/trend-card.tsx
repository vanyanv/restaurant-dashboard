"use client"

import type { ReactNode } from "react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "@/components/charts/recharts"
import { CardShell, Num, fmtMoney } from "./card-shell"
import { buildTrendRows, trendTotal } from "@/lib/chat/trend-rows"
import { useChatDrawer } from "@/components/chat/chat-drawer-context"
import {
  axisTickStyle,
  editorialChart,
  tooltipContentStyle,
  tooltipLabelStyle,
} from "./editorial-chart"

export interface TrendPoint {
  /** X-axis label — date string, hour, month, etc. */
  label: string
  /** Primary numeric series (the chart line). */
  value: number
  /** Optional secondary cell rendered alongside in the table view. */
  secondary?: number
  secondaryLabel?: string
}

interface Props {
  dept: string
  caption: ReactNode
  subline?: ReactNode
  points: TrendPoint[]
  /** y-axis / table column header for the primary series. */
  valueLabel: string
  /** Format a value for the tooltip and table cell. */
  formatValue?: (n: number) => string
  footerHref?: string
  /** Index of the point the assistant's prose is calling out (typically the
   *  max value). The chart adds a red ReferenceDot at that point; the table
   *  highlights the matching row. */
  highlightedIndex?: number
  /** Foot the table with a total. Opt-in: a total is meaningful for a series
   *  that sums (sales, spend) and misleading for one that does not (average
   *  ticket, margin percent). */
  showTotal?: boolean
  /** Caption on the left of the card footer, e.g. "7 rows · complete". */
  footerNote?: ReactNode
}

/**
 * Trend artifact with a `Table │ Chart` toggle. Default view is the
 * hairline-ruled table — the editorial register's natural state. Clicking
 * the toggle swaps to a Recharts line chart styled with editorial tokens
 * (ink stroke, hairline grid, accent only on hover focus). User's
 * preference is remembered for the rest of the drawer session via the
 * chat-drawer context.
 */
export function TrendCard({
  dept,
  caption,
  subline,
  points,
  valueLabel,
  formatValue = fmtMoney,
  footerHref,
  highlightedIndex,
  showTotal,
  footerNote,
}: Props) {
  const highlight =
    highlightedIndex !== undefined &&
    highlightedIndex >= 0 &&
    highlightedIndex < points.length
      ? points[highlightedIndex]
      : null
  const { trendView, setTrendView } = useChatDrawer()

  const showSecondary = points.some((p) => p.secondary !== undefined)
  const rows = buildTrendRows(points)
  const secondaryHeader =
    points.find((p) => p.secondaryLabel)?.secondaryLabel ?? "Detail"

  return (
    <CardShell
      dept={dept}
      headline={caption}
      subline={subline}
      footerHref={footerHref}
      footerNote={footerNote}
      rightSlot={
        <span
          className="chat-artifact__view-toggle"
          role="group"
          aria-label="Trend view"
        >
          <button
            type="button"
            aria-pressed={trendView === "table"}
            className={
              "chat-artifact__view-toggle-btn" +
              (trendView === "table" ? " is-active" : "")
            }
            onClick={() => setTrendView("table")}
          >
            Table
          </button>
          <span className="chat-artifact__view-toggle-sep" aria-hidden>
            │
          </span>
          <button
            type="button"
            aria-pressed={trendView === "chart"}
            className={
              "chat-artifact__view-toggle-btn" +
              (trendView === "chart" ? " is-active" : "")
            }
            onClick={() => setTrendView("chart")}
          >
            Chart
          </button>
        </span>
      }
    >
      {trendView === "chart" ? (
        <div className="chat-artifact__chart">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart
              data={points}
              margin={{ top: 8, right: 12, bottom: 4, left: 0 }}
            >
              <CartesianGrid
                stroke={editorialChart.hairline}
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                stroke={editorialChart.hairline}
                tick={axisTickStyle}
                tickLine={false}
              />
              <YAxis
                stroke={editorialChart.hairline}
                tick={axisTickStyle}
                tickLine={false}
                tickFormatter={(v) =>
                  typeof v === "number" ? formatValue(v) : String(v)
                }
                width={70}
              />
              <Tooltip
                cursor={{
                  stroke: editorialChart.accent,
                  strokeDasharray: "2 2",
                }}
                contentStyle={tooltipContentStyle}
                labelStyle={tooltipLabelStyle}
                formatter={(v) =>
                  typeof v === "number" ? formatValue(v) : String(v)
                }
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={editorialChart.inkStroke}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: editorialChart.accent }}
                isAnimationActive={false}
                name={valueLabel}
              />
              {highlight ? (
                <ReferenceDot
                  x={highlight.label}
                  y={highlight.value}
                  r={5}
                  fill={editorialChart.accent}
                  stroke={editorialChart.paper}
                  strokeWidth={2}
                  isFront
                />
              ) : null}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="chat-artifact__table-wrap">
          <table className="chat-artifact__table chat-artifact__table--trend">
            <thead>
              <tr>
                <th>Label</th>
                {showSecondary ? (
                  <th className="num">{secondaryHeader}</th>
                ) : null}
                <th className="chat-artifact__bar-col" aria-hidden />
                <th className="num">{valueLabel}</th>
                {/* Previous row, not a prior period. The header says so. */}
                <th className="num">vs prev</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={i}
                  className={i === highlightedIndex ? "is-highlighted" : undefined}
                >
                  <td>{r.point.label}</td>
                  {showSecondary ? (
                    <td className="num">
                      <Num>
                        {r.point.secondary !== undefined
                          ? r.point.secondary.toLocaleString()
                          : "—"}
                      </Num>
                    </td>
                  ) : null}
                  <td className="chat-artifact__bar-col">
                    <span
                      className={`chat-artifact__bar chat-artifact__bar--${r.ramp}`}
                      style={{ width: `${Math.round(r.intensity * 100)}%` }}
                    />
                  </td>
                  <td className="num">
                    <Num>{formatValue(r.point.value)}</Num>
                  </td>
                  <td className="num">
                    {r.delta ? (
                      <Num>
                        <span
                          className={
                            r.delta.direction === "up"
                              ? "chat-artifact__delta chat-artifact__delta--up"
                              : r.delta.direction === "down"
                                ? "chat-artifact__delta chat-artifact__delta--down"
                                : "chat-artifact__delta"
                          }
                        >
                          {r.delta.text}
                        </span>
                      </Num>
                    ) : (
                      <span className="chat-artifact__delta">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {showTotal ? (
              <tfoot>
                <tr>
                  <td className="chat-artifact__tfoot-label">Total</td>
                  {showSecondary ? <td /> : null}
                  <td />
                  <td className="num">{formatValue(trendTotal(points))}</td>
                  <td />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}
    </CardShell>
  )
}
