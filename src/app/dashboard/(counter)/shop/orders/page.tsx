import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getShopOrdersSectionPromises } from "@/lib/counter/adapters/shop"
import { ShopOrdersClient } from "./shop-orders-client"

export const dynamic = "force-dynamic"

/** Shop — Orders: every order by status, with one open beside the list. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; cursor?: string; order?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard/forbidden")
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
      <span hidden data-perf-ready="/dashboard/shop/orders" />
    </>
  )
}
