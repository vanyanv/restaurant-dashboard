import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getRecipeName, getRecipeSectionPromises } from "@/lib/counter/adapters/recipe"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterRecipeClient } from "./counter-recipe-client"

export const dynamic = "force-dynamic"

/** One recipe — `P.recipe` (`docs/counter/counter-prototype.html:6151`). */
export default async function RecipePage({
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

  // The name is awaited; the SECTIONS are not. One indexed lookup buys the
  // masthead a title, the breadcrumb its leaf and this route its 404, without
  // awaiting a loader — see `getRecipeName`.
  const [stores, named] = await Promise.all([
    getOverviewStores(),
    getRecipeName(id, session.user.accountId),
  ])
  if (!named) notFound()

  const sections = getRecipeSectionPromises({
    recipeId: id,
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
    range: counterParams.range,
    today,
  })

  return (
    <>
      <CounterRecipeClient
        params={qs.toString()}
        stores={stores}
        today={today}
        title={named.name}
        sections={sections}
      />
      <span hidden data-perf-ready="/dashboard/recipes/[id]" />
    </>
  )
}
