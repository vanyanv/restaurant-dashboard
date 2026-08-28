import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getRecipeSectionPromises } from "@/lib/counter/adapters/recipe"
import { CounterPhoneRecipeClient } from "./counter-phone-recipe-client"

export const dynamic = "force-dynamic"

/**
 * One recipe, on a phone — `P.recipe.phone()`
 * (`docs/counter/counter-prototype.html:6243`).
 *
 * Calls `getRecipeSectionPromises`, the same function the desk calls.
 */
export default async function MobileRecipePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const { id } = await params
  const sp = await searchParams
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") qs.set(key, value)
  }

  const today = new Date()
  const counterParams = readCounterParams(qs, today)

  const sections = getRecipeSectionPromises({
    recipeId: id,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
    range: counterParams.range,
    today,
  })

  return (
    <>
      <CounterPhoneRecipeClient sections={sections} />
      <span hidden data-perf-ready="/m/recipes/[id]" />
    </>
  )
}
