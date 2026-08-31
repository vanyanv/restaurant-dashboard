import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getIngredientsSectionPromises } from "@/lib/counter/adapters/ingredients"
import { CounterPhoneIngredientsClient } from "./counter-phone-ingredients-client"
import { counterToday } from "@/lib/counter/today"

export const dynamic = "force-dynamic"

/**
 * Ingredients, on a phone — `P.ingredients.phone()`
 * (`docs/counter/counter-prototype.html:5828`).
 *
 * Calls `getIngredientsSectionPromises`, the same function the desk calls.
 */
export default async function MobileIngredientsPage({
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

  const sections = getIngredientsSectionPromises({
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
    today,
  })

  return (
    <>
      <CounterPhoneIngredientsClient sections={sections} />
      <span hidden data-perf-ready="/m/ingredients" />
    </>
  )
}
