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
import { LaborVerdict } from "./components/labor-verdict"
import { LaborLeakLedger } from "./components/labor-leak-ledger"
import { LaborStoresPanel } from "./components/labor-stores-panel"
import { LaborWeekTrend } from "./components/labor-week-trend"
import { LaborStaffingCurve } from "./components/labor-staffing-curve"
import { LaborDayScorecard } from "./components/labor-day-scorecard"
import { LaborPositionMix } from "./components/labor-position-mix"
import { getLaborProductivity } from "@/app/actions/labor-productivity-actions"

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

  const productivity = await getLaborProductivity(weekStart, weekEnd)

  const brandSet = new Set(brands.map((b) => b.storeId))
  const tabStores: LaborStoreTab[] = stores.map((s) => ({
    id: s.id,
    name: s.name,
    hasBrand: brandSet.has(s.id),
  }))

  const kpiRows = aggregateForKpis(storesWeek)
  const totalAlerts = storesWeek.reduce((a, r) => a + r.alertCount, 0)
  const priorActual = priorStoresWeek.reduce((a, r) => a + r.actualCost, 0) || null
  // Days of the week that have labor data anywhere, not the number of stores
  // reporting — the nav renders this as "n/7 days recorded", so summing a
  // per-store boolean made a fully-recorded week read as "1/7".
  const totalDaysWithData = storesWeek.reduce(
    (a, r) => Math.max(a, r.daysWithData),
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

      {/* The verdict replaces the KPI grid: eight equal tiles made the reader
          rank the numbers, which is the job this page should do for them. The
          old strip stays as the fallback for weeks with cost but no hours. */}
      <div className="dock-in dock-in-4">
        {productivity && productivity.totals.actualHours > 0 ? (
          <LaborVerdict
            totals={productivity.totals}
            drift={productivity.drift}
            costVariance={
              kpiRows.reduce((a, r) => a + (r.actualCost ?? 0), 0) -
              kpiRows.reduce((a, r) => a + (r.forecastCost ?? 0), 0)
            }
          />
        ) : (
          <LaborWeekKpis
            rows={kpiRows}
            alertsCount={totalAlerts}
            priorWeekActual={priorActual}
          />
        )}
      </div>

      {productivity ? (
        <section className="labor-lede dock-in dock-in-4">
          <div className="labor-lede__head">
            <span className="labor-lede__dept">§ Where it went · ranked by cost</span>
          </div>
          <h2 className="labor-lede__title">
            What to change before next week&rsquo;s schedule goes out.
          </h2>
          <LaborLeakLedger leaks={productivity.leaks} />
        </section>
      ) : null}

      {/* The staffing curve leads because it is the only view that shows
          WHERE inside a day the hours went. Everything below it is daily or
          weekly and cannot answer that. */}
      {/* Curve and position mix share a row: the curve needs width for a
          24-bar axis, the mix is three lines. Equal-width stacking wasted
          both. */}
      {productivity ? (
        <div className="labor-grid dock-in dock-in-5">
          <section className="inv-panel">
            <div className="inv-panel__head">
              <div>
                <span className="inv-panel__dept">§ Staffing curve · hour of day</span>
                <h2 className="inv-panel__title">
                  Where the hours went, against the sales they covered.
                </h2>
              </div>
            </div>
            <LaborStaffingCurve
              hours={productivity.staffing}
              blendedRate={productivity.blendedRate}
            />
          </section>

          {productivity.positions.length > 0 ? (
            <section className="inv-panel">
              <div className="inv-panel__head">
                <div>
                  <span className="inv-panel__dept">§ Position mix</span>
                </div>
              </div>
              <LaborPositionMix rows={productivity.positions} />
            </section>
          ) : null}
        </div>
      ) : null}

      {productivity ? (
        <section className="inv-panel dock-in dock-in-5">
          <div className="inv-panel__head">
            <div>
              <span className="inv-panel__dept">§ Day scorecard</span>
              <h2 className="inv-panel__title">
                Hours worked against hours the sales earned.
              </h2>
            </div>
          </div>
          <LaborDayScorecard rows={productivity.scorecard} totals={productivity.totals} />
        </section>
      ) : null}

      {/* Context row. Both are reference material, so they close the page
          side by side rather than each claiming full width. */}
      <div className="labor-grid dock-in dock-in-6">
        <section className="inv-panel">
          <div className="inv-panel__head">
            <div>
              <span className="inv-panel__dept">§ Trend · {TREND_WEEKS} weeks</span>
              <h2 className="inv-panel__title">Rolling weekly totals.</h2>
            </div>
          </div>
          <LaborWeekTrend trend={trend} selectedWeek={weekIso} storeId="" />
        </section>

        <section className="inv-panel">
          <div className="inv-panel__head">
            <div>
              <span className="inv-panel__dept">§ Stores</span>
            </div>
          </div>
          <LaborStoresPanel rows={storesWeek} weekIso={weekIso} />
        </section>
      </div>
    </main>
  )
}
