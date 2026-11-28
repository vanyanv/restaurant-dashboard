import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getDeveloperSectionPromises } from "@/lib/counter/adapters/developer"
import { canSeeDeveloperPortal } from "@/lib/developer/platform-access"
import { CounterDeveloperClient } from "./counter-developer-client"

export const dynamic = "force-dynamic"

/**
 * Developer portal: what the app is connected to, what it is built with,
 * where its keys are and how to set up a new computer.
 *
 * Developer only. `admin/layout.tsx` above this already turns everyone else
 * away; the role is checked again here so the page does not depend on where
 * it sits in the tree.
 */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (session.user.role !== "DEVELOPER") redirect("/dashboard/forbidden")
  // A developer of another account is turned away too: this page describes
  // the whole platform's wiring. See `platform-access.ts`.
  if (!canSeeDeveloperPortal(session)) redirect("/dashboard/forbidden")

  const sections = getDeveloperSectionPromises({ accountId: session.user.accountId })

  return (
    <>
      <CounterDeveloperClient sections={sections} />
      <span hidden data-perf-ready="/dashboard/admin/developer" />
    </>
  )
}
