import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { parseDashboardRange } from "@/lib/dashboard-utils"
import { AnalyticsShell } from "./components/analytics-shell"

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string; days?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sp = await searchParams
  const range = parseDashboardRange(sp)

  return <AnalyticsShell range={range} userRole={session.user.role} />
}
