import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { parseDashboardRange } from "@/lib/dashboard-utils"
import { DashboardShell } from "./components/dashboard-shell"

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string; days?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sp = await searchParams
  const range = parseDashboardRange(sp)

  return <DashboardShell range={range} userRole={session.user.role} />
}
