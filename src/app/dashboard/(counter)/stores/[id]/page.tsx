import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import {
  getStoreFileName,
  getStoreFileSectionPromises,
} from "@/lib/counter/adapters/stores"
import { CounterStoreFileClient } from "./counter-store-file-client"
import { counterToday } from "@/lib/counter/today"

export const dynamic = "force-dynamic"

/**
 * One store's file — `P.storecosts`.
 *
 * THIS PAGE READS THE DATE CONTROL, and used to say the opposite. `P.stores`
 * declares `nodate: true`; `P.storecosts` does not, because every fixed cost
 * on it is prorated to the selected range and the page says so in its own body
 * copy. The old comment here ("Standing inputs, so no date control") was the
 * store LIST's rule applied to the wrong page, and it cost this one three
 * panels — see the adapter's docblock.
 */
export default async function StoreFilePage({
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

  const named = await getStoreFileName(id, session.user.accountId)
  if (!named) notFound()

  const sections = getStoreFileSectionPromises({
    storeId: id,
    accountId: session.user.accountId,
    range: counterParams.range,
  })

  return (
    <>
      <CounterStoreFileClient
        title={named.name}
        params={qs.toString()}
        today={today}
        sections={sections}
      />
      <span hidden data-perf-ready="/dashboard/stores/[id]" />
    </>
  )
}
