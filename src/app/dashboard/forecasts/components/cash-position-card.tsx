"use client"

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { format } from "date-fns"
import type { CashPositionData } from "@/app/actions/forecasts/cash-position-actions"

interface Props {
  data: CashPositionData
}

function fmtUsd(n: number | null, max = 0) {
  if (n == null || !Number.isFinite(n)) return "—"
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: max,
  })
}

function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)}%`
}

export function CashPositionCard({ data }: Props) {
  if (data.days.length === 0) {
    return (
      <section className="inv-panel">
        <header className="inv-panel__head px-5 pt-4 pb-2 flex items-baseline justify-between">
          <span className="inv-panel__dept">Cash position · forward {data.horizonDays}d</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            awaiting forecast
          </span>
        </header>
      </section>
    )
  }

  const goingNegative = data.days.find((d) => d.cumulativeNet < 0)
  const chartData = data.days.map((d) => ({
    date: d.date.toISOString().slice(0, 10),
    cumulative: d.cumulativeNet,
    net: d.netCashFlow,
    inflow: d.estimatedNetInflow,
    outflow: d.scheduledPayables + d.proRatedFixedCosts,
  }))

  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">Cash position · forward {data.horizonDays}d</span>
        <div className="flex items-baseline gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          <span>commission · {fmtPct(data.blendedCommissionRate)}</span>
          <span>·</span>
          <span>fixed · {fmtUsd(data.proRatedFixedDaily)}/d</span>
        </div>
      </header>

      <div className="px-5 pb-2 grid grid-cols-3 gap-6">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            Net inflow
          </div>
          <div
            className="text-[24px] tabular-nums text-[var(--ink)]"
            style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
          >
            {fmtUsd(data.totalEstimatedInflow)}
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            Scheduled payables
          </div>
          <div
            className="text-[24px] tabular-nums text-[var(--ink)]"
            style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
          >
            {fmtUsd(data.totalScheduledPayables)}
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            Ending Δ cash
          </div>
          <div
            className={`text-[28px] tabular-nums ${
              data.endingCumulativeNet < 0 ? "text-[var(--accent)] font-semibold" : "text-[var(--ink)]"
            }`}
            style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
          >
            {fmtUsd(data.endingCumulativeNet)}
          </div>
        </div>
      </div>

      {goingNegative && (
        <div className="px-5 pb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
          warning · cumulative cash goes negative on{" "}
          <span className="normal-case tracking-normal">
            {format(goingNegative.date, "MMM d")}
          </span>
        </div>
      )}

      <div className="px-5 pb-5" style={{ aspectRatio: "3 / 1", minHeight: 200 }}>
        <ResponsiveContainer>
          <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
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
                Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`
              }
              tickLine={false}
              axisLine={{ stroke: "var(--hairline-bold)" }}
              stroke="var(--ink-muted)"
              fontSize={11}
            />
            <Tooltip
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
            <ReferenceLine y={0} stroke="var(--hairline-bold)" strokeDasharray="2 2" />
            <Line
              type="monotone"
              dataKey="cumulative"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={{ r: 2.5, fill: "var(--accent)" }}
              name="Cumulative Δ"
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
