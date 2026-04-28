"use client"

import { TrendingUp, TrendingDown, Minus } from "lucide-react"
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "@/components/charts/recharts"
import { formatCompact, formatCurrency } from "@/lib/format"

interface Bucket {
  bucketStart: string
  bucketEnd: string
  label: string
  total: number
  invoiceCount: number
}

interface SpendTrendClientProps {
  buckets: Bucket[]
  granularity: "day" | "week" | "month"
  total: number
  invoiceCount: number
  avgPerBucket: number
  peakBucket: Bucket | null
  periodLabel: string
}

const GRANULARITY_WORD: Record<"day" | "week" | "month", string> = {
  day: "Day",
  week: "Week",
  month: "Month",
}

function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: Bucket }>
}) {
  if (!active || !payload?.length) return null
  const b = payload[0].payload
  return (
    <div
      style={{
        background: "var(--paper)",
        border: "1px solid var(--hairline-bold)",
        borderRadius: 2,
        padding: "8px 12px",
        boxShadow: "0 8px 22px -10px rgba(26,22,19,0.3)",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-jetbrains-mono), monospace",
          fontSize: 10,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
          margin: 0,
        }}
      >
        {b.label}
      </p>
      <p
        style={{
          fontFamily: "var(--font-dm-sans), sans-serif",
          fontWeight: 500,
          fontSize: 20,
          letterSpacing: "-0.02em",
          color: "var(--ink)",
          margin: "4px 0 0",
          fontVariantNumeric: "tabular-nums lining-nums",
          fontFeatureSettings: "\"tnum\", \"lnum\"",
        }}
      >
        {formatCurrency(b.total)}
      </p>
      <p
        style={{
          fontFamily: "var(--font-dm-sans), sans-serif",
          fontSize: 11,
          color: "var(--ink-muted)",
          margin: "2px 0 0",
          letterSpacing: "-0.005em",
        }}
      >
        {b.invoiceCount} {b.invoiceCount === 1 ? "invoice" : "invoices"}
      </p>
    </div>
  )
}

export function SpendTrendClient({
  buckets,
  granularity,
  total,
  invoiceCount,
  avgPerBucket,
  peakBucket,
  periodLabel,
}: SpendTrendClientProps) {
  const nonEmpty = buckets.filter((b) => b.total > 0)
  const first = nonEmpty[0]
  const last = nonEmpty[nonEmpty.length - 1]
  let trendDelta: number | null = null
  if (first && last && first !== last && first.total > 0) {
    trendDelta = ((last.total - first.total) / first.total) * 100
  }

  const TrendIcon =
    trendDelta == null
      ? Minus
      : trendDelta > 2
        ? TrendingUp
        : trendDelta < -2
          ? TrendingDown
          : Minus

  const peakStart = peakBucket?.bucketStart

  return (
    <section className="inv-panel">
      <div className="inv-hero">
        <div className="inv-hero__figure">
          <div>
            <span className="inv-hero__label">
              Total spend · {periodLabel}
            </span>
            <div className="inv-hero__amount">
              <span>{formatCurrency(total)}</span>
              {trendDelta != null ? (
                <em
                  style={{
                    color:
                      trendDelta > 2
                        ? "var(--accent)"
                        : trendDelta < -2
                          ? "#2f7a4e"
                          : "var(--ink-muted)",
                  }}
                >
                  <TrendIcon
                    size={10}
                    style={{ display: "inline", marginRight: 3 }}
                  />
                  {trendDelta > 0 ? "+" : ""}
                  {trendDelta.toFixed(0)}%
                </em>
              ) : null}
            </div>
          </div>

          <div className="inv-hero__meta">
            <div className="inv-hero__meta-row">
              <span className="inv-hero__meta-key">Invoices</span>
              <span className="inv-hero__meta-val">
                {invoiceCount.toLocaleString()}
              </span>
            </div>
            <div className="inv-hero__meta-row">
              <span className="inv-hero__meta-key">
                Avg / {GRANULARITY_WORD[granularity].toLowerCase()}
              </span>
              <span className="inv-hero__meta-val">
                {formatCompact(avgPerBucket)}
              </span>
            </div>
            <div className="inv-hero__meta-row">
              <span className="inv-hero__meta-key">Biggest</span>
              <span className="inv-hero__meta-val">
                {peakBucket
                  ? `${formatCompact(peakBucket.total)} · ${peakBucket.label}`
                  : "—"}
              </span>
            </div>
          </div>
        </div>

        <div className="inv-hero__chart">
          <div className="inv-hero__chart-caption">
            <span>
              Grouped by {GRANULARITY_WORD[granularity].toLowerCase()}
            </span>
            <em>The spending rhythm</em>
          </div>
          {buckets.length === 0 || total === 0 ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px dashed var(--hairline-bold)",
                borderRadius: 2,
                minHeight: 200,
                fontFamily: "var(--font-fraunces), serif",
                fontStyle: "italic",
                color: "var(--ink-muted)",
                fontSize: 15,
              }}
            >
              No spend in this period. Choose a wider range above.
            </div>
          ) : (
            <div className="chart-reveal">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={buckets}
                margin={{ top: 8, right: 4, left: -18, bottom: 0 }}
              >
                <XAxis
                  dataKey="label"
                  fontSize={10}
                  tickLine={false}
                  axisLine={{ stroke: "var(--hairline-bold)" }}
                  stroke="var(--ink-faint)"
                  interval="preserveStartEnd"
                  minTickGap={18}
                  tick={{
                    fill: "var(--ink-muted)",
                    fontFamily: "var(--font-jetbrains-mono), monospace",
                    letterSpacing: "0.08em",
                  }}
                />
                <YAxis
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) =>
                    v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`
                  }
                  width={44}
                  stroke="var(--ink-faint)"
                  tick={{
                    fill: "var(--ink-faint)",
                    fontFamily: "var(--font-jetbrains-mono), monospace",
                  }}
                />
                <RechartsTooltip
                  cursor={{ fill: "rgba(220,38,38,0.06)" }}
                  content={<TrendTooltip />}
                />
                <Bar
                  dataKey="total"
                  radius={[2, 2, 0, 0]}
                  maxBarSize={44}
                >
                  {buckets.map((b) => (
                    <Cell
                      key={b.bucketStart}
                      fill={
                        b.bucketStart === peakStart && b.total > 0
                          ? "var(--accent)"
                          : "var(--ink)"
                      }
                      fillOpacity={
                        b.bucketStart === peakStart
                          ? 0.95
                          : b.total === 0
                            ? 0.08
                            : 0.72
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
