import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getMenuHubSectionPromises } from "@/lib/counter/adapters/menu-hub"
import { rangeLabel } from "@/lib/counter/date-range"
import { CounterPhoneMenuClient } from "./counter-phone-menu-client"

export const dynamic = "force-dynamic"

/**
 * The Menu hub, on a phone — `P.menuhub.phone()`
 * (`docs/counter/counter-prototype.html:7293`).
 *
 * Calls `getMenuHubSectionPromises`, the same function the desk calls: one
 * adapter is what stops the two surfaces printing two menus. There is no
 * `categories` section here — the prototype's phone composition is the strip
 * and the three destinations, and a six-slice ring with a legend is not a
 * reading at 340px.
 *
 * No owner gate, for the desk page's reason: the only money on this page is
 * one blended margin, and a reader who cannot see it can still use the item
 * counts, both mapping gaps and all three links.
 */
export default async function MobileMenuPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sp = await searchParams
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") params.set(key, value)
  }

  const today = new Date()
  const counterParams = readCounterParams(params, today)

  const sections = getMenuHubSectionPromises(
    {
      range: counterParams.range,
      storeId: counterParams.storeId,
      accountId: session.user.accountId,
    },
    rangeLabel(counterParams.range, counterParams.presetId),
  )

  return (
    <>
      <CounterPhoneMenuClient
        params={params.toString()}
        today={today}
        sections={sections}
      />
      <span hidden data-perf-ready="/m/menu" />
    </>
  )
}
