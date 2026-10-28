import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getShopProductsSectionPromises } from "@/lib/counter/adapters/shop"
import { ShopProductsClient } from "@/app/dashboard/(counter)/shop/products/shop-products-client"

export const dynamic = "force-dynamic"

/** Shop — Products, on a phone (the desk client in the phone shell): what is for sale, its stock, and an editor for one. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string; product?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/m/forbidden")
  const sp = await searchParams

  const sections = getShopProductsSectionPromises({
    accountId: session.user.accountId,
    archived: sp.archived === "1",
    productId: sp.product,
  })

  return (
    <>
      <ShopProductsClient sections={sections} />
      <span hidden data-perf-ready="/m/shop/products" />
    </>
  )
}
