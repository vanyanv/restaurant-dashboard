import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getStores } from "@/app/actions/store-actions"
import {
  startOrResumeStockCount,
  getCountEntryData,
} from "@/app/actions/inventory/count-entry-actions"
import { CountEntryForm } from "./components/count-entry-form"
import { CountEntryStorePicker } from "./components/count-entry-store-picker"

interface PageProps {
  searchParams: Promise<{ storeId?: string }>
}

export default async function NewStockCountPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard")

  const params = await searchParams
  const stores = await getStores()
  if (stores.length === 0) {
    return (
      <div className="px-6 py-10">
        <div className="inv-panel">
          <p className="text-[var(--ink-muted)]">
            No stores configured for this account. Create a store first.
          </p>
        </div>
      </div>
    )
  }

  const storeId = params.storeId ?? stores[0]?.id
  if (!storeId) redirect("/dashboard")
  if (!stores.some((s) => s.id === storeId)) redirect("/dashboard/operations/inventory/count/new")

  const startResult = await startOrResumeStockCount({ storeId })
  if (!startResult || !startResult.ok) {
    return (
      <div className="px-6 py-10">
        <div className="inv-panel">
          <p className="text-[var(--ink-muted)]">
            Could not start a count for this store.
          </p>
        </div>
      </div>
    )
  }

  const data = await getCountEntryData({ stockCountId: startResult.stockCountId })
  if (!data || !data.ok) {
    return (
      <div className="px-6 py-10">
        <div className="inv-panel">
          <p className="text-[var(--ink-muted)]">Could not load count data.</p>
        </div>
      </div>
    )
  }

  return (
    <CountEntryForm
      count={data.count}
      ingredients={data.ingredients}
      resumed={startResult.resumed}
      storePicker={
        <CountEntryStorePicker
          stores={stores.map((s) => ({ id: s.id, name: s.name }))}
          selectedStoreId={storeId}
        />
      }
    />
  )
}
