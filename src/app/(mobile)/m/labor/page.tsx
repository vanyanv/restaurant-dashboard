import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getStores } from "@/app/actions/store/crud-actions"
import {
  getHarriDailyLabor,
  getHarriAlerts,
  type HarriDailyRow,
  type HarriAlertRow,
} from "@/app/actions/harri-actions"
import {
  isoMondayUTC,
  parseWeekParam,
  addDaysUTC,
  isoDate,
} from "@/lib/labor-week"
import { PageHead } from "@/components/mobile/page-head"
import {
  MastheadFigures,
  type MastheadCell,
} from "@/components/mobile/masthead-figures"
import { MobileStoreSelect } from "@/components/mobile/m-store-select"
import { Panel } from "@/components/mobile/panel"
import { LaborWeekStrip } from "@/components/mobile/labor-week-strip"
import { LaborPositionList } from "@/components/mobile/labor-position-list"
import { MLaborWeekNav } from "@/components/mobile/m-labor-week-nav"
import { MLaborDayRows } from "@/components/mobile/m-labor-day-rows"

export const dynamic = "force-dynamic"

const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

const fmtPct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`

const fmtRangeShort = (weekStartIso: string): string => {
  const start = new Date(`${weekStartIso}T00:00:00.000Z`)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 6)
  const f = (d: Date) =>
    d.toLocaleDateString("en-US", {
      month: "numeric",
      day: "numeric",
      timeZone: "UTC",
    })
  return `${f(start)}–${f(end)}`
}

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

  const weekStart = parseWeekParam(sp.week)
  const weekEnd = addDaysUTC(weekStart, 6)
  const weekEndOfDay = new Date(weekEnd)
  weekEndOfDay.setUTCHours(23, 59, 59, 999)

  const priorWeekStart = addDaysUTC(weekStart, -7)
  const priorWeekEnd = addDaysUTC(weekStart, -1)
  const priorWeekEndOfDay = new Date(priorWeekEnd)
  priorWeekEndOfDay.setUTCHours(23, 59, 59, 999)

  const thisWeekIso = isoDate(isoMondayUTC(new Date()))
  const weekIso = isoDate(weekStart)
  const isCurrentWeek = weekIso === thisWeekIso

  // Harri's positions endpoint 500s on most dates (gateway-side issue, see
  // JobRun.metadata.positionsFailures). Show the most-recent date we have
  // any rows for instead of strictly today, so the panel isn't usually empty.
  const latestPositionsRow = await prisma.harriPositionDaily.findFirst({
    where: { storeId },
    orderBy: { date: "desc" },
    select: { date: true },
  })
  const positionsDate = latestPositionsRow?.date ?? null

  const [weekRows, alerts, priorRows, positions]: [
    HarriDailyRow[],
    HarriAlertRow[],
    HarriDailyRow[],
    Array<{
      id: string
      categoryName: string | null
      categoryCode: string
      positionName: string | null
      positionCode: string
      totalLabor: number | null
      overtimeAmount: number | null
      actualSeconds: number | null
    }>,
  ] = await Promise.all([
    getHarriDailyLabor(storeId, weekStart, weekEndOfDay),
    getHarriAlerts(storeId, weekStart, weekEndOfDay),
    getHarriDailyLabor(storeId, priorWeekStart, priorWeekEndOfDay),
    positionsDate
      ? prisma.harriPositionDaily.findMany({
          where: { storeId, date: positionsDate },
          select: {
            id: true,
            categoryName: true,
            categoryCode: true,
            positionName: true,
            positionCode: true,
            totalLabor: true,
            overtimeAmount: true,
            actualSeconds: true,
          },
          orderBy: [{ totalLabor: "desc" }],
        })
      : Promise.resolve([]),
  ])

  const totalActual = weekRows.reduce((s, r) => s + (r.actualCost ?? 0), 0)
  const totalForecast = weekRows.reduce((s, r) => s + (r.forecastCost ?? 0), 0)
  const variance = totalActual - totalForecast
  const variancePct = totalForecast === 0 ? null : variance / totalForecast
  const overbudget = variancePct != null && variancePct > 0.05

  const priorActual = priorRows.reduce((s, r) => s + (r.actualCost ?? 0), 0)
  const hasPrior = priorRows.some((r) => r.actualCost != null) && priorActual > 0
  const wowDelta = hasPrior ? (totalActual - priorActual) / priorActual : null
  const wowOverbudget = wowDelta != null && wowDelta > 0.05

  const daysWithData = weekRows.filter((r) => r.actualCost != null).length

  const alertsByDate: Record<string, HarriAlertRow[]> = {}
  for (const a of alerts) {
    if (!alertsByDate[a.date]) alertsByDate[a.date] = []
    alertsByDate[a.date].push(a)
  }

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

  const positionRows = positions.map((p) => ({
    id: p.id,
    category: p.categoryName ?? p.categoryCode,
    position: p.positionName ?? p.positionCode,
    hours: p.actualSeconds != null ? p.actualSeconds / 3600 : null,
    totalLabor: p.totalLabor,
    overtimeAmount: p.overtimeAmount,
  }))
  const positionsDateKey = positionsDate ? isoDate(positionsDate) : null
  const todayKey = isoDate(new Date())
  const positionsHeader = positionsDateKey
    ? positionsDateKey === todayKey
      ? `POSITIONS · ${positionsDateKey} · ${positionRows.length} ROW${positionRows.length === 1 ? "" : "S"}`
      : `POSITIONS · LATEST AVAILABLE · ${positionsDateKey} · ${positionRows.length} ROW${positionRows.length === 1 ? "" : "S"}`
    : `POSITIONS · UNAVAILABLE`

  const weekRangeShort = fmtRangeShort(weekIso)

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
        <Panel dept={`ACTUAL VS FORECAST · ${weekRangeShort}`}>
          <LaborWeekStrip
            rows={weekRows}
            label={`ACTUAL VS FORECAST · ${weekRangeShort}`}
          />
        </Panel>
      </div>

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
        <Panel dept={positionsHeader}>
          <LaborPositionList rows={positionRows} />
        </Panel>
      </div>
    </div>
  )
}
