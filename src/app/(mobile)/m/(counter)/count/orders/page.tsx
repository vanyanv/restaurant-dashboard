import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getDraftOrderSectionPromises } from "@/lib/counter/adapters/draft-orders"
import { getInventorySwitcherSectionPromises } from "@/lib/counter/adapters/inventory-shelf"
import { parseCoverDays } from "@/lib/counter/draft-orders"
import { OrdersClient } from "@/app/dashboard/(counter)/count/orders/orders-client"

export const dynamic = "force-dynamic"

/** Count & waste — Restock on a phone: the desk client, drawn in the phone shell. */
export default async function Page({ searchParams }: { searchParams: Promise<{ store?: string; cover?: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/m/forbidden")
  const sp = await searchParams

  // The switcher counts "N to order" from the draft at the cover shown here,
  // so the cell for this store and the draft under it are the same build.
  const coverDays = parseCoverDays(sp.cover)
  const sections = {
    ...getDraftOrderSectionPromises({ accountId: session.user.accountId, storeId: sp.store, coverDays }),
    ...getInventorySwitcherSectionPromises({ accountId: session.user.accountId, coverDays }),
  }

  return (
    <>
      <OrdersClient sections={sections} />
      <span hidden data-perf-ready="/m/count/orders" />
    </>
  )
}
