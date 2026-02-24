import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getMenuPerformanceAnalytics, getStores } from "@/app/actions/store-actions"
import { MenuPerformanceContent } from "./components/menu-performance-content"

export default async function MenuPerformancePage() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect("/login")
  }

  if (session.user.role !== "OWNER") {
    redirect("/dashboard")
  }

  const [data, stores] = await Promise.all([
    getMenuPerformanceAnalytics(undefined, { days: 7 }),
    getStores(),
  ])

  return (
    <MenuPerformanceContent
      initialData={data}
      stores={stores.map((s) => ({ id: s.id, name: s.name }))}
      userRole={session.user.role}
    />
  )
}
