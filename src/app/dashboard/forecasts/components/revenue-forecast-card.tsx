"use client"

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { format } from "date-fns"
import type { RevenueForecastData } from "@/app/actions/forecasts/revenue-forecast-actions"
import { TransferSourceCaption } from "@/components/forecast/transfer-source-caption"

interface Props {
  data: RevenueForecastData
}

interface ChartRow {
  date: string
  predicted: number
  p10: number | null
  p90: number | null
  bandLow: number | null
  /** p90 − p10. Recharts stacks these so the band sits between p10 and p90. */
  bandSpan: number | null
}

function fmtUsd(n: number | null | undefined, max = 0) {
  if (n == null || !Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: max,
  })
}

function fmtPct(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—"
  return `${(n * 100).toFixed(1)}%`
}

export function RevenueForecastCard({ data }: Props) {
  if (data.days.length === 0) {
    return (
      <section className="inv-panel">
        <header className="inv-panel__head px-5 pt-4 pb-2 flex items-baseline justify-between">
          <span className="inv-panel__dept">Revenue forecast · 14 days</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            awaiting first run
          </span>
        </header>
        <div className="px-5 py-6 text-[var(--ink-muted)]">
          The nightly ML pipeline has not produced a forecast for {data.storeName} yet.
          Forecasts appear here the morning after the first successful run.
        </div>
      </section>
    )
  }

  const totalPredicted = data.days.reduce((sum, d) => sum + d.predictedRevenue, 0)
  const hasTransfer = data.days.some((d) => d.forecastSource === "transfer")
  const dayNumber = data.openedAt
    ? Math.max(
        1,
        Math.floor(
          (Date.now() - new Date(data.openedAt).getTime()) /
            (1000 * 60 * 60 * 24),
        ) + 1,
      )
    : 1
  const chartRows: ChartRow[] = data.days.map((d) => ({
    date: d.date.toISOString().slice(0, 10),
    predicted: d.predictedRevenue,
    p10: d.p10,
    p90: d.p90,
    bandLow: d.p10,
    bandSpan: d.p10 != null && d.p90 != null ? Math.max(0, d.p90 - d.p10) : null,
  }))

  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">Revenue forecast · 14 days</span>
        <div className="flex items-baseline gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          <span>
            run · {format(data.generatedAt!, "MMM d, HH:mm")}
          </span>
          <span>·</span>
          <span>
            mape · <span className="normal-case tracking-normal">{fmtPct(data.recentMape)}</span>
          </span>
        </div>
      </header>

      <div className="px-5 pb-2 flex items-baseline gap-6">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            Total predicted
          </div>
          <div
            className="text-[28px] tabular-nums text-[var(--ink)]"
            style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
          >
            {fmtUsd(totalPredicted)}
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            Daily avg
          </div>
          <div
            className="text-[16px] tabular-nums text-[var(--ink-muted)]"
            style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
          >
            {fmtUsd(totalPredicted / data.days.length)}
          </div>
        </div>
      </div>

      <div className="px-5 pb-5" style={{ aspectRatio: "3 / 1", minHeight: 240 }}>
        <ResponsiveContainer>
          <ComposedChart data={chartRows} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid stroke="var(--hairline)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => format(new Date(d), "M/d")}
              tickLine={false}
              axisLine={{ stroke: "var(--hairline-bold)" }}
              stroke="var(--ink-muted)"
              fontSize={11}
            />
            <YAxis
              tickFormatter={(v: number) =>
                v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`
              }
              tickLine={false}
              axisLine={{ stroke: "var(--hairline-bold)" }}
              stroke="var(--ink-muted)"
              fontSize={11}
            />
            <Tooltip
              cursor={{ stroke: "var(--accent)", strokeOpacity: 0.5 }}
              labelFormatter={(d: string) => format(new Date(d), "EEE, MMM d")}
              formatter={(v: number) => fmtUsd(v)}
              contentStyle={{
                background: "var(--paper)",
                border: "1px solid var(--hairline-bold)",
                borderRadius: "2px",
                fontFamily: "var(--font-dm-sans, sans-serif)",
                fontSize: 12,
              }}
            />
            <Area
              dataKey="bandLow"
              stackId="band"
              stroke="none"
              fill="transparent"
              isAnimationActive={false}
            />
            <Area
              dataKey="bandSpan"
              stackId="band"
              stroke="none"
              fill="var(--accent)"
              fillOpacity={0.08}
              isAnimationActive={false}
              name="80% prediction interval"
            />
            <Line
              type="monotone"
              dataKey="predicted"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={{ r: 2.5, fill: "var(--accent)" }}
              name="Predicted revenue"
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {hasTransfer && (
        <div className="px-5 pb-4">
          <TransferSourceCaption
            storeName={data.storeName}
            dayNumber={dayNumber}
          />
        </div>
      )}
    </section>
  )
}
