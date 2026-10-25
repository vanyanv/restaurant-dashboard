import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getChecksTodaySectionPromises } from "@/lib/counter/adapters/checks"
import { ChecksTodayClient } from "./checks-today-client"

export const dynamic = "force-dynamic"

/** Store checks — Today: every store by its three checks, missed ones first. */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sections = getChecksTodaySectionPromises({ accountId: session.user.accountId })

  return (
    <>
      <ChecksTodayClient sections={sections} />
      <span hidden data-perf-ready="/dashboard/checks" />
    </>
  )
}
