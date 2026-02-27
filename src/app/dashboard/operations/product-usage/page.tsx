import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getProductUsageData } from "@/app/actions/product-usage-actions"
import { getStores } from "@/app/actions/store-actions"
import { ProductUsageContent } from "./components/product-usage-content"

export default async function ProductUsagePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (session.user.role !== "OWNER") redirect("/dashboard")

  const [data, stores] = await Promise.all([
    getProductUsageData({ days: 30 }),
    getStores(),
  ])

  return (
    <ProductUsageContent
      initialData={data}
      stores={stores.map((s) => ({ id: s.id, name: s.name }))}
      userRole={session.user.role}
    />
  )
}
