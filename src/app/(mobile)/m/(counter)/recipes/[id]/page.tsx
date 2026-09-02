import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getRecipeName, getRecipeSectionPromises } from "@/lib/counter/adapters/recipe"
import { CounterPhoneRecipeClient } from "./counter-phone-recipe-client"
import { counterToday } from "@/lib/counter/today"

export const dynamic = "force-dynamic"

/**
 * One recipe, on a phone — `P.recipe.phone()`
 * (`docs/counter/counter-prototype.html:6243`).
 *
 * Calls `getRecipeSectionPromises`, the same function the desk calls.
 *
 * AND `getRecipeName`, for the same reason the desk calls it: to 404. This was
 * the only one of the product's twenty-two detail routes that did not — every
 * other `[id]`/`[storeId]`/`[vendor]` page on both surfaces reaches
 * `notFound()`, and this one streamed sections for a recipe that might not
 * exist, so a stale link or a typed id rendered an empty-looking page instead
 * of the 404 the design draws. `getRecipeName`'s own docblock names this as
 * its second job — "one indexed lookup on the primary key, returning null when
 * the recipe is not this account's, which is also how the route decides to
 * 404" — so the guard is a lookup the desk already pays for and the sections
 * still stream behind it.
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

  // Before anything else is composed: a recipe that is not this account's is a
  // 404, not an empty page wearing a title.
  if (!(await getRecipeName(id, session.user.accountId))) notFound()

  const sp = await searchParams
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") qs.set(key, value)
  }

  const today = counterToday()
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
