import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getNewStoreSectionPromises } from "@/lib/counter/adapters/new-store"
import { CounterPhoneNewStoreClient } from "./counter-phone-new-store-client"

export const dynamic = "force-dynamic"

/**
 * The create form, on a phone — `P.storeedit.phone()`.
 *
 * A STATIC segment beside `/m/stores/[id]`, so Next resolves `new` here rather
 * than as a store id — the same shape `/m/ingredients/prices` needs.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sections = getNewStoreSectionPromises({ accountId: session.user.accountId })
  // `?store=` only, for the bar's middle tab — this page is `nodate` and has
  // no other use for the query.
  const sp = await searchParams
  const storeId = typeof sp.store === "string" ? sp.store : null

  return (
    <>
      <CounterPhoneNewStoreClient sections={sections} storeId={storeId} />
      <span hidden data-perf-ready="/m/stores/new" />
    </>
  )
}
