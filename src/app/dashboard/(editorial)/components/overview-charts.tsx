"use client"

import { useState, useTransition } from "react"
import { cn } from "@/lib/utils"
import { getRevenueTrendData } from "@/app/actions/store-actions"
import type { DailyTrend } from "@/types/analytics"
import type { SplhPoint } from "@/lib/splh"

/**
 * Overview charts: flat, hairline-ruled, controls in the section head.
 *
 * Deliberately not `RevenueTrendChart` / `SplhChart`, which stay on their own
 * routes. Those carry their own bordered panel, inner title and toolbar, which
 * on this page sat directly under a section head saying the same thing — two
 * titles and two frames for one chart. Here the section head is the frame.
 */

const RANGES = [7, 14, 30, 90] as const

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

/** "2026-08-06" → "Aug 6". Parsed by field, never through `new Date`, which
 *  would shift the label a day for anyone west of UTC. */
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number)
  return `${MONTHS[(m ?? 1) - 1]} ${d ?? ""}`.trim()
}

function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1000) return `$${Math.round(n / 1000)}K`
  return `$${Math.round(n)}`
}

function SectionHead({
  label,
  children,
}: {
  label: string
  children?: React.ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-(--hairline) pb-3">
      <span className="editorial-section-label">{label}</span>
      <div className="h-px flex-1 border-t border-dotted border-[var(--hairline-bold)]" />
      {children}
    </div>
  )
}

function Toggle({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { key: string; label: string }[]
  value: string
  onChange: (k: string) => void
  disabled?: boolean
}) {
  return (
    <div className="flex border border-[var(--hairline-bold)] bg-white/55">
      {options.map((o, i) => (
        <button
          key={o.key}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.key)}
          aria-pressed={o.key === value}
          className={cn(
            "px-2 py-[3px] font-mono text-[9.5px] uppercase tracking-[0.14em] transition-colors",
            i > 0 && "border-l border-[var(--hairline)]",
            o.key === value
              ? "bg-(--accent-bg) text-(--accent)"
              : "text-(--ink-muted) hover:text-(--ink)",
            disabled && "opacity-60"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ── Revenue trend ───────────────────────────────────────────────────────── */

export function OverviewRevenueChart({ initial }: { initial: DailyTrend[] }) {
  const [days, setDays] = useState<number>(14)
  const [data, setData] = useState<DailyTrend[]>(initial)
  const [pending, startTransition] = useTransition()

  const pick = (key: string) => {
    const next = Number(key)
    if (next === days) return
    setDays(next)
    startTransition(async () => {
      const res = await getRevenueTrendData({ days: next })
      if (res?.dailyTrends) setData(res.dailyTrends)
    })
  }

  const W = 660
  const H = 248
  const L = 40
  const R = 650
  const TOP = 12
  const BASE = 196

  const max = Math.max(...data.map((d) => d.grossRevenue), 1)
  // Round the ceiling to a readable step so the four gridlines land on figures
  // an operator recognises rather than on 1/4 of an arbitrary maximum.
  const step = Math.pow(10, Math.floor(Math.log10(max / 4)))
  const ceil = Math.ceil(max / (step * 2)) * step * 2
  const y = (v: number) => BASE - (v / ceil) * (BASE - TOP)
  const x = (i: number) =>
    data.length < 2 ? L : L + (i * (R - L)) / (data.length - 1)

  const line = (pickV: (d: DailyTrend) => number) =>
    data.map((d, i) => `${Math.round(x(i))},${Math.round(y(pickV(d)) * 10) / 10}`).join(" ")

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * ceil)
  const labelAt = [0, Math.floor(data.length / 3), Math.floor((2 * data.length) / 3), data.length - 1]

  return (
    <div>
      <SectionHead label="Revenue trend">
        <Toggle
          options={RANGES.map((d) => ({ key: String(d), label: `${d}d` }))}
          value={String(days)}
          onChange={pick}
          disabled={pending}
        />
      </SectionHead>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        height={H}
        className={cn("block w-full transition-opacity", pending && "opacity-50")}
        role="img"
        aria-label={`Gross and net revenue over the last ${days} complete days.`}
      >
        {ticks.map((t, i) => (
          <g key={t}>
            <line
              x1={L}
              y1={y(t)}
              x2={R}
              y2={y(t)}
              stroke={i === 0 ? "var(--hairline-bold)" : "var(--hairline)"}
              strokeWidth="1"
              strokeDasharray={i === 0 ? undefined : "2 4"}
            />
            <text
              x={L - 6}
              y={y(t) + 4}
              textAnchor="end"
              fontSize="10"
              fill="var(--ink-faint)"
              className="font-mono"
            >
              {fmtCompact(t)}
            </text>
          </g>
        ))}

        {data.length > 1 && (
          <>
            <polyline
              points={line((d) => d.netRevenue)}
              fill="none"
              stroke="var(--ink-muted)"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              strokeLinejoin="round"
            />
            <polyline
              points={line((d) => d.grossRevenue)}
              fill="none"
              stroke="var(--ink)"
              strokeWidth="1.9"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <circle
              cx={x(data.length - 1)}
              cy={y(data[data.length - 1].grossRevenue)}
              r="3"
              fill="var(--ink)"
            />
          </>
        )}

        {labelAt
          .filter((i, k, arr) => i >= 0 && arr.indexOf(i) === k && data[i])
          .map((i) => (
            <text
              key={i}
              x={x(i)}
              y={216}
              textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
              fontSize="10"
              fill="var(--ink-faint)"
              className="font-mono"
            >
              {shortDate(data[i].date)}
            </text>
          ))}

        <rect x={L} y={232} width="9" height="2" fill="var(--ink)" />
        <text x={L + 15} y={237} fontSize="10" fill="var(--ink-muted)" className="font-mono">
          Gross
        </text>
        <rect x={L + 66} y={232} width="9" height="2" fill="var(--ink-muted)" />
        <text x={L + 81} y={237} fontSize="10" fill="var(--ink-muted)" className="font-mono">
          Net
        </text>
      </svg>
    </div>
  )
}

/* ── Sales per labor hour ────────────────────────────────────────────────── */

export function OverviewSplhChart({
  day,
  week,
}: {
  day: SplhPoint[]
  week: SplhPoint[]
}) {
  const [grain, setGrain] = useState<"day" | "week">("day")
  const points = (grain === "day" ? day : week).filter((p) => p.splh != null)

  const W = 420
  const H = 248
  const L = 36
  const R = 410
  const TOP = 12
  const BASE = 196

  const values = points.map((p) => p.splh!)
  const targets = points.map((p) => p.targetSplh ?? 0).filter((t) => t > 0)
  const max = Math.max(...values, ...targets, 1)
  const step = Math.pow(10, Math.floor(Math.log10(max / 4)))
  const ceil = Math.ceil(max / (step * 2)) * step * 2
  const y = (v: number) => BASE - (v / ceil) * (BASE - TOP)

  const slot = points.length > 0 ? (R - L) / points.length : R - L
  const barW = Math.max(6, Math.min(26, slot * 0.62))
  const bx = (i: number) => L + i * slot + (slot - barW) / 2

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * ceil)
  // Median target across the window: one line beats a per-bar staircase.
  const target =
    targets.length > 0
      ? [...targets].sort((a, b) => a - b)[Math.floor(targets.length / 2)]
      : null

  const over = points.filter((p) => (p.varianceDollars ?? 0) > 0)
  const overCost = over.reduce((a, p) => a + (p.varianceDollars ?? 0), 0)

  return (
    <div>
      <SectionHead label="Sales per labor hour">
        <Toggle
          options={[
            { key: "day", label: "Day" },
            { key: "week", label: "Week" },
          ]}
          value={grain}
          onChange={(k) => setGrain(k as "day" | "week")}
        />
      </SectionHead>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        height={H}
        className="block w-full"
        role="img"
        aria-label={`Sales per labor hour by ${grain}, against the trailing same-weekday target.`}
      >
        {ticks.map((t, i) => (
          <g key={t}>
            <line
              x1={L}
              y1={y(t)}
              x2={R}
              y2={y(t)}
              stroke={i === 0 ? "var(--hairline-bold)" : "var(--hairline)"}
              strokeWidth="1"
              strokeDasharray={i === 0 ? undefined : "2 4"}
            />
            <text
              x={L - 6}
              y={y(t) + 4}
              textAnchor="end"
              fontSize="10"
              fill="var(--ink-faint)"
              className="font-mono"
            >
              {fmtCompact(t)}
            </text>
          </g>
        ))}

        {points.map((p, i) => {
          // Over-target days carry the accent: that is the flagged state, and
          // the caption under the chart names the dollars behind it.
          const flagged = (p.varianceDollars ?? 0) > 0
          return (
            <rect
              key={p.date}
              x={bx(i)}
              y={y(p.splh!)}
              width={barW}
              height={Math.max(1, BASE - y(p.splh!))}
              // --subtract, not --accent: six over-target days in one chart
              // would spend the proofmark six times and dilute the single red
              // breach the masthead rail is allowed.
              fill={flagged ? "var(--subtract)" : "var(--ink)"}
              opacity={flagged ? 0.9 : 1}
            />
          )
        })}

        {target != null && (
          <>
            <line
              x1={L}
              y1={y(target)}
              x2={R}
              y2={y(target)}
              stroke="var(--subtract)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            {/* The label lives in the footer, not on the plot: at either end
                it collided with a bar, and there is no clear lane at this
                height. */}
          </>
        )}

        {points.length > 0 &&
          [0, Math.floor(points.length / 2), points.length - 1]
            .filter((i, k, arr) => arr.indexOf(i) === k && points[i])
            .map((i) => (
              <text
                key={points[i].date}
                x={bx(i) + barW / 2}
                y={216}
                textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
                fontSize="10"
                fill="var(--ink-faint)"
                className="font-mono"
              >
                {points[i].label}
              </text>
            ))}

        <text x={L} y={237} fontSize="10" fill="var(--ink-muted)" className="font-mono">
          {target != null ? `Target $${Math.round(target)}` : "No target yet"}
          {over.length > 0 ? " · " : ""}
          {over.length > 0 ? (
            <tspan fill="var(--subtract)">
              {over.length} {grain === "day" ? "days" : "weeks"} over · $
              {Math.round(overCost).toLocaleString()}
            </tspan>
          ) : null}
        </text>
      </svg>
    </div>
  )
}
