import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getRecipesSectionPromises } from "@/lib/counter/adapters/recipes"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterRecipesClient } from "./counter-recipes-client"

export const dynamic = "force-dynamic"

/** Recipes — `P.recipes` (`docs/counter/counter-prototype.html:6107`). */
export default async function RecipesPage({
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

  const today = new Date()
  const counterParams = readCounterParams(params, today)
  const stores = await getOverviewStores()

  const sections = getRecipesSectionPromises({
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
    range: counterParams.range,
    today,
  })

  return (
    <>
      <CounterRecipesClient
        params={params.toString()}
        stores={stores}
        today={today}
        sections={sections}
      />
      <span hidden data-perf-ready="/dashboard/recipes" />
    </>
  )
}
