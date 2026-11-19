import { permanentRedirect } from "next/navigation"
import { carryQuery } from "@/lib/counter/carry-query"

export const dynamic = "force-dynamic"

/**
 * `/m/operations/inventory/count/new` — a redirect shim onto the phone's
 * count walk, the one way to start or resume a count. `src/proxy.ts`
 * redirects it before render; this is the fallback.
 */
export default async function MobileStartCountRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  permanentRedirect(`/m/count/walk${carryQuery(await searchParams)}`)
}
