import { getServerSession } from "next-auth"
import { redirect, notFound } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { 
  getStoreById, 
  getStoreMetrics, 
  getRecentReports,
  getStores
} from "@/app/actions/store-actions"
import { StoreAnalyticsContent } from "./components/store-analytics-content"

export default async function StoreAnalyticsPage(props: {
  params: Promise<{ storeId: string }>
}) {
  const params = await props.params
  const session = await getServerSession(authOptions)
  
  if (!session) {
    redirect("/login")
  }

  const { storeId } = params

  const [store, allStores, metrics, recentReports] = await Promise.all([
    getStoreById(storeId),
    getStores(),
    getStoreMetrics(storeId, 30),
    getRecentReports(storeId, 20)
  ])

  if (!store || !metrics) {
    notFound()
  }

  return (
    <StoreAnalyticsContent 
      store={store}
      allStores={allStores}
      metrics={metrics}
      recentReports={recentReports}
      userRole={session.user.role}
    />
  )
}