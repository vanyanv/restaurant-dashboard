import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getStores, getStoreAnalytics } from "@/app/actions/store-actions"
import { DashboardContent } from "./components/dashboard-content"

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  
  if (!session) {
    redirect("/login")
  }

  // Fetch data server-side
  const [stores, analytics] = await Promise.all([
    getStores(),
    getStoreAnalytics()
  ])

  return (
    <DashboardContent 
      initialStores={stores}
      initialAnalytics={analytics}
      userRole={session.user.role}
    />
  )
}