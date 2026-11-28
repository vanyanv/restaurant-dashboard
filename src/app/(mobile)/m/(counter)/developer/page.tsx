import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getDeveloperSectionPromises } from "@/lib/counter/adapters/developer"
import { canSeeDeveloperPortal } from "@/lib/developer/platform-access"
import { CounterPhoneDeveloperClient } from "./counter-phone-developer-client"

export const dynamic = "force-dynamic"

/**
 * Developer portal on a phone. Developer only: the layout beside this file
 * is the gate, and the role is checked again here (a layout is not re-run on
 * every navigation between its pages).
 */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/m/login")
  if (session.user.role !== "DEVELOPER") redirect("/m/forbidden")
  // A developer of another account is turned away too: this page describes
  // the whole platform's wiring. See `platform-access.ts`.
  if (!canSeeDeveloperPortal(session)) redirect("/m/forbidden")

  const sections = getDeveloperSectionPromises({ accountId: session.user.accountId })

  return (
    <>
      <CounterPhoneDeveloperClient sections={sections} />
      <span hidden data-perf-ready="/m/developer" />
    </>
  )
}
