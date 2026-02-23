"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  BarChart3,
  Store,
  Filter,
  Calendar,
  TrendingUp,
} from "lucide-react"
import Link from "next/link"
import { RevenueTrendChart } from "@/components/charts/revenue-trend-chart"
import { PlatformBreakdownChart } from "@/components/charts/platform-breakdown-chart"
import { PaymentSplitChart } from "@/components/charts/payment-split-chart"
import { TodayStatusGrid } from "@/components/analytics/today-status-grid"
import { RecentReportsTable } from "@/components/analytics/recent-reports-table"
import { OtterSyncButton } from "@/components/otter-sync-button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/format"
import type { StoreAnalyticsData } from "@/types/analytics"

interface AnalyticsContentProps {
  initialStores: any[]
  initialAnalytics: any
  recentReports: any[]
  todayStatus: any[]
  alerts: any[]
  userRole: string
  otterAnalytics: StoreAnalyticsData | null
}

export function AnalyticsContent({
  initialStores,
  initialAnalytics,
  recentReports,
  todayStatus,
  alerts,
  userRole,
  otterAnalytics,
}: AnalyticsContentProps) {
  const [selectedStore, setSelectedStore] = useState<string>("all")

  const filteredReports = selectedStore === "all"
    ? recentReports
    : recentReports.filter(report => report.storeId === selectedStore)

  const selectedStoreName = selectedStore === "all"
    ? "All Stores"
    : initialStores.find(store => store.id === selectedStore)?.name || "Unknown Store"

  // Derive display values from new StoreAnalyticsData shape
  const totalRevenue = otterAnalytics?.kpis.grossRevenue ?? initialAnalytics?.totalRevenue ?? 0
  const revenueGrowth = otterAnalytics?.comparison.grossGrowth ?? initialAnalytics?.trends?.revenueGrowth ?? 0
  const averageTips = otterAnalytics
    ? otterAnalytics.kpis.totalTips / Math.max(otterAnalytics.dayCount, 1)
    : initialAnalytics?.averageTips ?? 0
  const currentWeekRevenue = otterAnalytics?.comparison.currentGross ?? initialAnalytics?.trends?.currentWeekRevenue ?? 0
  const previousWeekRevenue = otterAnalytics?.comparison.previousGross ?? initialAnalytics?.trends?.previousWeekRevenue ?? 0

  return (
    <div>
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>Overview</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        {/* Header with Store Selector */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Analytics Dashboard</h1>
            <p className="text-muted-foreground text-sm">
              Comprehensive insights and metrics for {selectedStoreName.toLowerCase()}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <Store className="h-4 w-4 text-muted-foreground" />
              <Select value={selectedStore} onValueChange={setSelectedStore}>
                <SelectTrigger className="w-full sm:w-[200px]">
                  <SelectValue placeholder="Select store..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" />
                      All Stores
                    </div>
                  </SelectItem>
                  {initialStores.map((store) => (
                    <SelectItem key={store.id} value={store.id}>
                      <div className="flex items-center gap-2">
                        <Store className="h-4 w-4" />
                        {store.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <OtterSyncButton lastSyncAt={otterAnalytics?.lastSyncAt} />
            {selectedStore !== "all" && (
              <Link href={`/dashboard/store/${selectedStore}`}>
                <Button variant="outline" size="sm">
                  <Store className="mr-2 h-4 w-4" />
                  Store Details
                </Button>
              </Link>
            )}
          </div>
        </div>

        {/* Key Metrics Summary */}
        {initialAnalytics && (
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                  Total Revenue
                  {otterAnalytics && <Badge variant="secondary" className="text-[10px] px-1 py-0">POS</Badge>}
                </CardTitle>
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(totalRevenue)}
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" />
                  {revenueGrowth > 0 ? "+" : ""}
                  {revenueGrowth.toFixed(1)}% from prior period
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Today&apos;s Reports</CardTitle>
                <Calendar className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{initialAnalytics.todayReports}</div>
                <p className="text-xs text-muted-foreground">
                  Reports submitted today
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                  Average Tips
                  {otterAnalytics && <Badge variant="secondary" className="text-[10px] px-1 py-0">POS</Badge>}
                </CardTitle>
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(averageTips)}
                </div>
                <p className="text-xs text-muted-foreground">
                  Per day average
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Prep Completion</CardTitle>
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{initialAnalytics.avgPrepCompletion}%</div>
                <p className="text-xs text-muted-foreground">
                  Average completion rate
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* All Alerts */}
        {alerts && alerts.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Performance Alerts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {alerts.map((alert, index) => (
                  <Alert key={index} variant={alert.severity === "error" ? "destructive" : "default"}>
                    <AlertTitle>{alert.storeName}</AlertTitle>
                    <AlertDescription>
                      {alert.message}
                      {alert.manager && ` (${alert.manager})`}
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Analytics Tabs */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="revenue">Revenue</TabsTrigger>
            <TabsTrigger value="operations">Operations</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              {userRole === "OWNER" && todayStatus && todayStatus.length > 0 && (
                <TodayStatusGrid data={todayStatus} />
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    Period Revenue Comparison
                    {otterAnalytics && <Badge variant="secondary" className="text-[10px] px-1 py-0">POS</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Current Period</span>
                      <span className="text-lg font-bold">
                        {formatCurrency(currentWeekRevenue)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Prior Period</span>
                      <span className="text-lg font-bold">
                        {formatCurrency(previousWeekRevenue)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-t pt-2">
                      <span className="text-sm font-medium">Growth</span>
                      <span className={`text-lg font-bold ${revenueGrowth > 0 ? "text-green-600" : "text-red-600"}`}>
                        {revenueGrowth > 0 ? "+" : ""}
                        {revenueGrowth.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="revenue" className="space-y-4">
            <RevenueTrendChart />
            {otterAnalytics && (
              <div className="grid gap-4 md:grid-cols-2">
                <PlatformBreakdownChart data={otterAnalytics.platformBreakdown} />
                <PaymentSplitChart data={otterAnalytics.paymentSplit} />
              </div>
            )}
          </TabsContent>

          <TabsContent value="operations" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Operational Metrics</CardTitle>
                <CardDescription>Store operations and prep completion data</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-muted-foreground">
                  <BarChart3 className="h-8 w-8 mx-auto mb-2" />
                  <p>Operational charts will appear here when store-specific data is available</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reports" className="space-y-4">
            <RecentReportsTable
              data={filteredReports}
              title={selectedStore === "all" ? "All Recent Reports" : `Reports from ${selectedStoreName}`}
              description="Detailed view of recent daily reports"
              showStore={selectedStore === "all"}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
