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
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
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
      {/* Navigation Header */}
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Operations</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      {/* Sticky Header */}
      <div className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold tracking-tight">
                Operations Overview
              </h1>
            </div>
            {data?.dateRange && (
              <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-block w-1 h-1 rounded-full bg-muted-foreground/50" />
                <span>
                  {formatDateRange(data.dateRange.startDate, data.dateRange.endDate)}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {stores.length > 1 && (
              <Select value={storeFilter} onValueChange={handleStoreChange}>
                <SelectTrigger className="w-[160px] h-8 text-xs">
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
          </div>
        </div>

        {/* Mobile date info */}
        {data?.dateRange && (
          <div className="sm:hidden px-4 pb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {formatDateRange(data.dateRange.startDate, data.dateRange.endDate)}
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className={`flex-1 overflow-auto p-3 sm:p-4 space-y-6 ${isPending ? "opacity-60 pointer-events-none" : ""}`}>
        {!hasData && !isPending ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Activity className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-medium text-muted-foreground mb-1">No operational data yet</h3>
            <p className="text-sm text-muted-foreground/60 max-w-md">
              Sync your Otter data and import invoices to see cost-per-order, margins, and spending trends.
            </p>
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            {comp && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <KpiCard
                  title="Cost / Order"
                  value={formatCurrency(comp.current.costPerOrder)}
                  change={comp.costPerOrderChange}
                  invertColor
                  icon={<ShoppingCart className="h-4 w-4" />}
                  borderColor="hsl(0, 72%, 51%)"
                />
                <KpiCard
                  title="Gross Margin"
                  value={comp.current.grossMarginPct !== null ? `${comp.current.grossMarginPct.toFixed(1)}%` : "—"}
                  change={comp.grossMarginChange}
                  isAbsoluteChange
                  icon={<Percent className="h-4 w-4" />}
                  borderColor="hsl(142, 71%, 45%)"
                />
                <KpiCard
                  title="Total Spending"
                  value={formatCompact(comp.current.totalSpending)}
                  change={comp.spendingChange}
                  invertColor
                  icon={<DollarSign className="h-4 w-4" />}
                  borderColor="hsl(35, 85%, 45%)"
                />
                <KpiCard
                  title="Total Revenue"
                  value={formatCompact(comp.current.totalRevenue)}
                  change={comp.revenueChange}
                  icon={<BarChart3 className="h-4 w-4" />}
                  borderColor="hsl(221, 83%, 53%)"
                />
                <KpiCard
                  title="Total Orders"
                  value={formatNumber(comp.current.totalOrders)}
                  change={comp.ordersChange}
                  icon={<ShoppingCart className="h-4 w-4" />}
                  borderColor="hsl(262, 83%, 58%)"
                />
              </div>
            )}

            {/* Spend vs Revenue Chart */}
            {data && data.weeklyBuckets.length > 1 && (
              <DashboardSection title="Spend vs Revenue (Weekly)">
                <Card>
                  <CardContent className="pt-6">
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={data.weeklyBuckets}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis
                          dataKey="weekLabel"
                          tick={{ fontSize: 12 }}
                          className="text-muted-foreground"
                        />
                        <YAxis
                          tick={{ fontSize: 12 }}
                          tickFormatter={(v) => formatCompact(v)}
                          className="text-muted-foreground"
                        />
                        <RechartsTooltip
                          formatter={(value: number, name: string) => [
                            formatCurrency(value),
                            name === "totalRevenue" ? "Revenue" : "Spending",
                          ]}
                          contentStyle={{
                            backgroundColor: "hsl(var(--popover))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                            fontSize: "12px",
                          }}
                        />
                        <Legend
                          formatter={(value) =>
                            value === "totalRevenue" ? "Revenue" : "Spending"
                          }
                        />
                        <Line
                          type="monotone"
                          dataKey="totalRevenue"
                          stroke="hsl(221, 83%, 53%)"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="totalSpending"
                          stroke="hsl(35, 85%, 45%)"
                          strokeWidth={2}
                          strokeDasharray="5 5"
                          dot={{ r: 3 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </DashboardSection>
            )}

            {/* Cost per Order + Gross Margin side by side */}
            {data && data.weeklyBuckets.length > 1 && (
              <DashboardSection title="Operational Metrics">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Cost per Order */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        Cost per Order (Weekly)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={data.weeklyBuckets}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} />
                          <YAxis
                            tick={{ fontSize: 11 }}
                            tickFormatter={(v) => `$${v.toFixed(0)}`}
                          />
                          <RechartsTooltip
                            formatter={(value: number) => [formatCurrency(value), "Cost / Order"]}
                            contentStyle={{
                              backgroundColor: "hsl(var(--popover))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: "8px",
                              fontSize: "12px",
                            }}
                          />
                          <Line
                            type="monotone"
                            dataKey="costPerOrder"
                            stroke="hsl(0, 72%, 51%)"
                            strokeWidth={2}
                            dot={{ r: 3 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  {/* Gross Margin */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        Gross Margin % (Weekly)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={220}>
                        <AreaChart data={data.weeklyBuckets}>
                          <defs>
                            <linearGradient id="marginGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="weekLabel" tick={{ fontSize: 11 }} />
                          <YAxis
                            tick={{ fontSize: 11 }}
                            tickFormatter={(v) => `${v}%`}
                          />
                          <RechartsTooltip
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            formatter={(value: any) => [
                              value !== null ? `${Number(value).toFixed(1)}%` : "—",
                              "Gross Margin",
                            ]}
                            contentStyle={{
                              backgroundColor: "hsl(var(--popover))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: "8px",
                              fontSize: "12px",
                            }}
                          />
                          <Area
                            type="monotone"
                            dataKey="grossMarginPct"
                            stroke="hsl(142, 71%, 45%)"
                            fill="url(#marginGradient)"
                            strokeWidth={2}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </div>
              </DashboardSection>
            )}

            {/* Category Spending Breakdown */}
            {data && data.categoryBreakdown.length > 0 && (
              <DashboardSection title="Spending by Category">
                <Card>
                  <CardContent className="pt-6">
                    <ResponsiveContainer width="100%" height={Math.max(200, data.categoryBreakdown.slice(0, 8).length * 40)}>
                      <BarChart
                        data={data.categoryBreakdown.slice(0, 8)}
                        layout="vertical"
                        margin={{ left: 80 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                        <XAxis
                          type="number"
                          tick={{ fontSize: 11 }}
                          tickFormatter={(v) => formatCompact(v)}
                        />
                        <YAxis
                          type="category"
                          dataKey="category"
                          tick={{ fontSize: 12 }}
                          width={75}
                        />
                        <RechartsTooltip
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          formatter={(value: any, _name: any, props: any) => [
                            `${formatCurrency(Number(value))} (${props?.payload?.percentOfTotal?.toFixed(1) ?? 0}%)`,
                            "Spend",
                          ]}
                          contentStyle={{
                            backgroundColor: "hsl(var(--popover))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                            fontSize: "12px",
                          }}
                        />
                        <Bar
                          dataKey="totalSpend"
                          fill="hsl(221, 83%, 53%)"
                          radius={[0, 4, 4, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </DashboardSection>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── KPI Card Component ───

function KpiCard({
  title,
  value,
  change,
  invertColor,
  isAbsoluteChange,
  icon,
  borderColor,
}: {
  title: string
  value: string
  change: number | null
  invertColor?: boolean
  isAbsoluteChange?: boolean
  icon: React.ReactNode
  borderColor: string
}) {
  const isPositive = change !== null && change > 0
  const isNegative = change !== null && change < 0
  const isGood = invertColor ? isNegative : isPositive
  const isBad = invertColor ? isPositive : isNegative

  return (
    <Card className="relative overflow-hidden" style={{ borderTopColor: borderColor, borderTopWidth: "2px" }}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted-foreground">{title}</span>
          <span className="text-muted-foreground/50">{icon}</span>
        </div>
        <div className="text-xl font-bold tracking-tight">{value}</div>
        {change !== null && (
          <div className={`flex items-center gap-1 mt-1 text-xs font-medium ${isGood ? "text-emerald-600" : isBad ? "text-red-500" : "text-muted-foreground"}`}>
            {isPositive ? (
              <TrendingUp className="h-3 w-3" />
            ) : isNegative ? (
              <TrendingDown className="h-3 w-3" />
            ) : null}
            <span>
              {isAbsoluteChange
                ? `${change > 0 ? "+" : ""}${change.toFixed(1)}pp`
                : formatPct(change)}
            </span>
            <span className="text-muted-foreground/60">vs prev</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
