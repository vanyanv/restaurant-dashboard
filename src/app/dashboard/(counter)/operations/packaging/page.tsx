import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getPackagingSectionPromises } from "@/lib/counter/adapters/packaging"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterPackagingClient } from "./counter-packaging-client"

export const dynamic = "force-dynamic"

/** Packaging — `P.packaging` (`docs/counter/counter-prototype.html`). */
export default async function PackagingPage({
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

  const sections = getPackagingSectionPromises({
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
    range: counterParams.range,
  })

  return (
    <>
      <CounterPackagingClient
        params={params.toString()}
        stores={stores}
        today={today}
        sections={sections}
      />
      <span hidden data-perf-ready="/dashboard/operations/packaging" />
    </>
  )
}
