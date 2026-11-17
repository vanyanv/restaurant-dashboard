import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getInventoryItemSectionPromises } from "@/lib/counter/adapters/inventory-item"
import { ItemClient } from "@/app/dashboard/(counter)/count/item/[id]/item-client"

export const dynamic = "force-dynamic"

/** Inventory — one item on a phone: the desk client in the phone shell. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ store?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/m/forbidden")
  const [{ id }, sp] = await Promise.all([params, searchParams])

  const sections = getInventoryItemSectionPromises({ accountId: session.user.accountId, ingredientId: id, storeId: sp.store })

  return (
    <>
      <ItemClient sections={sections} />
      <span hidden data-perf-ready="/m/count/item" />
    </>
  )
}
