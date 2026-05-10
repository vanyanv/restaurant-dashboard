import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import "./labor.css"
import {
  getHarriStoresWeek,
  getHarriTrendAllStores,
  type HarriStoreWeekRow,
} from "@/app/actions/harri-actions"
import { LaborStoreTabs, type LaborStoreTab } from "./components/labor-store-tabs"
import { LaborWeekNav } from "./components/labor-week-nav"
import { LaborWeekKpis } from "./components/labor-week-kpis"
import { LaborStoresPanel } from "./components/labor-stores-panel"
import { LaborWeekTrend } from "./components/labor-week-trend"

const TREND_WEEKS = 13

function isoMondayUTC(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  const dow = out.getUTCDay()
  const offset = dow === 0 ? -6 : 1 - dow
  out.setUTCDate(out.getUTCDate() + offset)
  return out
}

function parseWeekParam(s: string | undefined): Date {
  if (s) {
    const d = new Date(`${s}T00:00:00.000Z`)
    if (!isNaN(d.getTime())) return isoMondayUTC(d)
  }
  return isoMondayUTC(new Date())
}

/**
 * Synthesize a HarriDailyRow[] from the per-store summary so the existing
 * <LaborWeekKpis> renders aggregated totals without bespoke logic. We only
 * need the actualCost/forecastCost sums; the daily granularity is consumed
 * elsewhere (drill-into-store view).
 */
function aggregateForKpis(rows: HarriStoreWeekRow[]) {
  const totalActual = rows.reduce((a, r) => a + r.actualCost, 0)
  const totalForecast = rows.reduce((a, r) => a + r.forecastCost, 0)
  return [
    {
      date: "all",
      actualCost: totalActual === 0 ? null : totalActual,
      forecastCost: totalForecast === 0 ? null : totalForecast,
      variance: totalForecast === 0 ? null : totalActual - totalForecast,
      variancePct: totalForecast === 0 ? null : (totalActual - totalForecast) / totalForecast,
      alertCount: rows.reduce((a, r) => a + r.alertCount, 0),
    },
  ]
}

export default async function LaborIndexPage(props: {
  searchParams: Promise<{ week?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard")

  const sp = await props.searchParams
  const weekStart = parseWeekParam(sp.week)
  const weekEnd = new Date(weekStart)
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)

  const priorWeekStart = new Date(weekStart)
  priorWeekStart.setUTCDate(priorWeekStart.getUTCDate() - 7)
  const priorWeekEnd = new Date(weekStart)
  priorWeekEnd.setUTCDate(priorWeekEnd.getUTCDate() - 1)

  const weekIso = weekStart.toISOString().slice(0, 10)
  const thisWeekIso = isoMondayUTC(new Date()).toISOString().slice(0, 10)

  const [stores, brands, storesWeek, priorStoresWeek, trend] = await Promise.all([
    prisma.store.findMany({
      where: { accountId: session.user.accountId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.harriBrand.findMany({
      where: { active: true, store: { accountId: session.user.accountId } },
      select: { storeId: true },
    }),
    getHarriStoresWeek(weekStart, weekEnd),
    getHarriStoresWeek(priorWeekStart, priorWeekEnd),
    getHarriTrendAllStores(isoMondayUTC(new Date()), TREND_WEEKS),
  ])

  const brandSet = new Set(brands.map((b) => b.storeId))
  const tabStores: LaborStoreTab[] = stores.map((s) => ({
    id: s.id,
    name: s.name,
    hasBrand: brandSet.has(s.id),
  }))

  const kpiRows = aggregateForKpis(storesWeek)
  const totalAlerts = storesWeek.reduce((a, r) => a + r.alertCount, 0)
  const priorActual = priorStoresWeek.reduce((a, r) => a + r.actualCost, 0) || null
  const totalDaysWithData = storesWeek.reduce(
    (a, r) => a + (r.daysWithData > 0 ? 1 : 0),
    0
  )

  return (
    <main className="labor-shell">
      <header className="labor-shell__header dock-in dock-in-1">
        <div>
          <span className="inv-panel__dept">§ Labor · LiveWire</span>
          <h1 className="labor-shell__title">All stores</h1>
          <div className="labor-shell__folio">
            {brands.length}/{stores.length} stores connected
            {brands.length === 0 ? " · configure a HarriBrand mapping to begin" : ""}
          </div>
        </div>
      </header>

      <div className="dock-in dock-in-2">
        <LaborStoreTabs stores={tabStores} activeStoreId={null} weekIso={weekIso} />
      </div>

      <div className="dock-in dock-in-3">
        <LaborWeekNav
          weekStart={weekIso}
          isCurrentWeek={weekIso === thisWeekIso}
          daysWithData={totalDaysWithData}
        />
      </div>

      <div className="dock-in dock-in-4">
        <LaborWeekKpis
          rows={kpiRows}
          alertsCount={totalAlerts}
          priorWeekActual={priorActual}
        />
      </div>

      <section className="inv-panel dock-in dock-in-5">
        <div className="inv-panel__head">
          <div>
            <span className="inv-panel__dept">§ Stores</span>
            <h2 className="inv-panel__title">Ranked by actual labor.</h2>
          </div>
        </div>
        <LaborStoresPanel rows={storesWeek} weekIso={weekIso} />
      </section>

      <section className="inv-panel dock-in dock-in-6">
        <div className="inv-panel__head">
          <div>
            <span className="inv-panel__dept">§ Trend · {TREND_WEEKS} weeks</span>
            <h2 className="inv-panel__title">Rolling weekly totals across all stores.</h2>
          </div>
        </div>
        <LaborWeekTrend trend={trend} selectedWeek={weekIso} storeId="" />
      </section>
    </main>
  )
}
