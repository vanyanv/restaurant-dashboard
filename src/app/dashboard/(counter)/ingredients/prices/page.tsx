import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getPriceSectionPromises } from "@/lib/counter/adapters/prices"
import { CounterPricesClient } from "./counter-prices-client"

export const dynamic = "force-dynamic"

/** See the adapter's docblock for why the move is latest-vs-trailing-median. */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sections = getPriceSectionPromises()

  return (
    <>
      <CounterPricesClient sections={sections} />
      <span hidden data-perf-ready="/dashboard/ingredients/prices" />
    </>
  )
}
