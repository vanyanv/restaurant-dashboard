"use client"

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
import type { StaffingHour } from "@/app/actions/labor-productivity-actions"

/**
 * An hour earning less than this share of the day's own SPLH is flagged. It's
 * a relative test on purpose — an absolute dollar threshold would condemn every
 * hour at a slower store and flag nothing at a busy one.
 */
const UNDEREARNING_SHARE = 0.5

const usd0 = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)

const hourLabel = (h: number) => {
  if (h === 0) return "12a"
  if (h === 12) return "12p"
  return h < 12 ? `${h}a` : `${h - 12}p`
}

export function LaborStaffingCurve({
  hours,
  blendedRate,
}: {
  hours: StaffingHour[]
  blendedRate: number | null
}) {
  if (hours.length === 0) {
    return (
      <p className="labor-empty">
        No published schedule for this week. The staffing curve needs Harri
        shifts; cost and the day scorecard above do not.
      </p>
    )
  }

  const totalSales = hours.reduce((a, h) => a + h.netSales, 0)
  const totalStaffed = hours.reduce((a, h) => a + h.staffedHours, 0)
  const dayS = totalStaffed > 0 ? totalSales / totalStaffed : 0
  const floor = dayS * UNDEREARNING_SHARE

  const data = hours.map((h) => ({
    ...h,
    label: hourLabel(h.hour),
    flagged: h.staffedHours > 0.01 && (h.splh ?? 0) < floor,
  }))

  const flagged = data.filter((d) => d.flagged)
  const wastedHours = flagged.reduce((a, d) => a + d.staffedHours, 0)
  const wastedDollars = blendedRate != null ? wastedHours * blendedRate : null

  return (
    <>
      <div className="labor-curve">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              fontSize={10}
              stroke="var(--ink-faint)"
            />
            <YAxis
              yAxisId="hours"
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              width={34}
              fontSize={10}
              stroke="var(--ink-faint)"
              tickFormatter={(v: number) => `${Math.round(v)}h`}
            />
            <YAxis
              yAxisId="sales"
              orientation="right"
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              width={44}
              fontSize={10}
              stroke="var(--ink-faint)"
              tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`}
            />
            <Tooltip
              cursor={false}
              content={({ active, payload }) => {
                const d = payload?.[0]?.payload as (typeof data)[number] | undefined
                if (!active || !d) return null
                return (
                  <EditorialChartTooltip
                    active
                    caption={`${hourLabel(d.hour)} — ${hourLabel((d.hour + 1) % 24)}`}
                    rows={[
                      { label: "Staffed", value: `${d.staffedHours.toFixed(1)} h` },
                      { label: "Net sales", value: usd0(d.netSales), tone: "muted" },
                      { label: "Orders", value: String(d.orderCount), tone: "muted" },
                      {
                        label: "Sales per hour",
                        value: d.splh != null ? usd0(d.splh) : "—",
                        tone: d.flagged ? "accent" : "ink",
                      },
                    ]}
                    footnote={
                      d.flagged
                        ? `Under ${usd0(floor)}/h — less than half what the day averages.`
                        : undefined
                    }
                  />
                )
              }}
            />
            <Bar yAxisId="hours" dataKey="staffedHours" radius={[2, 2, 0, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.hour} fill={d.flagged ? "var(--accent)" : "var(--ink)"} />
              ))}
            </Bar>
            {/* Sales ride above the bars as the demand they were staffed for. */}
            <Line
              yAxisId="sales"
              type="monotone"
              dataKey="netSales"
              stroke="var(--ink-muted)"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="labor-curve__note">
        {flagged.length === 0 ? (
          <>Every staffed hour earned at least {usd0(floor)}/h this week.</>
        ) : (
          <>
            <strong className="labor-curve__flag">
              {flagged.map((d) => hourLabel(d.hour)).join(", ")}
            </strong>{" "}
            carried {wastedHours.toFixed(1)} staffed hours
            {wastedDollars != null ? ` (${usd0(wastedDollars)})` : ""} while earning
            under {usd0(floor)}/h — the week averaged {usd0(dayS)}/h.
          </>
        )}
      </p>
    </>
  )
}
