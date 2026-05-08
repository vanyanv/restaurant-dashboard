import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getStores } from "@/app/actions/store-actions"
import { getRevenueForecast } from "@/app/actions/forecasts/revenue-forecast-actions"
import { EditorialTopbar } from "../components/editorial-topbar"
import { ForecastsStorePicker } from "./components/forecasts-store-picker"
import { RevenueForecastCard } from "./components/revenue-forecast-card"

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

  const result = await getRevenueForecast({ storeId })
  if (!result || !result.ok) {
    return (
      <div className="px-6 py-10">
        <div className="inv-panel">
          <p className="text-[var(--ink-muted)]">Could not load forecast data.</p>
        </div>
      </div>
    )
  }

  const data = result.data

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
      </div>
    </div>
  )
}
