import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getIngredientsSectionPromises } from "@/lib/counter/adapters/ingredients"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterIngredientsClient } from "./counter-ingredients-client"
import { counterToday } from "@/lib/counter/today"

export const dynamic = "force-dynamic"

/** Ingredients — `P.ingredients` (`docs/counter/counter-prototype.html:5769`). */
export default async function IngredientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sp = await searchParams
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") params.set(key, value)
  }

  const today = counterToday()
  const counterParams = readCounterParams(params, today)
  const stores = await getOverviewStores()

  const sections = getIngredientsSectionPromises({
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
    today,
  })

  return (
    <>
      <CounterIngredientsClient
        params={params.toString()}
        stores={stores}
        today={today}
        sections={sections}
      />
      <span hidden data-perf-ready="/dashboard/ingredients" />
    </>
  )
}
