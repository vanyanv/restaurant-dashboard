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
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sections = getNewStoreSectionPromises({ accountId: session.user.accountId })

  return (
    <>
      <CounterPhoneNewStoreClient sections={sections} />
      <span hidden data-perf-ready="/m/stores/new" />
    </>
  )
}
