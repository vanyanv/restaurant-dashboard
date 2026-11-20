import { permanentRedirect } from "next/navigation"
import { carryQuery } from "@/lib/counter/carry-query"

export const dynamic = "force-dynamic"

/**
 * `/m/operations/inventory` — a redirect shim onto the phone's Inventory
 * Shelf. "Stock on hand" folded into Inventory; see the desk shim at
 * `src/app/dashboard/(counter)/operations/inventory/page.tsx`. `src/proxy.ts`
 * redirects it before render; this is the fallback.
 */
export default async function MobileStockOnHandRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  permanentRedirect(`/m/count/shelf${carryQuery(await searchParams)}`)
}
