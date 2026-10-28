import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getShopCustomersSectionPromises } from "@/lib/counter/adapters/shop"
import { ShopCustomersClient } from "@/app/dashboard/(counter)/shop/customers/shop-customers-client"

export const dynamic = "force-dynamic"

/** Shop — Customers, on a phone (the desk client in the phone shell): everyone who has ordered, by email, with their orders. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; customer?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/m/forbidden")
  const sp = await searchParams

  const sections = getShopCustomersSectionPromises({
    accountId: session.user.accountId,
    query: sp.q,
    customerKey: sp.customer,
  })

  return (
    <>
      <ShopCustomersClient sections={sections} />
      <span hidden data-perf-ready="/m/shop/customers" />
    </>
  )
}
