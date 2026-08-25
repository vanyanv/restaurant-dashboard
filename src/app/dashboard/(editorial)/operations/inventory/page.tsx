import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getStores } from "@/app/actions/store-actions"
import { getInventoryDashboardData } from "@/app/actions/inventory/dashboard-actions"
import { getInventoryCoverageHealth } from "@/app/actions/inventory/coverage-health-actions"
import {
  isOperational,
  pickDefaultStore,
  LIFECYCLE_LABEL,
} from "@/lib/store-lifecycle"
import { EditorialTopbar } from "../../components/editorial-topbar"
import { InventoryStorePicker } from "./components/inventory-store-picker"
import { InventoryDashboardClient } from "./components/inventory-dashboard-client"
import { CoverageHealthCard } from "./components/coverage-health-card"
import { AdjustmentDialog } from "./components/adjustment-dialog"

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

  // Default to a store that actually trades. Sorting by createdAt put a
  // pre-open store first, so the page opened on 76 ingredients of "NO SIGNAL"
  // — and paid ~10 queries per ingredient to compute them.
  const storeId = params.storeId ?? pickDefaultStore(stores)?.id
  if (!storeId) redirect("/dashboard")
  if (!stores.some((s) => s.id === storeId)) redirect("/dashboard/operations/inventory")

  const selectedStore = stores.find((s) => s.id === storeId)
  if (selectedStore && !isOperational(selectedStore)) {
    return (
      <div className="flex h-full flex-col">
        <EditorialTopbar
          section="§ 06"
          title={`Inventory · ${selectedStore.name}`}
          stamps={<span>{LIFECYCLE_LABEL[selectedStore.lifecycleStage]}</span>}
        >
          <InventoryStorePicker
            stores={stores.map((s) => ({ id: s.id, name: s.name }))}
            selectedStoreId={storeId}
          />
        </EditorialTopbar>
        <div className="px-6 py-6">
          <section className="inv-panel">
            <div className="inv-panel__head">
              <div>
                <div className="inv-panel__dept">No service yet</div>
                <h2 className="inv-panel__title">
                  {selectedStore.name} hasn&apos;t opened
                </h2>
              </div>
            </div>
            <p className="max-w-[62ch] text-[13px] leading-6 text-[var(--ink-muted)]">
              Par levels, depletion rates and reorder points are all derived from
              sales and deliveries, so there is nothing to model until this store
              starts trading. Pick a trading store above, or start a count to
              record opening stock.
            </p>
            <Link
              href="/dashboard/operations/inventory/count/new"
              className="toolbar-btn mt-5 inline-flex"
            >
              Start opening count
            </Link>
          </section>
        </div>
      </div>
    )
  }

  const [result, coverageResult] = await Promise.all([
    getInventoryDashboardData({ storeId }),
    getInventoryCoverageHealth({ storeId }),
  ])
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
        <AdjustmentDialog
          storeId={storeId}
          ingredients={data.rows.map((r) => ({
            ingredientId: r.ingredientId,
            ingredientName: r.ingredientName,
            category: r.category,
            recipeUnit: r.recipeUnit,
          }))}
        />
        <Link
          href="/dashboard/operations/inventory/count/new"
          className="font-mono text-[10px] uppercase tracking-[0.18em] border border-[var(--hairline-bold)] px-3 py-1.5 rounded-[2px] hover:bg-[var(--row-hover-bg)] hover:text-[var(--accent)]"
        >
          Start count
        </Link>
      </EditorialTopbar>

      <div className="px-6 py-6 space-y-6">
        {coverageResult?.ok && <CoverageHealthCard data={coverageResult.data} />}
        <InventoryDashboardClient data={data} />
      </div>
    </div>
  )
}
