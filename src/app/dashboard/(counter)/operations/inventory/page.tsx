import { permanentRedirect } from "next/navigation"
import { carryQuery } from "@/lib/counter/carry-query"

export const dynamic = "force-dynamic"

/**
 * `/dashboard/operations/inventory` — a redirect shim onto Inventory's Shelf.
 *
 * "Stock on hand" was a second rail item over the same counts as Inventory,
 * without the count list or the waste log, and with nothing to show on All
 * stores. It folded into `/dashboard/count/shelf`, which shows every store's
 * last finished count. `src/proxy.ts` redirects this path before render; this
 * page is the fallback if that map and the tree ever disagree. The past-counts
 * pages under it (`counts`, `counts/<id>`) still render, as Inventory's "Past
 * counts" tab.
 */
export default async function StockOnHandRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  permanentRedirect(`/dashboard/count/shelf${carryQuery(await searchParams)}`)
}
