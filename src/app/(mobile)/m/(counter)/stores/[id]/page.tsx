import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import {
  getStoreFileName,
  getStoreFileSectionPromises,
} from "@/lib/counter/adapters/stores"
import { counterToday } from "@/lib/counter/today"
import { CounterPhoneStoreFileClient } from "./counter-phone-store-file-client"

export const dynamic = "force-dynamic"

/**
 * One store's file, on a phone — `P.storecosts.phone()`.
 *
 * It reads the date control for the same reason the desk page does: every
 * fixed cost here is prorated to the selected range, and the strip's second
 * cell is what this range is charged. `P.storecosts` sets no `nodate`.
 *
 * This is where the phone Stores list's button lands, and until now that
 * button pointed at `/dashboard/stores/<id>` because there was nowhere else
 * for it to go.
 */
export default async function Page({
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
  const counterParams = readCounterParams(qs, counterToday())

  const named = await getStoreFileName(id, session.user.accountId)
  if (!named) notFound()

  const sections = getStoreFileSectionPromises({
    storeId: id,
    accountId: session.user.accountId,
    range: counterParams.range,
  })

  return (
    <>
      <CounterPhoneStoreFileClient sections={sections} storeId={id} />
      <span hidden data-perf-ready="/m/stores/[id]" />
    </>
  )
}
