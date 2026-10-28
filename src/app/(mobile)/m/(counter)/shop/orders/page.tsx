import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getShopOrdersSectionPromises } from "@/lib/counter/adapters/shop"
import { ShopOrdersClient } from "@/app/dashboard/(counter)/shop/orders/shop-orders-client"

export const dynamic = "force-dynamic"

/** Shop — Orders, on a phone (the desk client in the phone shell): every order by status, with one open beside the list. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; cursor?: string; order?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/m/forbidden")
  const sp = await searchParams

  const sections = getShopOrdersSectionPromises({
    accountId: session.user.accountId,
    filter: sp.filter,
    cursor: sp.cursor,
    orderId: sp.order,
  })

  return (
    <>
      <ShopOrdersClient sections={sections} />
      <span hidden data-perf-ready="/m/shop/orders" />
    </>
  )
}
