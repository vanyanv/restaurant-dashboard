import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { parseRangeWithDefault } from "@/lib/dashboard-utils"
import { AnalyticsShell } from "./components/analytics-shell"

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string; days?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sp = await searchParams
  // Pinned to today rather than following Overview's new yesterday default:
  // Analytics is the "what is happening right now" surface and its cards are
  // built to read a day in progress. Overview is the settled daily report.
  const range = parseRangeWithDefault(sp, 1)

  return <AnalyticsShell range={range} userRole={session.user.role} />
}
