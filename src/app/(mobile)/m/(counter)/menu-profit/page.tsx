import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getMenuProfitSectionPromises } from "@/lib/counter/adapters/menu-profit"
import { CounterPhoneMenuProfitClient } from "./counter-phone-menu-profit-client"

export const dynamic = "force-dynamic"

/**
 * Menu profit, on a phone — `P.menu.phone()`
 * (`docs/counter/counter-prototype.html:5507`).
 *
 * Calls `getMenuProfitSectionPromises`, the same function the desk page calls.
 * The two surfaces show different sections of it; neither derives a figure the
 * other does not have.
 */
export default async function MobileMenuProfitPage({
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

  const sections = getMenuProfitSectionPromises({
    range: counterParams.range,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
  })

  return (
    <>
      <CounterPhoneMenuProfitClient
        params={params.toString()}
        today={today}
        sections={sections}
      />
      <span hidden data-perf-ready="/m/menu-profit" />
    </>
  )
}
