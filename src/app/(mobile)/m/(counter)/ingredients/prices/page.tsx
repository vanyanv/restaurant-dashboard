import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getPriceSectionPromises } from "@/lib/counter/adapters/prices"
import { CounterPhonePricesClient } from "./counter-phone-prices-client"

export const dynamic = "force-dynamic"

/**
 * The price monitor's phone surface — `P.prices.phone()`.
 *
 * A static segment beside `/m/ingredients/[id]`, so Next resolves `prices`
 * here rather than as an ingredient id. `proxy.ts` carried this route in a
 * `NO_PHONE_PAGE` exception until now, to stop the ingredients prefix rewrite
 * from sending a phone to a route that did not exist.
 */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sections = getPriceSectionPromises()

  return (
    <>
      <CounterPhonePricesClient sections={sections} />
      <span hidden data-perf-ready="/m/ingredients/prices" />
    </>
  )
}
