import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getDashboardAnalytics, getOtterAnalytics, getMenuCategoryAnalytics } from "@/app/actions/store-actions"
import { DashboardContent } from "./components/dashboard-content"

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect("/login")
  }

  const [data, otterData, menuData] = await Promise.all([
    getDashboardAnalytics({ days: 1 }),
    getOtterAnalytics(undefined, { days: 1 }),
    getMenuCategoryAnalytics(undefined, { days: 1 }),
  ])

  return <DashboardContent initialData={data} initialOtterData={otterData} initialMenuData={menuData} userRole={session.user.role} />
}
