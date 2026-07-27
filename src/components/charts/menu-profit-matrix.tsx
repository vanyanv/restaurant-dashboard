"use client"

// Menu-engineering scatter on the CORRECT axes: velocity (units sold) ×
// unit margin ($, revenue/qty − cogs/qty), median-split into the four
// Kasavana–Smith quadrants. Replaces the price-proxy Y axis of the legacy
// menu-engineering-matrix.tsx.
//
// Earn-the-Red: dots are ink; only the DOG corner label uses --subtract.
// Quadrant labels are HTML corner captions (JetBrains Mono, Color-Plus-Label)
// rather than four fill colors.

import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { EditorialChartTooltip } from "./editorial-chart-tooltip"
import type { MenuEngineeringRow } from "@/app/actions/forecasts/menu-engineering-actions"

interface MenuProfitMatrixProps {
  rows: MenuEngineeringRow[]
  medianVelocity: number
  medianUnitMargin: number
}

const CORNER_LABELS = [
  { text: "Puzzles — high margin, slow", pos: "left-12 top-2", tone: "var(--ink-muted)" },
  { text: "Stars — protect these", pos: "right-3 top-2", tone: "var(--ink-muted)" },
  { text: "Dogs — drop or rework", pos: "left-12 bottom-8", tone: "var(--subtract)" },
  { text: "Plowhorses — reprice or trim", pos: "right-3 bottom-8", tone: "var(--ink-muted)" },
] as const

export function MenuProfitMatrix({
  rows,
  medianVelocity,
  medianUnitMargin,
}: MenuProfitMatrixProps) {
  const data = rows.map((r) => ({
    ...r,
    x: r.soldQty,
    y: r.unitMargin,
  }))

  return (
    <div className="relative w-full" style={{ aspectRatio: "5 / 3", minHeight: 280 }}>
      {CORNER_LABELS.map((label) => (
        <span
          key={label.text}
          aria-hidden
          className={`pointer-events-none absolute z-10 font-mono text-[9.5px] uppercase tracking-[0.18em] opacity-70 ${label.pos}`}
          style={{ color: label.tone }}
        >
          {label.text}
        </span>
      ))}
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 16, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="var(--hairline)" strokeDasharray="0" />
          <XAxis
            type="number"
            dataKey="x"
            name="Units sold"
            tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
            axisLine={{ stroke: "var(--hairline-bold)" }}
            tickLine={false}
            label={{
              value: "units sold",
              position: "insideBottomRight",
              offset: -4,
              style: {
                fontFamily: "var(--font-jetbrains-mono), monospace",
                fontSize: 9.5,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                fill: "var(--ink-faint)",
              },
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="Unit margin"
            tickFormatter={(v: number) => `$${v.toFixed(0)}`}
            tick={{ fontSize: 11, fill: "var(--ink-muted)" }}
            axisLine={false}
            tickLine={false}
            width={48}
            label={{
              value: "margin / unit",
              angle: -90,
              position: "insideLeft",
              style: {
                fontFamily: "var(--font-jetbrains-mono), monospace",
                fontSize: 9.5,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                fill: "var(--ink-faint)",
              },
            }}
          />
          <ReferenceLine
            x={medianVelocity}
            stroke="var(--ink-muted)"
            strokeDasharray="4 4"
            strokeWidth={0.75}
          />
          <ReferenceLine
            y={medianUnitMargin}
            stroke="var(--ink-muted)"
            strokeDasharray="4 4"
            strokeWidth={0.75}
          />
          <Tooltip
            cursor={{ stroke: "var(--hairline-bold)", strokeDasharray: "2 2" }}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as
                | (MenuEngineeringRow & { x: number; y: number })
                | undefined
              if (!row) return null
              return (
                <EditorialChartTooltip
                  active={active}
                  caption={`${row.quadrant} · ${row.category}`}
                  rows={[
                    { label: row.itemName, value: "" },
                    { label: "Sold", value: row.soldQty.toLocaleString("en-US") },
                    {
                      label: "Margin / unit",
                      value: `$${row.unitMargin.toFixed(2)}`,
                      tone: row.unitMargin < 0 ? "subtract" : "ink",
                    },
                    {
                      label: "Contribution",
                      value: `$${row.totalContribution.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
                    },
                  ]}
                />
              )
            }}
          />
          <Scatter
            data={data}
            fill="var(--ink)"
            fillOpacity={0.75}
            isAnimationActive={false}
            shape={(props: { cx?: number; cy?: number }) => (
              <circle
                cx={props.cx}
                cy={props.cy}
                r={4}
                fill="var(--ink)"
                fillOpacity={0.7}
                stroke="var(--paper)"
                strokeWidth={1}
              />
            )}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}
