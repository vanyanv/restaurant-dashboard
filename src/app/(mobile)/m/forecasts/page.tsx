import { Suspense } from "react"
import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getStores } from "@/app/actions/store/crud-actions"
import { getRevenueForecast } from "@/app/actions/forecasts/revenue-forecast-actions"
import { getMenuItemForecast } from "@/app/actions/forecasts/menu-item-forecast-actions"
import { PageHead } from "@/components/mobile/page-head"
import {
  MastheadFigures,
  type MastheadCell,
} from "@/components/mobile/masthead-figures"
import { MobileStoreSelect } from "@/components/mobile/m-store-select"
import { Panel } from "@/components/mobile/panel"
import { ForecastBandChart } from "@/components/mobile/forecast-band-chart"
import { ForecastMenuList } from "@/components/mobile/forecast-menu-list"
import {
  ExternalSignalsStrip,
  ExternalSignalsStripFallback,
} from "@/app/dashboard/forecasts/components/external-signals-strip"

export const dynamic = "force-dynamic"

const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

const fmtPct = (n: number | null) =>
  n == null || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(1)}%`

export default async function MobileForecastsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/m")

  const sp = await searchParams
  const requestedStoreId = sp.store && sp.store !== "" ? sp.store : undefined

  // Stores list and the forecast both have their own auth + account-scope check,
  // so we can fan them out in parallel. The forecast uses `requestedStoreId`
  // optimistically; if it doesn't belong to the account `getRevenueForecast`
  // returns ok=false and we'll redirect after both promises settle.
  const [stores, revenue] = await Promise.all([
    getStores(),
    getRevenueForecast({ storeId: requestedStoreId }),
  ])

  if (stores.length === 0) {
    return (
      <div>
        <PageHead
          dept="INTELLIGENCE"
          title="Forecasts"
          sub="No stores configured"
        />
        <div className="inv-panel inv-panel--empty">
          Create a store before forecasts can run.
        </div>
      </div>
    )
  }

  const storeId =
    requestedStoreId && stores.some((s) => s.id === requestedStoreId)
      ? requestedStoreId
      : undefined
  if (!revenue || !revenue.ok) {
    return (
      <div>
        <PageHead
          dept="INTELLIGENCE"
          title="Forecasts"
          sub="Unavailable"
        />
        <div className="inv-panel inv-panel--alert">
          Could not load forecast data.
        </div>
      </div>
    )
  }

  const data = revenue.data
  const totalPredicted = data.days.reduce(
    (s, d) => s + d.predictedRevenue,
    0,
  )
  const dailyAvg =
    data.days.length === 0 ? 0 : totalPredicted / data.days.length

  const cells: MastheadCell[] = [
    {
      label: "TOTAL · 7D",
      value: fmtMoney(totalPredicted),
      sub: data.days.length === 0 ? "no forecast yet" : `${data.days.length} days`,
    },
    {
      label: "DAILY AVG",
      value: fmtMoney(dailyAvg),
      sub: data.storeName,
    },
    {
      label: "MAPE",
      value: fmtPct(data.recentMape),
      sub: "last reconciled",
    },
  ]

  const storeIds = storeId ? [storeId] : stores.map((s) => s.id)

  return (
    <div data-perf-ready="/m/forecasts">
      <div
        className="dock-in dock-in-1"
        style={{
          margin: "0 -16px 14px",
          padding: "10px 16px",
          background: "rgba(255, 253, 247, 0.55)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span className="m-cap">STORE</span>
        <MobileStoreSelect
          stores={stores.map((s) => ({ id: s.id, name: s.name }))}
          storeId={storeId ?? null}
          pathname="/m/forecasts"
          searchParams={sp}
        />
      </div>

      <PageHead
        dept="INTELLIGENCE · § FORECASTS"
        title="Week ahead"
        sub={`${data.storeName} · ${data.days.length} days predicted`}
      />

      <MastheadFigures cells={cells} />

      <div style={{ marginTop: 14 }}>
        <Suspense fallback={<ExternalSignalsStripFallback />}>
          <ExternalSignalsStrip
            storeIds={storeIds}
            storeId={storeId}
            storeName={data.storeName}
          />
        </Suspense>
      </div>

      <div style={{ marginTop: 14 }}>
        <Panel dept="REVENUE FORECAST · 7D">
          <ForecastBandChart days={data.days} label="REVENUE FORECAST · 7D" />
        </Panel>
      </div>

      <div style={{ marginTop: 14 }}>
        <Suspense
          fallback={
            <Panel dept="MENU ITEMS · 7D">
              <div className="m-empty m-empty--flush">Loading…</div>
            </Panel>
          }
        >
          <MenuItemsPanel storeId={storeId} />
        </Suspense>
      </div>
    </div>
  )
}

async function MenuItemsPanel({ storeId }: { storeId: string | undefined }) {
  const menu = await getMenuItemForecast({ storeId })
  if (!menu || !menu.ok || menu.data.items.length === 0) {
    return (
      <Panel dept="MENU ITEMS · 7D">
        <div className="m-empty m-empty--flush">
          No menu-item forecast yet.
        </div>
      </Panel>
    )
  }
  return (
    <Panel dept={`MENU ITEMS · 7D · TOP ${Math.min(menu.data.items.length, 8)}`}>
      <ForecastMenuList items={menu.data.items} limit={8} />
    </Panel>
  )
}
