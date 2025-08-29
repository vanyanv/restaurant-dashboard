"use client"

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
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { 
  Store, 
  MapPin, 
  Phone, 
  ArrowLeft,
  CheckCircle,
  XCircle,
  BarChart3,
  Calendar
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { RevenueTrendChart } from "@/components/charts/revenue-trend-chart"
import { PrepCompletionChart } from "@/components/charts/prep-completion-chart"
import { ManagerPerformanceChart } from "@/components/charts/manager-performance-chart"
import { RecentReportsTable } from "@/components/analytics/recent-reports-table"

interface StoreAnalyticsContentProps {
  store: any
  allStores: any[]
  metrics: any
  recentReports: any[]
  userRole: string
}

export function StoreAnalyticsContent({ 
  store, 
  allStores, 
  metrics, 
  recentReports, 
  userRole 
}: StoreAnalyticsContentProps) {
  const router = useRouter()

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount)
  }

  const handleStoreChange = (newStoreId: string) => {
    if (newStoreId === "all") {
      router.push("/dashboard/analytics")
    } else {
      router.push(`/dashboard/analytics/${newStoreId}`)
    }
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
                <BreadcrumbLink href="/dashboard/analytics">Analytics</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{store.name}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        {/* Header with Store Selector */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard/analytics">
              <Button variant="outline" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Store className="h-4 w-4 text-muted-foreground" />
              <Select value={store.id} onValueChange={handleStoreChange}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" />
                      All Stores
                    </div>
                  </SelectItem>
                  {allStores.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <div className="flex items-center gap-2">
                        <Store className="h-4 w-4" />
                        {s.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-muted-foreground">
              <Calendar className="h-3 w-3 mr-1" />
              Last 30 days
            </Badge>
            <Link href={`/dashboard/store/${store.id}`}>
              <Button variant="outline">
                <Store className="mr-2 h-4 w-4" />
                Store Details
              </Button>
            </Link>
          </div>
        </div>

        {/* Store Information Header */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Store className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-2xl flex items-center gap-2">
                    {store.name}
                    <BarChart3 className="h-5 w-5 text-muted-foreground" />
                  </CardTitle>
                  <CardDescription className="flex items-center gap-4 mt-1">
                    {store.address && (
                      <div className="flex items-center gap-1">
                        <MapPin className="h-4 w-4" />
                        {store.address}
                      </div>
                    )}
                    {store.phone && (
                      <div className="flex items-center gap-1">
                        <Phone className="h-4 w-4" />
                        {store.phone}
                      </div>
                    )}
                  </CardDescription>
                </div>
              </div>
              <Badge variant={store.isActive ? "default" : "secondary"} className="text-sm">
                {store.isActive ? (
                  <>
                    <CheckCircle className="mr-1 h-3 w-3" />
                    Active
                  </>
                ) : (
                  <>
                    <XCircle className="mr-1 h-3 w-3" />
                    Inactive
                  </>
                )}
              </Badge>
            </div>
          </CardHeader>
        </Card>

        {/* Key Metrics Summary */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(metrics.summary.totalRevenue)}</div>
              <p className="text-xs text-muted-foreground">
                From {metrics.totalReports} reports
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Average Tips</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(metrics.summary.avgTips)}</div>
              <p className="text-xs text-muted-foreground">
                Per report average
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Prep Completion</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metrics.summary.avgPrepCompletion}%</div>
              <p className="text-xs text-muted-foreground">
                Average completion rate
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Reports Filed</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metrics.totalReports}</div>
              <p className="text-xs text-muted-foreground">
                Last 30 days
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Analytics Tabs */}
        <Tabs defaultValue="revenue" className="space-y-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="revenue">Revenue</TabsTrigger>
            <TabsTrigger value="prep">Prep Tasks</TabsTrigger>
            <TabsTrigger value="managers">Managers</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>
          
          <TabsContent value="revenue" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <RevenueTrendChart
                data={metrics.revenueTrends}
                title="Revenue Trends"
                description="Daily revenue over the last 30 days"
              />
              
              <Card>
                <CardHeader>
                  <CardTitle>Shift Performance</CardTitle>
                  <CardDescription>Morning vs Evening comparison</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">Morning Shift</div>
                        <div className="text-sm text-muted-foreground">
                          {metrics.shiftComparison.morning.count} reports
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold">
                          {formatCurrency(metrics.shiftComparison.morning.avgRevenue)}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {metrics.shiftComparison.morning.avgPrepCompletion}% prep
                        </div>
                      </div>
                    </div>
                    
                    <Separator />
                    
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">Evening Shift</div>
                        <div className="text-sm text-muted-foreground">
                          {metrics.shiftComparison.evening.count} reports
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold">
                          {formatCurrency(metrics.shiftComparison.evening.avgRevenue)}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {metrics.shiftComparison.evening.avgPrepCompletion}% prep
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="prep" className="space-y-4">
            <PrepCompletionChart
              data={metrics.prepCompletion}
              title="Prep Task Analysis"
              description="Completion rates for each prep task over the last 30 days"
            />
          </TabsContent>

          <TabsContent value="managers" className="space-y-4">
            <ManagerPerformanceChart
              data={metrics.managerStats}
              title="Manager Performance Comparison"
              description="Average prep completion by manager"
            />
          </TabsContent>

          <TabsContent value="reports" className="space-y-4">
            <RecentReportsTable 
              data={recentReports}
              title="Recent Reports"
              description={`All reports from ${store.name} in the last 30 days`}
              showStore={false}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}