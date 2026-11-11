import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getChecksTodaySectionPromises } from "@/lib/counter/adapters/checks"
import { ChecksTodayPhone } from "./checks-today-phone"

export const dynamic = "force-dynamic"

/** Store checks on a phone — Today: every store by its Morning and Night check, missed ones summed up first. Same adapter as the desk page, laid out for a phone. */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  // Photos and PINs are for owners only.
  if (!hasOwnerAccess(session.user.role)) redirect("/m/forbidden")

  const sections = getChecksTodaySectionPromises({ accountId: session.user.accountId })

  return (
    <>
      <ChecksTodayPhone sections={sections} />
      <span hidden data-perf-ready="/m/checks" />
    </>
  )
}
