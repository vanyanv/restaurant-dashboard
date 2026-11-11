import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getDraftOrderSectionPromises } from "@/lib/counter/adapters/draft-orders"
import { parseCoverDays } from "@/lib/counter/draft-orders"
import { OrdersClient } from "@/app/dashboard/(counter)/count/orders/orders-client"

export const dynamic = "force-dynamic"

/** Count & waste — Orders on a phone: the desk client, drawn in the phone shell. */
export default async function Page({ searchParams }: { searchParams: Promise<{ store?: string; cover?: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/m/forbidden")
  const sp = await searchParams

  const sections = getDraftOrderSectionPromises({ accountId: session.user.accountId, storeId: sp.store, coverDays: parseCoverDays(sp.cover) })

  return (
    <>
      <OrdersClient sections={sections} />
      <span hidden data-perf-ready="/m/count/orders" />
    </>
  )
}
