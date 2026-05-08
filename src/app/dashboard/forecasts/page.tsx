import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getStores } from "@/app/actions/store-actions"
import { getRevenueForecast } from "@/app/actions/forecasts/revenue-forecast-actions"
import { getMenuItemForecast } from "@/app/actions/forecasts/menu-item-forecast-actions"
import { getOpenAnomalies } from "@/app/actions/forecasts/anomaly-actions"
import { EditorialTopbar } from "../components/editorial-topbar"
import { ForecastsStorePicker } from "./components/forecasts-store-picker"
import { RevenueForecastCard } from "./components/revenue-forecast-card"
import { MenuItemForecastTable } from "./components/menu-item-forecast-table"
import { AnomalyFeed } from "./components/anomaly-feed"

interface PageProps {
  searchParams: Promise<{ storeId?: string }>
}

export default async function ForecastsPage({ searchParams }: PageProps) {
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
  if (!stores.some((s) => s.id === storeId)) redirect("/dashboard/forecasts")

  const [revenueResult, menuItemResult, anomalyResult] = await Promise.all([
    getRevenueForecast({ storeId }),
    getMenuItemForecast({ storeId }),
    getOpenAnomalies({ storeId }),
  ])
  if (!revenueResult || !revenueResult.ok) {
    return (
      <div className="px-6 py-10">
        <div className="inv-panel">
          <p className="text-[var(--ink-muted)]">Could not load forecast data.</p>
        </div>
      </div>
    )
  }

  const data = revenueResult.data

  return (
    <div className="flex flex-col h-full">
      <EditorialTopbar
        section="§ 07"
        title={`Forecasts · ${data.storeName}`}
        stamps={
          <span>
            {data.days.length} days predicted
            {data.recentMape != null
              ? ` · ${(data.recentMape * 100).toFixed(1)}% MAPE`
              : ""}
          </span>
        }
      >
        <ForecastsStorePicker
          stores={stores.map((s) => ({ id: s.id, name: s.name }))}
          selectedStoreId={storeId}
        />
      </EditorialTopbar>

      <div className="px-6 py-6 space-y-6">
        <RevenueForecastCard data={data} />
        {anomalyResult?.ok && <AnomalyFeed data={anomalyResult.data} />}
        {menuItemResult?.ok && <MenuItemForecastTable data={menuItemResult.data} />}
      </div>
    </div>
  )
}
