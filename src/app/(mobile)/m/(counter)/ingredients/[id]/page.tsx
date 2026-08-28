import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getIngredientName, getIngredientSectionPromises } from "@/lib/counter/adapters/ingredient"
import { CounterPhoneIngredientClient } from "./counter-phone-ingredient-client"

export const dynamic = "force-dynamic"

/**
 * One ingredient, on a phone — `P.ingredient.phone()`
 * (`docs/counter/counter-prototype.html:7051`).
 *
 * Calls `getIngredientSectionPromises`, the same function the desk calls.
 */
export default async function MobileIngredientPage({
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

  const named = await getIngredientName(id, session.user.accountId)
  if (!named) notFound()

  const sections = getIngredientSectionPromises({
    ingredientId: id,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
    range: counterParams.range,
    today,
  })

  return (
    <>
      <CounterPhoneIngredientClient sections={sections} />
      <span hidden data-perf-ready="/m/ingredients/[id]" />
    </>
  )
}
