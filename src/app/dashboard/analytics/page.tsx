import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getStoreAnalytics } from "@/app/actions/store-actions"
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Users, 
  Store,
  ChefHat 
} from "lucide-react"
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

export default async function AnalyticsPage() {
  const session = await getServerSession(authOptions)
  
  if (!session) {
    redirect("/login")
  }

  const analytics = await getStoreAnalytics()

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount)
  }

  const getTrendIcon = (growth: number) => {
    if (growth > 0) return <TrendingUp className="h-4 w-4 text-green-600" />
    if (growth < 0) return <TrendingDown className="h-4 w-4 text-red-600" />
    return null
  }

  const getTrendText = (growth: number) => {
    if (growth === 0) return "No change from last week"
    const direction = growth > 0 ? "+" : ""
    return `${direction}${growth.toFixed(1)}% from last week`
  }

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
                <BreadcrumbPage>Analytics</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analytics Dashboard</h1>
          <p className="text-muted-foreground">
            Track your restaurant performance and revenue metrics
          </p>
        </div>

        {analytics ? (
          <>
            {/* Key Metrics */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {/* Total Revenue */}
              <div className="rounded-xl border bg-card text-card-foreground shadow p-6">
                <div className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <h3 className="text-sm font-medium">Total Revenue</h3>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="text-2xl font-bold">
                  {formatCurrency(analytics.totalRevenue)}
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  {getTrendIcon(analytics.trends.revenueGrowth)}
                  {getTrendText(analytics.trends.revenueGrowth)}
                </p>
              </div>

              {/* Total Stores */}
              <div className="rounded-xl border bg-card text-card-foreground shadow p-6">
                <div className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <h3 className="text-sm font-medium">Active Stores</h3>
                  <Store className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="text-2xl font-bold">{analytics.storeCount}</div>
                <p className="text-xs text-muted-foreground">
                  Across all locations
                </p>
              </div>

              {/* Today's Reports */}
              <div className="rounded-xl border bg-card text-card-foreground shadow p-6">
                <div className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <h3 className="text-sm font-medium">Today's Reports</h3>
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="text-2xl font-bold">{analytics.todayReports}</div>
                <p className="text-xs text-muted-foreground">
                  {analytics.totalReports} total reports
                </p>
              </div>

              {/* Average Prep Completion */}
              <div className="rounded-xl border bg-card text-card-foreground shadow p-6">
                <div className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <h3 className="text-sm font-medium">Avg Prep Completion</h3>
                  <ChefHat className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="text-2xl font-bold">{analytics.avgPrepCompletion}%</div>
                <p className="text-xs text-muted-foreground">
                  Across all stores
                </p>
              </div>
            </div>

            {/* Revenue Breakdown */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border bg-card text-card-foreground shadow p-6">
                <h3 className="text-lg font-semibold mb-4">Weekly Revenue Comparison</h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Current Week</span>
                    <span className="font-medium">
                      {formatCurrency(analytics.trends.currentWeekRevenue)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Previous Week</span>
                    <span className="font-medium">
                      {formatCurrency(analytics.trends.previousWeekRevenue)}
                    </span>
                  </div>
                  <Separator />
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Growth</span>
                    <div className="flex items-center gap-1">
                      {getTrendIcon(analytics.trends.revenueGrowth)}
                      <span className={`font-medium ${
                        analytics.trends.revenueGrowth > 0 ? 'text-green-600' : 
                        analytics.trends.revenueGrowth < 0 ? 'text-red-600' : 
                        'text-muted-foreground'
                      }`}>
                        {analytics.trends.revenueGrowth > 0 ? '+' : ''}{analytics.trends.revenueGrowth.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border bg-card text-card-foreground shadow p-6">
                <h3 className="text-lg font-semibold mb-4">Performance Summary</h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Total Reports</span>
                    <span className="font-medium">{analytics.totalReports}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Average Tips</span>
                    <span className="font-medium">{analytics.averageTips.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Prep Completion</span>
                    <span className="font-medium">{analytics.avgPrepCompletion}%</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-xl border bg-card text-card-foreground shadow p-12">
            <div className="text-center">
              <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Analytics Data</h3>
              <p className="text-muted-foreground">
                Analytics will appear here once you have stores and reports.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}