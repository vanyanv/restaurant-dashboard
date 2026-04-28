"use client"

import { useTransition, useState, useCallback } from "react"
import {
  Activity,
  DollarSign,
  TrendingUp,
  TrendingDown,
  ShoppingCart,
  BarChart3,
  Percent,
} from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EditorialTopbar } from "../../components/editorial-topbar"
import { DateRangePicker } from "@/components/analytics/date-range-picker"
import { DashboardSection } from "@/components/analytics/dashboard-section"
import { getOperationalAnalytics } from "@/app/actions/operational-actions"
import { formatCurrency, formatCompact, formatPct, formatNumber } from "@/lib/format"
import { formatDateRange } from "@/lib/dashboard-utils"
import { localDateStr } from "@/lib/dashboard-utils"
import type { OperationsData } from "@/types/operations"

interface OperationsContentProps {
  initialData: OperationsData | null
  stores: { id: string; name: string }[]
  userRole: string
}

const AXIS_TICK = { fontSize: 11, fill: "var(--ink-muted)" }
const AXIS_TICK_SM = { fontSize: 10, fill: "var(--ink-faint)" }

export function OperationsContent({
  initialData,
  stores,
}: OperationsContentProps) {
  const [data, setData] = useState(initialData)
  const [isPending, startTransition] = useTransition()
  const [days, setDays] = useState(30)
  const [customRange, setCustomRange] = useState<{
    startDate: string
    endDate: string
  } | null>(null)
  const [storeFilter, setStoreFilter] = useState<string>("all")

  const refetch = useCallback(
    (opts: { startDate?: string; endDate?: string; days?: number; storeId?: string }) => {
      const sid = (opts.storeId ?? storeFilter) === "all" ? undefined : (opts.storeId ?? storeFilter)
      startTransition(async () => {
        const result = await getOperationalAnalytics(sid, {
          startDate: opts.startDate,
          endDate: opts.endDate,
          days: opts.days,
        })
        if (result) setData(result)
      })
    },
    [storeFilter]
  )

  const handleRangeChange = useCallback(
    (startDate: string, endDate: string) => {
      const diffDays = Math.round(
        (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
      )

      let presetDays: number
      if (diffDays === 0) {
        const today = localDateStr(new Date())
        if (startDate === today) {
          presetDays = 1
        } else {
          const yday = new Date()
          yday.setDate(yday.getDate() - 1)
          presetDays = startDate === localDateStr(yday) ? -1 : diffDays
        }
      } else {
        presetDays = diffDays
      }

      const presets = [1, -1, 3, 7, 14, 30, 90]
      const matchedPreset = presets.find((p) => p === presetDays)

      if (matchedPreset) {
        setDays(matchedPreset)
        setCustomRange(null)
      } else {
        setCustomRange({ startDate, endDate })
      }

      refetch({ startDate, endDate })
    },
    [refetch]
  )

  const handleStoreChange = useCallback(
    (value: string) => {
      setStoreFilter(value)
      const sid = value === "all" ? undefined : value
      if (customRange) {
        refetch({ startDate: customRange.startDate, endDate: customRange.endDate, storeId: sid })
      } else {
        refetch({ days, storeId: sid })
      }
    },
    [customRange, days, refetch]
  )

  const comp = data?.comparison
  const hasData = data && data.weeklyBuckets.length > 0

  return (
    <div className="flex flex-col h-full">
      <EditorialTopbar
        section="§ 04"
        title="Operations"
        stamps={
          data?.dateRange ? (
            <span>
              {formatDateRange(data.dateRange.startDate, data.dateRange.endDate)}
            </span>
          ) : undefined
        }
      >
        {stores.length > 1 && (
          <Select value={storeFilter} onValueChange={handleStoreChange}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue placeholder="All Stores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stores</SelectItem>
              {stores.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DateRangePicker
          days={days}
          customRange={customRange}
          onRangeChange={handleRangeChange}
          isPending={isPending}
        />
      </EditorialTopbar>

      <div className={`flex-1 overflow-auto p-3 sm:p-4 space-y-6 ${isPending ? "opacity-60 pointer-events-none" : ""}`}>
        {!hasData && !isPending ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Activity className="h-10 w-10 mb-4" style={{ color: "var(--ink-faint)" }} />
            <h3
              className="font-display italic text-[22px] mb-1"
              style={{ color: "var(--ink)" }}
            >
              No operational data yet
            </h3>
            <p
              className="text-[13px] max-w-md"
              style={{ color: "var(--ink-muted)" }}
            >
              Sync your Otter data and import invoices to see cost-per-order, margins, and spending trends.
            </p>
          </div>
        ) : (
          <>
            {comp && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <KpiCard
                  emphasis="lede"
                  title="Cost / order"
                  value={formatCurrency(comp.current.costPerOrder)}
                  change={comp.costPerOrderChange}
                  invertColor
                  icon={<ShoppingCart className="h-4 w-4" />}
                />
                <KpiCard
                  title="Gross margin"
                  value={comp.current.grossMarginPct !== null ? `${comp.current.grossMarginPct.toFixed(1)}%` : "·"}
                  change={comp.grossMarginChange}
                  isAbsoluteChange
                  icon={<Percent className="h-4 w-4" />}
                />
                <KpiCard
                  title="Total spending"
                  value={formatCompact(comp.current.totalSpending)}
                  change={comp.spendingChange}
                  invertColor
                  icon={<DollarSign className="h-4 w-4" />}
                />
                <KpiCard
                  title="Total revenue"
                  value={formatCompact(comp.current.totalRevenue)}
                  change={comp.revenueChange}
                  icon={<BarChart3 className="h-4 w-4" />}
                />
                <KpiCard
                  title="Total orders"
                  value={formatNumber(comp.current.totalOrders)}
                  change={comp.ordersChange}
                  icon={<ShoppingCart className="h-4 w-4" />}
                />
              </div>
            )}

            {data && data.weeklyBuckets.length > 1 && (
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

            {data && data.weeklyBuckets.length > 1 && (
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

            {data && data.categoryBreakdown.length > 0 && (
              <DashboardSection title="Spending by Category">
                <div className="inv-panel">
                  <div className="pt-2">
                    <ResponsiveContainer width="100%" height={Math.max(200, data.categoryBreakdown.slice(0, 8).length * 40)}>
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
        )}
      </div>
    </div>
  )
}

function KpiCard({
  title,
  value,
  change,
  invertColor,
  isAbsoluteChange,
  icon,
  emphasis,
}: {
  title: string
  value: string
  change: number | null
  invertColor?: boolean
  isAbsoluteChange?: boolean
  icon: React.ReactNode
  emphasis?: "lede"
}) {
  const isPositive = change !== null && change > 0
  const isNegative = change !== null && change < 0
  const isGood = invertColor ? isNegative : isPositive
  const isBad = invertColor ? isPositive : isNegative
  const tone: "alert" | "down" | "up" = isBad ? "alert" : isGood ? "up" : "down"

  return (
    <div className="editorial-kpi" data-emphasis={emphasis}>
      <div className="flex items-center justify-between">
        <span className="editorial-kpi__label">{title}</span>
        <span style={{ color: "var(--ink-faint)" }}>{icon}</span>
      </div>
      <span className="editorial-kpi__value">{value}</span>
      {change !== null && (
        <span
          className="editorial-kpi__delta inline-flex items-center gap-1"
          data-tone={tone}
        >
          {isPositive ? (
            <TrendingUp className="h-3 w-3" aria-hidden />
          ) : isNegative ? (
            <TrendingDown className="h-3 w-3" aria-hidden />
          ) : null}
          <span>
            {isAbsoluteChange
              ? `${change > 0 ? "+" : ""}${change.toFixed(1)}pp`
              : formatPct(change)}
          </span>
          <span style={{ color: "var(--ink-faint)" }}>vs prev</span>
        </span>
      )}
    </div>
  )
}
