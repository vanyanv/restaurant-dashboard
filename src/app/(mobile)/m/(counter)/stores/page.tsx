import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getStoresSectionPromises } from "@/lib/counter/adapters/stores"
import { CounterPhoneStoresClient } from "./counter-phone-stores-client"

export const dynamic = "force-dynamic"

/** Stores, on a phone — `P.stores.phone()`. */
export default async function MobileStoresPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sections = getStoresSectionPromises({ accountId: session.user.accountId })

  return (
    <>
      <CounterPhoneStoresClient sections={sections} />
      <span hidden data-perf-ready="/m/stores" />
    </>
  )
}
