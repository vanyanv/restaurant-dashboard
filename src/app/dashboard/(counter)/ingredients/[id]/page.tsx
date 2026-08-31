import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getIngredientName, getIngredientSectionPromises } from "@/lib/counter/adapters/ingredient"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterIngredientClient } from "./counter-ingredient-client"
import { counterToday } from "@/lib/counter/today"

export const dynamic = "force-dynamic"

/** One ingredient — `P.ingredient` (`docs/counter/counter-prototype.html:7020`). */
export default async function IngredientPage({
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

  const today = counterToday()
  const counterParams = readCounterParams(qs, today)

  // The name is awaited; the SECTIONS are not — one indexed lookup buys the
  // masthead a title, the breadcrumb its leaf and this route its 404, without
  // awaiting a loader. Same shape as `recipes/[id]`.
  const [stores, named] = await Promise.all([
    getOverviewStores(),
    getIngredientName(id, session.user.accountId),
  ])
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
      <CounterIngredientClient
        params={qs.toString()}
        stores={stores}
        today={today}
        title={named.name}
        sections={sections}
      />
      <span hidden data-perf-ready="/dashboard/ingredients/[id]" />
    </>
  )
}
