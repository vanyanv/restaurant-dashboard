import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getStores } from "@/app/actions/store-actions"
import { getRevenueForecast } from "@/app/actions/forecasts/revenue-forecast-actions"
import { getMenuItemForecast } from "@/app/actions/forecasts/menu-item-forecast-actions"
import { getOpenAnomalies } from "@/app/actions/forecasts/anomaly-actions"
import { getFoodCostForecast } from "@/app/actions/forecasts/food-cost-forecast-actions"
import { getMenuItemElasticity } from "@/app/actions/forecasts/elasticity-actions"
import { getLaborStaffingForecast } from "@/app/actions/forecasts/labor-staffing-actions"
import { getMenuEngineering } from "@/app/actions/forecasts/menu-engineering-actions"
import { getLostSales } from "@/app/actions/forecasts/lost-sales-actions"
import { getCashPositionForecast } from "@/app/actions/forecasts/cash-position-actions"
import { getVendorReliability } from "@/app/actions/forecasts/vendor-reliability-actions"
import { getPromoRoi } from "@/app/actions/forecasts/promo-roi-actions"
import { prisma } from "@/lib/prisma"
import { EditorialTopbar } from "../components/editorial-topbar"
import { ForecastsStorePicker } from "./components/forecasts-store-picker"
import { RevenueForecastCard } from "./components/revenue-forecast-card"
import { MenuItemForecastTable } from "./components/menu-item-forecast-table"
import { AnomalyFeed } from "./components/anomaly-feed"
import { FoodCostForecastCard } from "./components/food-cost-forecast-card"
import { ElasticityTable } from "./components/elasticity-table"
import { LaborStaffingCard } from "./components/labor-staffing-card"
import { MenuEngineeringCard } from "./components/menu-engineering-card"
import { LostSalesCard } from "./components/lost-sales-card"
import { CashPositionCard } from "./components/cash-position-card"
import { VendorReliabilityCard } from "./components/vendor-reliability-card"
import { PromoRoiCard } from "./components/promo-roi-card"

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

  const [
    revenueResult,
    menuItemResult,
    anomalyResult,
    foodCostResult,
    elasticityResult,
    laborResult,
    menuEngineeringResult,
    lostSalesResult,
    cashPositionResult,
    vendorReliabilityResult,
    promoRoiResult,
    storeMeta,
  ] = await Promise.all([
    getRevenueForecast({ storeId }),
    getMenuItemForecast({ storeId }),
    getOpenAnomalies({ storeId }),
    getFoodCostForecast({ storeId }),
    getMenuItemElasticity({ storeId }),
    getLaborStaffingForecast({ storeId }),
    getMenuEngineering({ storeId }),
    getLostSales({ storeId }),
    getCashPositionForecast({ storeId }),
    getVendorReliability({}),
    getPromoRoi({ storeId }),
    prisma.store.findUnique({
      where: { id: storeId },
      select: { targetCogsPct: true },
    }),
  ])
  // Store.targetCogsPct is stored as a percent (e.g. 28.5), the forecast
  // returns decimals (0.285) — normalize for the UI comparison.
  const targetPct =
    storeMeta?.targetCogsPct != null ? storeMeta.targetCogsPct / 100 : null
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
        {foodCostResult?.ok && (
          <FoodCostForecastCard data={foodCostResult.data} targetPct={targetPct} />
        )}
        {cashPositionResult?.ok && <CashPositionCard data={cashPositionResult.data} />}
        {vendorReliabilityResult?.ok && (
          <VendorReliabilityCard data={vendorReliabilityResult.data} />
        )}
        {promoRoiResult?.ok && <PromoRoiCard data={promoRoiResult.data} />}
        {anomalyResult?.ok && <AnomalyFeed data={anomalyResult.data} />}
        {lostSalesResult?.ok && <LostSalesCard data={lostSalesResult.data} />}
        {laborResult?.ok && <LaborStaffingCard data={laborResult.data} />}
        {menuEngineeringResult?.ok && (
          <MenuEngineeringCard data={menuEngineeringResult.data} />
        )}
        {menuItemResult?.ok && <MenuItemForecastTable data={menuItemResult.data} />}
        {elasticityResult?.ok && <ElasticityTable data={elasticityResult.data} />}
      </div>
    </div>
  )
}
