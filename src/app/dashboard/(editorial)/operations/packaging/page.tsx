import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getPackagingCostReport } from "@/app/actions/packaging-actions"
import { getStores } from "@/app/actions/store-actions"
import { PackagingContent } from "./components/packaging-content"

export default async function PackagingPage() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect("/login")
  }

  if (!hasOwnerAccess(session.user.role)) {
    redirect("/dashboard")
  }

  const [data, stores] = await Promise.all([
    getPackagingCostReport({ days: 30 }),
    getStores(),
  ])

  return (
    <PackagingContent
      initialData={data}
      stores={stores.map((store) => ({ id: store.id, name: store.name }))}
    />
  )
}
