import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { 
  getStores, 
  getStoreAnalytics, 
  getRecentReports,
  getTodayReportStatus,
  getPerformanceAlerts
} from "@/app/actions/store-actions"
import { AnalyticsContent } from "./components/analytics-content"

export default async function AnalyticsPage() {
  const session = await getServerSession(authOptions)
  
  if (!session) {
    redirect("/login")
  }

  // Fetch comprehensive analytics data
  const [stores, analytics, recentReports, todayStatus, alerts] = await Promise.all([
    getStores(),
    getStoreAnalytics(),
    getRecentReports(undefined, 20),
    getTodayReportStatus(),
    getPerformanceAlerts()
  ])

  return (
    <AnalyticsContent 
      initialStores={stores}
      initialAnalytics={analytics}
      recentReports={recentReports}
      todayStatus={todayStatus}
      alerts={alerts}
      userRole={session.user.role}
    />
  )
}