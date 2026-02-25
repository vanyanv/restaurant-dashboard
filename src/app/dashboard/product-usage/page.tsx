import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getProductUsageData, getRecipes } from "@/app/actions/product-usage-actions"
import { getStores } from "@/app/actions/store-actions"
import { ProductUsageContent } from "./components/product-usage-content"

export default async function ProductUsagePage() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect("/login")
  }

  if (session.user.role !== "OWNER") {
    redirect("/dashboard")
  }

  const [data, stores, recipes] = await Promise.all([
    getProductUsageData({ days: 30 }),
    getStores(),
    getRecipes(),
  ])

  return (
    <ProductUsageContent
      initialData={data}
      initialRecipes={recipes}
      stores={stores.map((s) => ({ id: s.id, name: s.name }))}
      userRole={session.user.role}
    />
  )
}
