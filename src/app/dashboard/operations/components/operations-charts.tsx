"use client"

import {
  Line,
  LineChart,
  Area,
  AreaChart,
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  Legend,
} from "@/components/charts/recharts"
import { EditorialChartTooltip } from "@/components/charts/editorial-chart-tooltip"
import { DashboardSection } from "@/components/analytics/dashboard-section"
import { formatCompact, formatCurrency } from "@/lib/format"
import type { OperationsData } from "@/types/operations"

const AXIS_TICK = { fontSize: 11, fill: "var(--ink-muted)" }
const AXIS_TICK_SM = { fontSize: 10, fill: "var(--ink-faint)" }

/** Chart subtree extracted from operations-content so recharts can be
 * lazy-loaded behind a dynamic({ ssr: false }) wrapper. The KPI cards +
 * page chrome paint immediately; the recharts chunk only fetches once
 * the user lands on /dashboard/operations and the chart sections render. */
export function OperationsCharts({ data }: { data: OperationsData }) {
  return (
    <>
      {data.weeklyBuckets.length > 1 && (
        <DashboardSection title="Spend vs Revenue (Weekly)">
          <div className="inv-panel">
            <div className="pt-2">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={data.weeklyBuckets}>
                  <CartesianGrid strokeDasharray="2 4" stroke="var(--chart-grid)" />
                  <XAxis dataKey="weekLabel" tick={AXIS_TICK} stroke="var(--hairline-bold)" />
                  <YAxis
                    tick={AXIS_TICK}
                    tickFormatter={(v) => formatCompact(v)}
                    stroke="var(--hairline-bold)"
                  />
                  <RechartsTooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null
                      const rev = payload.find((p) => p.dataKey === "totalRevenue")
                      const spend = payload.find((p) => p.dataKey === "totalSpending")
                      return (
                        <EditorialChartTooltip
                          active
                          caption={String(label)}
                          rows={[
                            ...(rev
                              ? [{ label: "Revenue", value: formatCurrency(Number(rev.value)), tone: "ink" as const }]
                              : []),
                            ...(spend
                              ? [{ label: "Spending", value: formatCurrency(Number(spend.value)), tone: "subtract" as const }]
                              : []),
                          ]}
                        />
                      )
                    }}
                  />
                  <Legend
                    formatter={(value) => (
                      <span
                        style={{
                          fontFamily: "var(--font-jetbrains-mono), monospace",
                          fontSize: 10,
                          letterSpacing: "0.16em",
                          textTransform: "uppercase",
                          color: "var(--ink-muted)",
                        }}
                      >
                        {value === "totalRevenue" ? "Revenue" : "Spending"}
                      </span>
                    )}
                    iconType="plainline"
                  />
                  <Line
                    type="monotone"
                    dataKey="totalRevenue"
                    stroke="var(--chart-ink)"
                    strokeWidth={1.75}
                    dot={false}
                    activeDot={{ r: 3, fill: "var(--chart-ink)" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="totalSpending"
                    stroke="var(--chart-subtract)"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={false}
                    activeDot={{ r: 3, fill: "var(--chart-subtract)" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </DashboardSection>
      )}

      {data.weeklyBuckets.length > 1 && (
        <DashboardSection title="Operational Metrics">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="inv-panel">
              <div className="inv-panel__head">
                <span className="inv-panel__dept">Cost per order (weekly)</span>
              </div>
              <div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={data.weeklyBuckets}>
                    <CartesianGrid strokeDasharray="2 4" stroke="var(--chart-grid)" />
                    <XAxis dataKey="weekLabel" tick={AXIS_TICK_SM} stroke="var(--hairline-bold)" />
                    <YAxis
                      tick={AXIS_TICK_SM}
                      tickFormatter={(v) => `$${v.toFixed(0)}`}
                      stroke="var(--hairline-bold)"
                    />
                    <RechartsTooltip
                      content={({ active, payload, label }) => (
                        <EditorialChartTooltip
                          active={active}
                          caption={String(label ?? "")}
                          rows={
                            payload?.length
                              ? [{
                                  label: "Cost / order",
                                  value: formatCurrency(Number(payload[0].value)),
                                  tone: "accent",
                                }]
                              : []
                          }
                        />
                      )}
                    />
                    <Line
                      type="monotone"
                      dataKey="costPerOrder"
                      stroke="var(--chart-accent)"
                      strokeWidth={1.75}
                      dot={false}
                      activeDot={{ r: 3, fill: "var(--chart-accent)" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="inv-panel">
              <div className="inv-panel__head">
                <span className="inv-panel__dept">Gross margin % (weekly)</span>
              </div>
              <div>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={data.weeklyBuckets}>
                    <defs>
                      <linearGradient id="marginGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--chart-ink)" stopOpacity={0.18} />
                        <stop offset="95%" stopColor="var(--chart-ink)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="2 4" stroke="var(--chart-grid)" />
                    <XAxis dataKey="weekLabel" tick={AXIS_TICK_SM} stroke="var(--hairline-bold)" />
                    <YAxis
                      tick={AXIS_TICK_SM}
                      tickFormatter={(v) => `${v}%`}
                      stroke="var(--hairline-bold)"
                    />
                    <RechartsTooltip
                      content={({ active, payload, label }) => (
                        <EditorialChartTooltip
                          active={active}
                          caption={String(label ?? "")}
                          rows={
                            payload?.length && payload[0].value != null
                              ? [{
                                  label: "Gross margin",
                                  value: `${Number(payload[0].value).toFixed(1)}%`,
                                  tone: "ink",
                                }]
                              : []
                          }
                        />
                      )}
                    />
                    <Area
                      type="monotone"
                      dataKey="grossMarginPct"
                      stroke="var(--chart-ink)"
                      fill="url(#marginGradient)"
                      strokeWidth={1.75}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </DashboardSection>
      )}

      {data.categoryBreakdown.length > 0 && (
        <DashboardSection title="Spending by Category">
          <div className="inv-panel">
            <div className="pt-2">
              <ResponsiveContainer
                width="100%"
                height={Math.max(200, data.categoryBreakdown.slice(0, 8).length * 40)}
              >
                <BarChart
                  data={data.categoryBreakdown.slice(0, 8)}
                  layout="vertical"
                  margin={{ left: 80 }}
                >
                  <CartesianGrid strokeDasharray="2 4" stroke="var(--chart-grid)" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={AXIS_TICK_SM}
                    tickFormatter={(v) => formatCompact(v)}
                    stroke="var(--hairline-bold)"
                  />
                  <YAxis
                    type="category"
                    dataKey="category"
                    tick={AXIS_TICK}
                    width={75}
                    stroke="var(--hairline-bold)"
                  />
                  <RechartsTooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const datum = payload[0].payload as {
                        category: string
                        totalSpend: number
                        percentOfTotal?: number
                      }
                      return (
                        <EditorialChartTooltip
                          active
                          caption={datum.category}
                          rows={[
                            {
                              label: "Spend",
                              value: formatCurrency(datum.totalSpend),
                              tone: "ink",
                            },
                            {
                              label: "Share",
                              value: `${(datum.percentOfTotal ?? 0).toFixed(1)}%`,
                              tone: "muted",
                            },
                          ]}
                        />
                      )
                    }}
                  />
                  <Bar dataKey="totalSpend" fill="var(--chart-ink)" radius={[0, 0, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </DashboardSection>
      )}
    </>
  )
}
