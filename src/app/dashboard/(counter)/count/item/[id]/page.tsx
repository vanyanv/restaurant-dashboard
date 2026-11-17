import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getInventoryItemSectionPromises } from "@/lib/counter/adapters/inventory-item"
import { ItemClient } from "./item-client"

export const dynamic = "force-dynamic"

/**
 * Inventory — one item of the count list: its state, what was typed, how long
 * it lasts, what went missing since the last count, the same item at every
 * store and how it is ordered. Owners only.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ store?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard/forbidden")
  const [{ id }, sp] = await Promise.all([params, searchParams])

  const sections = getInventoryItemSectionPromises({ accountId: session.user.accountId, ingredientId: id, storeId: sp.store })

  return (
    <>
      <ItemClient sections={sections} />
      <span hidden data-perf-ready="/dashboard/count/item" />
    </>
  )
}
