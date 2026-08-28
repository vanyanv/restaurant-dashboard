import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getInventorySectionPromises } from "@/lib/counter/adapters/inventory"
import { CounterPhoneInventoryClient } from "./counter-phone-inventory-client"

export const dynamic = "force-dynamic"

/**
 * Inventory, on a phone — `P.inventory.phone()`
 * (`docs/counter/counter-prototype.html:5762`).
 *
 * Calls `getInventorySectionPromises`, the same function the desk calls.
 */
export default async function MobileInventoryPage({
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

  const sections = getInventorySectionPromises({
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
    today,
  })

  return (
    <>
      <CounterPhoneInventoryClient sections={sections} />
      <span hidden data-perf-ready="/m/operations/inventory" />
    </>
  )
}
