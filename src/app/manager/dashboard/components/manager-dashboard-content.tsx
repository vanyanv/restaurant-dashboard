"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { 
  Calendar, 
  Store, 
  TrendingUp, 
  ClipboardCheck,
  FileText,
  Clock,
  CheckCircle2,
  AlertCircle
} from "lucide-react"
import Link from "next/link"
import { format, startOfWeek, endOfWeek, subDays } from "date-fns"
import { StoreWithReports, ManagerDashboardStats, ManagerDashboardData } from "@/types/manager"

interface ManagerDashboardProps {
  managerId: string
}

export function ManagerDashboardContent({ managerId }: ManagerDashboardProps) {
  const [stores, setStores] = useState<StoreWithReports[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedStore, setSelectedStore] = useState<string | null>(null)
  const [weeklyStats, setWeeklyStats] = useState<ManagerDashboardStats>({
    totalReports: 0,
    avgPrepCompletion: 0,
    missedShifts: 0,
    expectedReports: 0
  })

  useEffect(() => {
    fetchDashboardData()
  }, [managerId])

  const fetchDashboardData = async () => {
    try {
      // Fetch assigned stores
      const storesResponse = await fetch("/api/manager/stores")
      const storesData = await storesResponse.json()

      // Fetch recent reports for each store
      const storesWithReports = await Promise.all(
        storesData.map(async (store: any) => {
          const reportsResponse = await fetch(`/api/reports?storeId=${store.id}&limit=7`)
          const reports = await reportsResponse.json()
          
          // Calculate completion rate
          const completionRate = reports.length > 0
            ? reports.reduce((acc: number, report: any) => {
                const prepCompletion = report.shift === "MORNING" 
                  ? report.morningPrepCompleted 
                  : report.eveningPrepCompleted
                return acc + (prepCompletion || 0)
              }, 0) / reports.length
            : 0

          const lastReport = reports[0]
          
          return {
            ...store,
            recentReports: reports,
            completionRate,
            lastReportDate: lastReport ? lastReport.date : null
          }
        })
      )

      setStores(storesWithReports)
      
      // Calculate weekly stats
      const allReports = storesWithReports.flatMap(s => s.recentReports)
      const weekStart = startOfWeek(new Date())
      const weeklyReports = allReports.filter((r: any) => 
        new Date(r.date) >= weekStart
      )

      setWeeklyStats({
        totalReports: weeklyReports.length,
        avgPrepCompletion: weeklyReports.length > 0
          ? weeklyReports.reduce((acc: number, r: any) => 
              acc + (r.morningPrepCompleted || r.eveningPrepCompleted || 0), 0
            ) / weeklyReports.length
          : 0,
        expectedReports: 14,
        missedShifts: 14 - weeklyReports.length // Assuming 2 shifts per day
      })

      if (storesWithReports.length > 0 && !selectedStore) {
        setSelectedStore(storesWithReports[0].id)
      }
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error)
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map(i => (
            <Card key={i}>
              <CardHeader className="space-y-2">
                <div className="h-4 bg-muted animate-pulse rounded" />
                <div className="h-8 bg-muted animate-pulse rounded" />
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  const currentStore = stores.find(s => s.id === selectedStore)

  return (
    <div className="space-y-6">
      {/* Quick Actions */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Quick Actions</h2>
        <Button asChild>
          <Link href="/manager/report">
            <FileText className="mr-2 h-4 w-4" />
            Submit Daily Report
          </Link>
        </Button>
      </div>

      {/* Stats Overview */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Weekly Reports
            </CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{weeklyStats.totalReports}</div>
            <p className="text-xs text-muted-foreground">
              {weeklyStats.missedShifts > 0 && `${weeklyStats.missedShifts} shifts pending`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Avg Prep Completion
            </CardTitle>
            <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {weeklyStats.avgPrepCompletion.toFixed(0)}%
            </div>
            <Progress value={weeklyStats.avgPrepCompletion} className="mt-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Assigned Stores
            </CardTitle>
            <Store className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stores.length}</div>
            <p className="text-xs text-muted-foreground">
              Active locations
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Store Details */}
      {stores.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Store Performance</CardTitle>
            <CardDescription>
              Track your performance across assigned stores
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={selectedStore || stores[0]?.id} onValueChange={setSelectedStore}>
              <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${stores.length}, 1fr)` }}>
                {stores.map(store => (
                  <TabsTrigger key={store.id} value={store.id}>
                    {store.name}
                  </TabsTrigger>
                ))}
              </TabsList>

              {stores.map(store => (
                <TabsContent key={store.id} value={store.id} className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Store Information</p>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">
                          {store.address || "No address provided"}
                        </p>
                        <p className="text-sm">
                          Last report: {store.lastReportDate 
                            ? format(new Date(store.lastReportDate), "MMM dd, yyyy")
                            : "No reports yet"}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-medium">Prep Completion Rate</p>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-2xl font-bold">
                            {store.completionRate.toFixed(0)}%
                          </span>
                          {store.completionRate >= 80 ? (
                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                          ) : (
                            <AlertCircle className="h-5 w-5 text-yellow-600" />
                          )}
                        </div>
                        <Progress value={store.completionRate} />
                      </div>
                    </div>
                  </div>

                  {/* Recent Reports */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Recent Reports</p>
                    <div className="space-y-2">
                      {store.recentReports.length > 0 ? (
                        store.recentReports.slice(0, 5).map((report: any) => (
                          <div key={report.id} className="flex items-center justify-between p-3 border rounded-lg">
                            <div className="flex items-center gap-3">
                              <Clock className="h-4 w-4 text-muted-foreground" />
                              <div>
                                <p className="text-sm font-medium">
                                  {format(new Date(report.date), "MMM dd, yyyy")}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {report.shift} shift
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-medium">
                                {report.shift === "MORNING" 
                                  ? report.morningPrepCompleted 
                                  : report.eveningPrepCompleted}%
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Prep completed
                              </p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground p-3 border rounded-lg">
                          No reports submitted yet
                        </p>
                      )}
                    </div>
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      )}

      {stores.length === 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-2">
              <Store className="h-12 w-12 mx-auto text-muted-foreground" />
              <p className="text-lg font-medium">No Stores Assigned</p>
              <p className="text-sm text-muted-foreground">
                Please contact your administrator to get assigned to a store.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}