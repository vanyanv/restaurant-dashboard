import { formatCurrencyWhole as fmtMoney } from "@/lib/format"
import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getStores } from "@/app/actions/store/crud-actions"
import {
  getHarriDailyLabor,
  getHarriAlerts,
  type HarriDailyRow,
  type HarriAlertRow,
} from "@/app/actions/harri-actions"
import {
  buildLaborWeekWindow,
  aggregateLaborWeek,
  groupAlertsByDate,
} from "@/lib/labor-week"
import { PageHead } from "@/components/mobile/page-head"
import {
  MastheadFigures,
  type MastheadCell,
} from "@/components/mobile/masthead-figures"
import { MobileStoreSelect } from "@/components/mobile/m-store-select"
import { Panel } from "@/components/mobile/panel"
import { MLaborWeekNav } from "@/components/mobile/m-labor-week-nav"
import { MLaborDayRows } from "@/components/mobile/m-labor-day-rows"
import { SwitchToDesktopButton } from "@/app/(mobile)/m/more/switch-to-desktop"

export const dynamic = "force-dynamic"

const fmtPct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`

export default async function MobileLaborPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/m")

  const sp = await searchParams
  const requestedStoreId = sp.store && sp.store !== "" ? sp.store : null

  const stores = await getStores()
  if (stores.length === 0) {
    return (
      <div>
        <PageHead dept="INTELLIGENCE" title="Labor" sub="No stores configured" />
        <div className="inv-panel inv-panel--empty">
          Create a store before labor data can sync.
        </div>
      </div>
    )
  }

  // Labor is single-store (Harri brand mapping is per-store). Default to the
  // first store when nothing is selected so the page always renders.
  const storeId =
    requestedStoreId && stores.some((s) => s.id === requestedStoreId)
      ? requestedStoreId
      : stores[0].id
  const activeStore = stores.find((s) => s.id === storeId)!

  // weekEnd is day 7 at UTC midnight — HarriDailyLabor.date is @db.Date so
  // lte-midnight includes the final day (same rows the old 23:59:59.999
  // end-of-day bound returned).
  const { weekStart, weekEnd, priorWeekStart, priorWeekEnd, weekIso, thisWeekIso, isCurrentWeek } =
    buildLaborWeekWindow(sp.week)

  const [weekRows, alerts, priorRows]: [
    HarriDailyRow[],
    HarriAlertRow[],
    HarriDailyRow[],
  ] = await Promise.all([
    getHarriDailyLabor(storeId, weekStart, weekEnd),
    getHarriAlerts(storeId, weekStart, weekEnd),
    getHarriDailyLabor(storeId, priorWeekStart, priorWeekEnd),
  ])

  const {
    totalActual,
    totalForecast,
    variance,
    variancePct,
    overbudget,
    daysWithData,
    priorActual,
    hasPrior,
    wowDelta,
    wowOverbudget,
  } = aggregateLaborWeek(weekRows, priorRows)

  const alertsByDate = groupAlertsByDate(alerts)

  const cells: MastheadCell[] = [
    {
      label: "ACTUAL · WEEK",
      value: fmtMoney(totalActual),
      sub: isCurrentWeek
        ? `${daysWithData}/7 days · in progress`
        : daysWithData === 7
          ? "closed week"
          : `${daysWithData}/7 days recorded`,
    },
    {
      label: "VS LAST WEEK",
      value: hasPrior ? (
        <span style={{ color: wowOverbudget ? "var(--accent)" : "var(--ink)" }}>
          {fmtPct(wowDelta)}
        </span>
      ) : (
        "—"
      ),
      sub: hasPrior ? `vs ${fmtMoney(priorActual)} prior` : "no prior data",
    },
    {
      label: "VARIANCE",
      value: (
        <span style={{ color: overbudget ? "var(--accent)" : "var(--ink)" }}>
          {fmtPct(variancePct)}
        </span>
      ),
      sub:
        totalForecast === 0
          ? "no forecast"
          : `${variance >= 0 ? "+" : "-"}${fmtMoney(Math.abs(variance))} vs forecast`,
    },
  ]

  return (
    <div data-perf-ready="/m/labor">
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
          storeId={storeId}
          pathname="/m/labor"
          searchParams={sp}
        />
      </div>

      <PageHead
        dept="INTELLIGENCE · § LABOR"
        title={isCurrentWeek ? "This week's labor" : "Week labor"}
        sub={`${activeStore.name} · Harri sync`}
      />

      <MastheadFigures cells={cells} />

      <MLaborWeekNav
        weekStart={weekIso}
        thisWeek={thisWeekIso}
        isCurrentWeek={isCurrentWeek}
        daysWithData={daysWithData}
      />

      <div style={{ marginTop: 14 }}>
        <Panel
          dept={`DAY-BY-DAY · ${alerts.length} ALERT${alerts.length === 1 ? "" : "S"}`}
        >
          <MLaborDayRows
            weekStart={weekIso}
            rows={weekRows}
            alertsByDate={alertsByDate}
          />
        </Panel>
      </div>

      <div style={{ marginTop: 14 }}>
        <Panel dept="INTELLIGENCE" title="Positions & trend">
          <p
            style={{
              fontSize: 13,
              color: "var(--ink-muted)",
              lineHeight: 1.6,
              margin: "0 0 12px",
            }}
          >
            Per-position breakdowns and the actual-vs-forecast trend chart
            are a desktop view.
          </p>
          <SwitchToDesktopButton
            target="/dashboard/labor"
            label="Full labor detail on desktop →"
          />
        </Panel>
      </div>
    </div>
  )
}
