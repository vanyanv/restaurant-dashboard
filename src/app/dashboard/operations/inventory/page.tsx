import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getStores } from "@/app/actions/store-actions"
import { getInventoryDashboardData } from "@/app/actions/inventory/dashboard-actions"
import { EditorialTopbar } from "../../components/editorial-topbar"
import { InventoryStorePicker } from "./components/inventory-store-picker"
import { InventoryDashboardClient } from "./components/inventory-dashboard-client"

interface PageProps {
  searchParams: Promise<{ storeId?: string }>
}

export default async function InventoryDashboardPage({ searchParams }: PageProps) {
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
  if (!stores.some((s) => s.id === storeId)) redirect("/dashboard/operations/inventory")

  const result = await getInventoryDashboardData({ storeId })
  if (!result || !result.ok) {
    return (
      <div className="px-6 py-10">
        <div className="inv-panel">
          <p className="text-[var(--ink-muted)]">Could not load inventory data.</p>
        </div>
      </div>
    )
  }

  const data = result.data
  const reorderRows = data.rows.filter(
    (r) => r.status === "reorder_now" || r.status === "urgent" || r.status === "reorder_soon"
  )

  return (
    <div className="flex flex-col h-full">
      <EditorialTopbar
        section="§ 06"
        title={`Inventory · ${data.storeName}`}
        stamps={
          <span>
            {data.rows.length} ingredients · {reorderRows.length} flagged
          </span>
        }
      >
        <InventoryStorePicker
          stores={stores.map((s) => ({ id: s.id, name: s.name }))}
          selectedStoreId={storeId}
        />
        <Link
          href="/dashboard/operations/inventory/count/new"
          className="font-mono text-[10px] uppercase tracking-[0.18em] border border-[var(--hairline-bold)] px-3 py-1.5 rounded-[2px] hover:bg-[rgba(220,38,38,0.045)] hover:text-[var(--accent)]"
        >
          Start count
        </Link>
      </EditorialTopbar>

      <div className="px-6 py-6 space-y-6">
        <InventoryDashboardClient data={data} />
      </div>
    </div>
  )
}
