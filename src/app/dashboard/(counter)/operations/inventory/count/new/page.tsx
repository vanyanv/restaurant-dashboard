import { permanentRedirect } from "next/navigation"
import { carryQuery } from "@/lib/counter/carry-query"

export const dynamic = "force-dynamic"

/**
 * `/dashboard/operations/inventory/count/new` — a redirect shim onto
 * Inventory's count walk, the one way to start or resume a count.
 * `src/proxy.ts` redirects it before render; this is the fallback.
 */
export default async function StartCountRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  permanentRedirect(`/dashboard/count/walk${carryQuery(await searchParams)}`)
}
