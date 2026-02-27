import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getProductUsageData } from "@/app/actions/product-usage-actions"
import { getStores } from "@/app/actions/store-actions"
import { VendorsContent } from "./components/vendors-content"

export default async function VendorsPage() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect("/login")
  }

  if (session.user.role !== "OWNER") {
    redirect("/dashboard")
  }

  const [data, stores] = await Promise.all([
    getProductUsageData({ days: 30 }),
    getStores(),
  ])

  return (
    <VendorsContent
      initialData={data}
      stores={stores.map((s) => ({ id: s.id, name: s.name }))}
    />
  )
}
