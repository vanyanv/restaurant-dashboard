import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import {
  getStoreFileName,
  getStoreFileSectionPromises,
} from "@/lib/counter/adapters/stores"
import { CounterStoreFileClient } from "./counter-store-file-client"

export const dynamic = "force-dynamic"

/** One store's file — `P.storecosts`. Standing inputs, so no date control. */
export default async function StoreFilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const { id } = await params
  const named = await getStoreFileName(id, session.user.accountId)
  if (!named) notFound()

  const sections = getStoreFileSectionPromises({
    storeId: id,
    accountId: session.user.accountId,
  })

  return (
    <>
      <CounterStoreFileClient title={named.name} sections={sections} />
      <span hidden data-perf-ready="/dashboard/stores/[id]" />
    </>
  )
}
