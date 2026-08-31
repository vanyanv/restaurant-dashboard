import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getSettingsSectionPromises } from "@/lib/counter/adapters/settings"
import { CounterPhoneMoreClient } from "./counter-phone-more-client"

export const dynamic = "force-dynamic"

/**
 * More — `P.settings.phone()`, and the phone's fifth tab.
 *
 * The desk page at `/dashboard/settings` and this one are ONE page in the
 * design: `P.settings` has a `desk()` and a `phone()`, and the phone's is
 * shorter rather than different. So they share an adapter, and the figures a
 * reader sees here are the figures the desk computes — no second source.
 *
 * This replaces the editorial `/m/more`, which was a `PageHead`, four
 * `Panel`s and a "Profile, password, and notification preferences are edited
 * on desktop" note. The notification toggles work here now, which is what
 * that note was apologising for.
 */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sections = getSettingsSectionPromises({
    userId: session.user.id,
    accountId: session.user.accountId,
  })

  return (
    <>
      <CounterPhoneMoreClient
        name={session.user.name ?? "Operator"}
        email={session.user.email ?? ""}
        role={session.user.role}
        sections={sections}
      />
      <span hidden data-perf-ready="/m/more" />
    </>
  )
}
