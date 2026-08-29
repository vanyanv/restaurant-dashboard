import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getSettingsSectionPromises } from "@/lib/counter/adapters/settings"
import { CounterSettingsClient } from "./counter-settings-client"

export const dynamic = "force-dynamic"

/**
 * Settings — `P.settings`. One page, as the prototype has it; the editorial
 * build spread the same panels over four routes.
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
      <CounterSettingsClient sections={sections} />
      <span hidden data-perf-ready="/dashboard/settings" />
    </>
  )
}
