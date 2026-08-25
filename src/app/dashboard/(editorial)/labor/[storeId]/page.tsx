import { redirect, notFound } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import "../labor.css"
import {
  getHarriDailyLabor,
  getHarriAlerts,
  getHarriTrend,
} from "@/app/actions/harri-actions"
import { getLaborProductivity } from "@/app/actions/labor-productivity-actions"
import { LaborStoreTabs, type LaborStoreTab } from "../components/labor-store-tabs"
import { LaborWeekNav } from "../components/labor-week-nav"
import { LaborWeekKpis } from "../components/labor-week-kpis"
import { LaborWeekDays } from "../components/labor-week-days"
import { LaborWeekTrend } from "../components/labor-week-trend"
import { LaborVerdict } from "../components/labor-verdict"
import { LaborLeakLedger } from "../components/labor-leak-ledger"
import { LaborStaffingCurve } from "../components/labor-staffing-curve"
import { LaborDayScorecard } from "../components/labor-day-scorecard"
import { LaborPositionMix } from "../components/labor-position-mix"
import {
  isoMondayUTC,
  buildLaborWeekWindow,
  aggregateLaborWeek,
  groupAlertsByDate,
} from "@/lib/labor-week"

const TREND_WEEKS = 13

export default async function StoreLaborPage(props: {
  params: Promise<{ storeId: string }>
  searchParams: Promise<{ week?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard")

  const { storeId } = await props.params
  const sp = await props.searchParams

  const store = await prisma.store.findFirst({
    where: { id: storeId, accountId: session.user.accountId },
    select: { id: true, name: true, lifecycleStage: true, openedAt: true },
  })
  if (!store) notFound()

  const [harriBrand, allStores, allBrands] = await Promise.all([
    prisma.harriBrand.findFirst({
      where: { storeId: store.id, active: true },
      select: { brandId: true, lastSyncAt: true },
    }),
    prisma.store.findMany({
      where: { accountId: session.user.accountId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.harriBrand.findMany({
      where: { active: true, store: { accountId: session.user.accountId } },
      select: { storeId: true },
    }),
  ])
  const brandSet = new Set(allBrands.map((b) => b.storeId))
  const tabStores: LaborStoreTab[] = allStores.map((s) => ({
    id: s.id,
    name: s.name,
    hasBrand: brandSet.has(s.id),
  }))

  const { weekStart, weekEnd, priorWeekStart, priorWeekEnd, weekIso, thisWeekIso } =
    buildLaborWeekWindow(sp.week)

  const header = (
    <>
      <header className="labor-shell__header dock-in dock-in-1">
        <div>
          <span className="inv-panel__dept">§ Labor · LiveWire</span>
          <h1 className="labor-shell__title">{store.name}</h1>
          <div className="labor-shell__folio">
            {harriBrand
              ? `brand ${harriBrand.brandId}${harriBrand.lastSyncAt ? ` · synced ${new Date(harriBrand.lastSyncAt).toLocaleString()}` : ""}`
              : "no Harri brand mapped"}
          </div>
        </div>
      </header>

      <div className="dock-in dock-in-2">
        <LaborStoreTabs stores={tabStores} activeStoreId={store.id} weekIso={weekIso} />
      </div>
    </>
  )

  // A store that has not opened has no brand, no punches and no schedule.
  // Rendering the full report as a column of empty panels would read as
  // breakage; say plainly what is missing and what will fill it.
  if (!harriBrand) {
    return (
      <main className="labor-shell">
        {header}
        <section className="labor-lede dock-in dock-in-3">
          <div className="labor-lede__head">
            <span className="labor-lede__dept">§ Not yet reporting</span>
          </div>
          <p className="labor-empty-lede">
            {store.name} has no Harri brand mapped, so there are no punches,
            no schedule and no labor cost to report
            {store.lifecycleStage === "pre_open" ? " — it has not opened yet" : ""}.
          </p>
          <p className="labor-empty-note">
            Map a HarriBrand row for this store and the sync backfills the week
            automatically. Everything on the all-stores page — the verdict, the
            leak ledger, the staffing curve and the day scorecard — appears here
            the moment hours land.
          </p>
        </section>
      </main>
    )
  }

  const [daily, alerts, prior, trend, productivity] = await Promise.all([
    getHarriDailyLabor(store.id, weekStart, weekEnd),
    getHarriAlerts(store.id, weekStart, weekEnd),
    getHarriDailyLabor(store.id, priorWeekStart, priorWeekEnd),
    getHarriTrend(store.id, isoMondayUTC(new Date()), TREND_WEEKS),
    getLaborProductivity(weekStart, weekEnd, store.id),
  ])

  const alertsByDate = groupAlertsByDate(alerts)
  const agg = aggregateLaborWeek(daily, prior)
  const priorWeekActual = agg.priorActual || null
  const hasHours = !!productivity && productivity.totals.actualHours > 0

  return (
    <main className="labor-shell">
      {header}

      <div className="dock-in dock-in-3">
        <LaborWeekNav
          weekStart={weekIso}
          isCurrentWeek={weekIso === thisWeekIso}
          daysWithData={agg.daysWithData}
        />
      </div>

      {/* Same arc as the all-stores page: verdict, what to change, then the
          evidence. The old KPI strip stays as the fallback for a store that
          reports cost but no hours yet. */}
      <div className="dock-in dock-in-4">
        {hasHours && productivity ? (
          <LaborVerdict
            totals={productivity.totals}
            drift={productivity.drift}
            costVariance={agg.variance}
          />
        ) : (
          <LaborWeekKpis
            rows={daily}
            alertsCount={alerts.length}
            priorWeekActual={priorWeekActual}
          />
        )}
      </div>

      {hasHours && productivity ? (
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

      {hasHours && productivity ? (
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

      {hasHours && productivity ? (
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

      {/* The per-store extra: cost per day with the clock anomalies behind it.
          This is the drill-down for the clock-drift leak above, which is why it
          sits after the scorecard rather than replacing it. */}
      <div className="labor-grid labor-grid--even dock-in dock-in-6">
        <section className="inv-panel">
          <div className="inv-panel__head">
            <div>
              <span className="inv-panel__dept">§ Day-by-day</span>
              <h2 className="inv-panel__title">
                Cost against forecast. Open a day for the punches behind it.
              </h2>
            </div>
          </div>
          <LaborWeekDays weekStart={weekIso} rows={daily} alertsByDate={alertsByDate} />
        </section>

        <section className="inv-panel">
          <div className="inv-panel__head">
            <div>
              <span className="inv-panel__dept">§ Trend · {TREND_WEEKS} weeks</span>
            </div>
          </div>
          <LaborWeekTrend trend={trend} selectedWeek={weekIso} storeId={store.id} />
        </section>
      </div>
    </main>
  )
}
