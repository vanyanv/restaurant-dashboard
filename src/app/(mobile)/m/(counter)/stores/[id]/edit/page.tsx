import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import {
  getStoreFileName,
  getStoreFileSectionPromises,
} from "@/lib/counter/adapters/stores"
import { CounterStoreFileClient } from "@/app/dashboard/(counter)/stores/[id]/counter-store-file-client"
import { counterToday } from "@/lib/counter/today"

export const dynamic = "force-dynamic"

/** One store's file, edited on a phone: the desk file drawn in the phone shell. */
export default async function MobileStoreEditPage({
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
        storeId={id}
        title={named.name}
        params={qs.toString()}
        today={today}
        sections={sections}
      />
      <span hidden data-perf-ready="/m/stores/[id]/edit" />
    </>
  )
}
