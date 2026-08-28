import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getRecipesSectionPromises } from "@/lib/counter/adapters/recipes"
import { CounterPhoneRecipesClient } from "./counter-phone-recipes-client"

export const dynamic = "force-dynamic"

/**
 * Recipes, on a phone — `P.recipes.phone()`
 * (`docs/counter/counter-prototype.html:6136`).
 *
 * Calls `getRecipesSectionPromises`, the same function the desk calls.
 */
export default async function MobileRecipesPage({
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

  const sections = getRecipesSectionPromises({
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
    range: counterParams.range,
    today,
  })

  return (
    <>
      <CounterPhoneRecipesClient sections={sections} />
      <span hidden data-perf-ready="/m/recipes" />
    </>
  )
}
