import { Suspense } from "react"
import dynamic from "next/dynamic"
import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getStores } from "@/app/actions/store-actions"
import { getRevenueForecast } from "@/app/actions/forecasts/revenue-forecast-actions"
import { getMenuItemForecast } from "@/app/actions/forecasts/menu-item-forecast-actions"
import { getOpenAnomalies } from "@/app/actions/forecasts/anomaly-actions"
import { getFoodCostForecast } from "@/app/actions/forecasts/food-cost-forecast-actions"
import { getLaborStaffingForecast } from "@/app/actions/forecasts/labor-staffing-actions"
import { getProfitRiskForecast } from "@/app/actions/forecasts/profit-risk-actions"
import { getMenuEngineering } from "@/app/actions/forecasts/menu-engineering-actions"
import { getLostSales } from "@/app/actions/forecasts/lost-sales-actions"
import { getCashPositionForecast } from "@/app/actions/forecasts/cash-position-actions"
import { getVendorReliability } from "@/app/actions/forecasts/vendor-reliability-actions"
import { getPromoRoi } from "@/app/actions/forecasts/promo-roi-actions"
import { getLaunchTrajectory } from "@/app/actions/forecasts/launch-trajectory-actions"
import { getChannelMix } from "@/app/actions/forecasts/channel-mix-actions"
import { getWasteRootCauses } from "@/app/actions/forecasts/waste-cluster-actions"
import { prisma } from "@/lib/prisma"
import { EditorialTopbar } from "../components/editorial-topbar"
import { ForecastsStorePicker } from "./components/forecasts-store-picker"
import { ForecastsBriefing } from "./components/forecasts-briefing"
import { ForecastsRibbon } from "./components/forecasts-ribbon"
import { MenuItemForecastTable } from "./components/menu-item-forecast-table"
import { AnomalyFeed } from "./components/anomaly-feed"
import { FoodCostForecastCard } from "./components/food-cost-forecast-card"
import { LaborStaffingCard } from "./components/labor-staffing-card"
import { ProfitRiskCard } from "./components/profit-risk-card"
import { MenuEngineeringCard } from "./components/menu-engineering-card"
import { LostSalesCard } from "./components/lost-sales-card"
import { VendorReliabilityCard } from "./components/vendor-reliability-card"
import { PromoRoiCard } from "./components/promo-roi-card"
import { LaunchTrajectoryCard } from "./components/launch-trajectory-card"
import { ChannelMixCard } from "./components/channel-mix-card"
import { WasteClusterCard } from "./components/waste-cluster-card"

// Recharts is only rendered on the revenue section; lazy-loading these two
// cards keeps ~100 KB out of the initial route bundle when the user is on
// menu / costs / operations / anomalies.
const RevenueForecastCard = dynamic(() =>
  import("./components/revenue-forecast-card").then(
    (m) => m.RevenueForecastCard,
  ),
)
const CashPositionCard = dynamic(() =>
  import("./components/cash-position-card").then((m) => m.CashPositionCard),
)
import { buildBriefing } from "./lib/build-briefing"
import { logger } from "@/lib/logger"
import {
  FORECAST_SECTIONS,
  parseSection,
  type ForecastSection,
} from "./lib/sections"

interface PageProps {
  searchParams: Promise<{ storeId?: string; section?: string }>
}

const PROMO_LOOKBACK_DAYS = 30
const LAUNCH_RECENCY_DAYS = 60

type StoreMeta =
  | { targetCogsPct: number | null }
  | { targetCogsPct: number | null }[]
  | null

async function timeForecast<T>(
  name: string,
  storeId: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = performance.now()
  try {
    return await fn()
  } finally {
    const ms = Math.round(performance.now() - t0)
    logger.info(`[forecasts] ${name} ${ms}ms (storeId=${storeId ?? "ALL"})`)
  }
}

async function getStoreMeta(
  accountId: string,
  storeId: string | undefined,
): Promise<StoreMeta> {
  if (storeId) {
    return prisma.store.findUnique({
      where: { id: storeId },
      select: { targetCogsPct: true },
    })
  }
  return prisma.store.findMany({
    where: {
      accountId,
      isActive: true,
      targetCogsPct: { not: null },
    },
    select: { targetCogsPct: true },
  })
}

function normalizeTargetPct(storeMeta: StoreMeta): number | null {
  if (!storeMeta) return null
  if (Array.isArray(storeMeta)) {
    const targets = storeMeta
      .map((s) => s.targetCogsPct)
      .filter((t): t is number => t != null)
    if (targets.length === 0) return null
    return targets.reduce((s, t) => s + t, 0) / targets.length / 100
  }
  return storeMeta.targetCogsPct != null ? storeMeta.targetCogsPct / 100 : null
}

function ForecastSectionFallback({ label }: { label: string }) {
  return (
    <div className="inv-panel">
      <p className="text-[var(--ink-muted)]">Loading {label.toLowerCase()}…</p>
    </div>
  )
}

export default async function ForecastsPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard")

  const params = await searchParams
  // No storeId → portfolio "All stores" view. With a storeId → single-store
  // deep dive (must belong to the user's account). getRevenueForecast does
  // its own membership check via resolveStoreContext, so it can run in
  // parallel with getStores; we still validate store ownership against the
  // returned stores list before rendering.
  const storeId: string | undefined = params.storeId
  const [stores, revenueResult] = await Promise.all([
    getStores(),
    timeForecast("revenue", storeId, () => getRevenueForecast({ storeId })),
  ])

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

  if (storeId && !stores.some((s) => s.id === storeId)) {
    redirect("/dashboard/forecasts")
  }

  const section = parseSection(params.section)

  if (!revenueResult || !revenueResult.ok) {
    return (
      <div className="px-6 py-10">
        <div className="inv-panel">
          <p className="text-[var(--ink-muted)]">
            Could not load forecast data.
          </p>
        </div>
      </div>
    )
  }

  const data = revenueResult.data

  const isAggregate = storeId == null
  const briefingLines = buildBriefing({
    revenue: data,
    cash: null,
    foodCost: null,
    targetCogsPct: null,
    anomalies: null,
    lostSales: null,
    menuEngineering: null,
    isAggregate,
  })

  const sectionAvailability: Record<ForecastSection, boolean> = {
    revenue: true,
    menu: true,
    costs: true,
    operations: true,
    anomalies: true,
  }

  const sectionMeta = FORECAST_SECTIONS.find((s) => s.id === section)!

  return (
    <div className="flex flex-col h-full">
      <EditorialTopbar
        section="§ 07"
        title={`Forecasts · ${data.storeName}`}
        stamps={
          <span>
            {data.days.length} days predicted
            {!isAggregate && data.recentMape != null
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

      <ForecastsRibbon current={section} available={sectionAvailability} />

      <div className="px-6 py-6 space-y-6">
        <ForecastsBriefing lines={briefingLines} storeName={data.storeName} />

        <section className="forecasts-section">
          <header className="forecasts-section-masthead">
            <h2 className="forecasts-section-masthead__title">
              <span className="forecasts-section-masthead__title-mark">§</span>
              {sectionMeta.label}
            </h2>
            <span className="forecasts-section-masthead__meta">
              {data.storeName}
            </span>
          </header>

          {section === "revenue" && (
            <>
              <RevenueForecastCard data={data} />
              <Suspense
                fallback={<ForecastSectionFallback label="revenue detail" />}
              >
                <RevenueExtras
                  accountId={session.user.accountId}
                  storeId={storeId}
                />
              </Suspense>
            </>
          )}

          {section === "menu" && (
            <Suspense
              fallback={<ForecastSectionFallback label="menu forecasts" />}
            >
              <MenuSection storeId={storeId} />
            </Suspense>
          )}

          {section === "costs" && (
            <Suspense
              fallback={<ForecastSectionFallback label="cost forecasts" />}
            >
              <CostsSection storeId={storeId} />
            </Suspense>
          )}

          {section === "operations" && (
            <Suspense
              fallback={
                <ForecastSectionFallback label="operations forecasts" />
              }
            >
              <OperationsSection storeId={storeId} />
            </Suspense>
          )}

          {section === "anomalies" && (
            <Suspense fallback={<ForecastSectionFallback label="anomalies" />}>
              <AnomaliesSection storeId={storeId} />
            </Suspense>
          )}
        </section>
      </div>
    </div>
  )
}

async function RevenueExtras({
  accountId,
  storeId,
}: {
  accountId: string
  storeId: string | undefined
}) {
  const [
    foodCostResult,
    cashPositionResult,
    channelMixResult,
    promoRoiResult,
    storeMeta,
  ] = await Promise.all([
    timeForecast("food-cost", storeId, () => getFoodCostForecast({ storeId })),
    timeForecast("cash-position", storeId, () =>
      getCashPositionForecast({ storeId }),
    ),
    timeForecast("channel-mix", storeId, () => getChannelMix({ storeId })),
    timeForecast("promo-roi", storeId, () => getPromoRoi({ storeId })),
    timeForecast("store-meta", storeId, () => getStoreMeta(accountId, storeId)),
  ])

  const targetPct = normalizeTargetPct(storeMeta)
  const hasRecentPromo =
    promoRoiResult?.ok &&
    promoRoiResult.data.events.some((e) => {
      const ageDays =
        (Date.now() - new Date(e.date).getTime()) / (1000 * 60 * 60 * 24)
      return ageDays <= PROMO_LOOKBACK_DAYS
    })

  return (
    <>
      {foodCostResult?.ok && (
        <FoodCostForecastCard
          data={foodCostResult.data}
          targetPct={targetPct}
        />
      )}
      {cashPositionResult?.ok && (
        <CashPositionCard data={cashPositionResult.data} />
      )}
      {channelMixResult?.ok && <ChannelMixCard data={channelMixResult.data} />}
      {hasRecentPromo && promoRoiResult?.ok && (
        <PromoRoiCard data={promoRoiResult.data} />
      )}
    </>
  )
}

async function MenuSection({ storeId }: { storeId: string | undefined }) {
  const [menuEngineeringResult, menuItemResult, launchTrajectoryResult] =
    await Promise.all([
      timeForecast("menu-engineering", storeId, () =>
        getMenuEngineering({ storeId }),
      ),
      timeForecast("menu-item", storeId, () =>
        getMenuItemForecast({ storeId }),
      ),
      timeForecast("launch-trajectory", storeId, () =>
        getLaunchTrajectory({ storeId }),
      ),
    ])

  const hasRecentLaunch =
    launchTrajectoryResult?.ok &&
    launchTrajectoryResult.data.launches.some(
      (l) => l.daysSinceLaunch <= LAUNCH_RECENCY_DAYS,
    )

  return (
    <>
      {menuEngineeringResult?.ok && (
        <MenuEngineeringCard data={menuEngineeringResult.data} />
      )}
      {menuItemResult?.ok && (
        <MenuItemForecastTable data={menuItemResult.data} />
      )}
      {hasRecentLaunch && launchTrajectoryResult?.ok && (
        <LaunchTrajectoryCard data={launchTrajectoryResult.data} />
      )}
    </>
  )
}

async function CostsSection({ storeId }: { storeId: string | undefined }) {
  const [vendorReliabilityResult, wasteClusterResult] = await Promise.all([
    timeForecast("vendor-reliability", storeId, () => getVendorReliability({})),
    timeForecast("waste-cluster", storeId, () =>
      getWasteRootCauses({ storeId }),
    ),
  ])

  return (
    <>
      {vendorReliabilityResult?.ok && (
        <VendorReliabilityCard data={vendorReliabilityResult.data} />
      )}
      {wasteClusterResult?.ok && (
        <WasteClusterCard data={wasteClusterResult.data} />
      )}
    </>
  )
}

async function OperationsSection({ storeId }: { storeId: string | undefined }) {
  const [laborResult, profitRiskResult, lostSalesResult] = await Promise.all([
    timeForecast("labor", storeId, () => getLaborStaffingForecast({ storeId })),
    timeForecast("profit-risk", storeId, () => getProfitRiskForecast({ storeId })),
    timeForecast("lost-sales", storeId, () => getLostSales({ storeId })),
  ])

  return (
    <>
      {laborResult?.ok && <LaborStaffingCard data={laborResult.data} />}
      {profitRiskResult?.ok && <ProfitRiskCard data={profitRiskResult.data} />}
      {lostSalesResult?.ok && <LostSalesCard data={lostSalesResult.data} />}
    </>
  )
}

async function AnomaliesSection({ storeId }: { storeId: string | undefined }) {
  const anomalyResult = await timeForecast("anomaly", storeId, () =>
    getOpenAnomalies({ storeId }),
  )
  return anomalyResult?.ok ? <AnomalyFeed data={anomalyResult.data} /> : null
}
