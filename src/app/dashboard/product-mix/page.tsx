import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getProductMixData, getStores } from "@/app/actions/store-actions"
import { ProductMixContent } from "./components/product-mix-content"

export default async function ProductMixPage() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect("/login")
  }

  if (session.user.role !== "OWNER") {
    redirect("/dashboard")
  }

  const [data, stores] = await Promise.all([
    getProductMixData(undefined, { days: 7 }),
    getStores(),
  ])

  return (
    <ProductMixContent
      initialData={data}
      stores={stores.map((s) => ({ id: s.id, name: s.name }))}
      userRole={session.user.role}
    />
  )
}
