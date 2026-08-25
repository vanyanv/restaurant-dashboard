import { getServerSession } from "next-auth"
import { redirect, notFound } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getStoreById, getStores } from "@/app/actions/store-actions"
import { parseRangeWithDefault } from "@/lib/dashboard-utils"
import { StoreAnalyticsShell } from "./components/store-analytics-shell"

export default async function StoreAnalyticsPage(props: {
  params: Promise<{ storeId: string }>
  searchParams: Promise<{ start?: string; end?: string; days?: string }>
}) {
  const { storeId } = await props.params
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const [store, allStores] = await Promise.all([
    getStoreById(storeId),
    getStores(),
  ])
  if (!store) notFound()

  const sp = await props.searchParams
  const range = parseRangeWithDefault(sp, 30)

  return (
    <StoreAnalyticsShell
      store={{ id: store.id, name: store.name }}
      allStores={allStores.map((s) => ({ id: s.id, name: s.name }))}
      range={range}
    />
  )
}
