import { getServerSession } from "next-auth"
import { redirect, notFound } from "next/navigation"
import { authOptions } from "@/lib/auth"
import {
  getStoreById,
  getStores,
  getOtterAnalytics,
  getMenuCategoryAnalytics,
} from "@/app/actions/store-actions"
import { StoreAnalyticsContent } from "./components/store-analytics-content"

export default async function StoreAnalyticsPage(props: {
  params: Promise<{ storeId: string }>
}) {
  const params = await props.params
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect("/login")
  }

  const { storeId } = params

  const [store, allStores, analytics, menuData] = await Promise.all([
    getStoreById(storeId),
    getStores(),
    getOtterAnalytics(storeId),
    getMenuCategoryAnalytics(storeId),
  ])

  if (!store || !analytics) {
    notFound()
  }

  return (
    <StoreAnalyticsContent
      store={{ id: store.id, name: store.name, address: store.address, phone: store.phone }}
      allStores={allStores.map((s) => ({ id: s.id, name: s.name }))}
      analytics={analytics}
      menuData={menuData}
    />
  )
}
