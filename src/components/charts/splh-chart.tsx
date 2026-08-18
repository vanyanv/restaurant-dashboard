"use client"

import { useState } from "react"
import {
  Bar,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "@/components/charts/recharts"
import { EditorialChartTooltip } from "@/components/charts/editorial-chart-tooltip"
import type { SplhSeries } from "@/app/actions/splh-actions"
import type { SplhPoint } from "@/lib/splh"
import { cn } from "@/lib/utils"

interface SplhChartProps {
  day: SplhSeries[]
  week: SplhSeries[]
  className?: string
}

const usd0 = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n)

const hrs = (n: number) => `${n.toFixed(1)} h`

/**
 * Overstaffed is the only flagged state — red means "this day bought more
 * hours than the sales justified". A high SPLH is NOT a win worth colouring
 * green; it usually means the shift ran short-handed, so it stays neutral and
 * the tooltip explains it.
 */
function barFill(status: SplhPoint["status"]): string {
  if (status === "over") return "var(--accent)"
  if (status === "unknown") return "var(--hairline-bold)"
  return "var(--ink)"
}

function SplhTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: SplhPoint }> }) {
  const p = payload?.[0]?.payload
  if (!active || !p) return null

  type Row = { label: string; value: string; tone?: "ink" | "accent" | "subtract" | "muted" }
  const rows: Row[] = [
    { label: "Sales per labor hour", value: p.splh != null ? usd0(p.splh) : "—" },
    { label: "Target", value: p.targetSplh != null ? usd0(p.targetSplh) : "—", tone: "muted" },
    { label: "Net sales", value: usd0(p.netSales), tone: "muted" },
    { label: "Hours worked", value: hrs(p.laborHours), tone: "muted" },
  ]

  if (p.earnedHours != null) {
    rows.push({ label: "Hours earned", value: hrs(p.earnedHours), tone: "muted" })
  }
  if (p.varianceHours != null) {
    const over = p.varianceHours > 0
    rows.push({
      label: over ? "Over by" : "Under by",
      value: `${hrs(Math.abs(p.varianceHours))}${
        p.varianceDollars != null ? ` · ${usd0(Math.abs(p.varianceDollars))}` : ""
      }`,
      tone: over ? "accent" : "ink",
    })
  }

  const footnote =
    p.status === "over"
      ? "Overstaffed for the sales this day did."
      : p.status === "under"
        ? "Ran lean — check service times before celebrating."
        : p.status === "unknown"
          ? "No labor hours recorded for this day."
          : undefined

  return <EditorialChartTooltip active caption={p.label} rows={rows} footnote={footnote} />
}

export function SplhChart({ day, week, className }: SplhChartProps) {
  const [grain, setGrain] = useState<"day" | "week">("day")
  const [storeIdx, setStoreIdx] = useState(0)

  const series = grain === "day" ? day : week
  const active = series[storeIdx] ?? series[0]

  if (!active || active.points.length === 0) {
    return (
      <section className={cn("inv-panel inv-panel--empty", className)}>
        <header className="inv-panel__head inv-panel__head--no-rule">
          <span className="inv-panel__dept">Sales per labor hour</span>
        </header>
        <p className="py-8 text-sm">
          No labor hours recorded yet. SPLH appears once the Harri sync has
          written hours for a day with sales.
        </p>
      </section>
    )
  }

  // Count dollars ONLY from the flagged buckets. Summing every positive
  // variance would attribute the whole window's drift to the one red bar.
  const overPoints = active.points.filter((p) => p.status === "over")
  const flagged = overPoints.length
  const leaked = overPoints.reduce((sum, p) => sum + (p.varianceDollars ?? 0), 0)

  return (
    <section className={cn("inv-panel", className)}>
      <header className="inv-panel__head">
        <div className="flex flex-col gap-1">
          <span className="inv-panel__dept">
            {grain === "day" ? "Last 14 days" : "Last 12 weeks"}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
            {grain === "day" ? "vs same-weekday median" : "vs trailing 8-week median"}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {(["day", "week"] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGrain(g)}
              data-active={grain === g}
              className="toolbar-btn font-mono text-[10px] uppercase tracking-[0.18em]"
            >
              {g}
            </button>
          ))}
        </div>
      </header>

      {series.length > 1 ? (
        <div className="mb-3 flex flex-wrap items-center gap-0.5">
          {series.map((s, i) => (
            <button
              key={s.storeId}
              type="button"
              onClick={() => setStoreIdx(i)}
              data-active={i === storeIdx}
              className="toolbar-btn font-mono text-[10px] uppercase tracking-[0.16em]"
            >
              {s.storeName.replace(/^Chris N Eddys - /, "")}
            </button>
          ))}
        </div>
      ) : null}

      <div className="h-[220px] w-full md:h-[260px] lg:h-[290px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={active.points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              fontSize={10}
              // 12 week labels don't fit this column; every other one does.
              interval={grain === "week" ? 1 : "preserveStartEnd"}
              stroke="var(--ink-faint)"
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              width={40}
              fontSize={10}
              stroke="var(--ink-faint)"
              tickFormatter={(v: number) => `$${Math.round(v)}`}
            />
            <Tooltip cursor={false} content={<SplhTooltip />} />
            <Bar dataKey="splh" radius={[2, 2, 0, 0]} maxBarSize={26} isAnimationActive={false}>
              {active.points.map((p) => (
                <Cell key={p.date} fill={barFill(p.status)} />
              ))}
            </Bar>
            {/* Target rides per-bar because it is a weekday median, not one
                flat number — a flat rule would just redraw the volume curve. */}
            <Line
              type="stepAfter"
              dataKey="targetSplh"
              stroke="var(--ink-muted)"
              strokeWidth={1}
              strokeDasharray="3 3"
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <footer className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-(--hairline) pt-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
          {flagged > 0 ? (
            <>
              <span className="text-(--accent)">{flagged}</span>{" "}
              {grain === "day" ? "day" : "week"}
              {flagged === 1 ? "" : "s"} overstaffed
              {leaked > 0 ? ` · ${usd0(leaked)}` : ""}
            </>
          ) : (
            "All within 10% of target"
          )}
        </span>
        {active.daysMissingHours > 0 ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
            {active.daysMissingHours} day{active.daysMissingHours === 1 ? "" : "s"} missing hours
          </span>
        ) : null}
      </footer>
    </section>
  )
}
