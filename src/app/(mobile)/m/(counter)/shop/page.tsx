import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getShopTodaySectionPromises } from "@/lib/counter/adapters/shop"
import { ShopTodayClient } from "@/app/dashboard/(counter)/shop/shop-today-client"

export const dynamic = "force-dynamic"

/** Shop — Today, on a phone (the desk client in the phone shell): what is waiting to ship, to bag or to be picked up, late ones first. */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  // Customer addresses and refunds are for owners only.
  if (!hasOwnerAccess(session.user.role)) redirect("/m/forbidden")

  const sections = getShopTodaySectionPromises({ accountId: session.user.accountId })

  return (
    <>
      <ShopTodayClient sections={sections} />
      <span hidden data-perf-ready="/m/shop" />
    </>
  )
}
