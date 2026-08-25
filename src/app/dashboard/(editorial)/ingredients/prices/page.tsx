import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { EditorialTopbar } from "../../components/editorial-topbar"
import { getIngredientPriceMonitoringData } from "@/app/actions/ingredient-price-monitoring-actions"
import { PriceMonitorControls } from "./components/price-monitor-controls"
import { PriceMonitorShell } from "./components/price-monitor-shell"

export default async function IngredientPricesPage({
  searchParams,
}: {
  searchParams: Promise<{
    days?: string
    storeId?: string
    category?: string
    status?: string
  }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sp = await searchParams
  const days = sp.days ? Number.parseInt(sp.days, 10) : 30
  const data = await getIngredientPriceMonitoringData({
    days,
    storeId: sp.storeId,
  })

  return (
    <div className="flex h-full flex-col">
      <EditorialTopbar
        section="§ 03"
        title="Ingredient Prices"
        stamps={`normalized · ${data.rows.length} ingredients`}
      >
        <PriceMonitorControls
          days={data.days}
          storeId={data.storeId}
          stores={data.stores}
        />
      </EditorialTopbar>

      <div className="flex-1 overflow-auto px-4 pb-8 pt-4 sm:px-6 sm:pt-5">
        <div className="mx-auto max-w-350">
          <PriceMonitorShell
            data={data}
            filters={{ category: sp.category, status: sp.status }}
          />
        </div>
      </div>
    </div>
  )
}
