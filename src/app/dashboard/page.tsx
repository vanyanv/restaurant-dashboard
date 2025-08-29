import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { 
  getStores, 
  getStoreAnalytics, 
  getRecentReports,
  getPerformanceAlerts
} from "@/app/actions/store-actions"
import { DashboardContent } from "./components/dashboard-content"

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  
  if (!session) {
    redirect("/login")
  }

  // Fetch data server-side
  const [stores, analytics, recentReports, alerts] = await Promise.all([
    getStores(),
    getStoreAnalytics(),
    getRecentReports(undefined, 5),
    getPerformanceAlerts()
  ])

  return (
    <DashboardContent 
      initialStores={stores}
      initialAnalytics={analytics}
      recentReports={recentReports}
      alerts={alerts}
      userRole={session.user.role}
    />
  )
}