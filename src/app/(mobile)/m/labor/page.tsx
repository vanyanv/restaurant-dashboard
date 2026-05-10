import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getStores } from "@/app/actions/store/crud-actions"
import {
  getHarriDailyLabor,
  getHarriAlerts,
  type HarriDailyRow,
} from "@/app/actions/harri-actions"
import { PageHead } from "@/components/mobile/page-head"
import {
  MastheadFigures,
  type MastheadCell,
} from "@/components/mobile/masthead-figures"
import { MobileStoreSelect } from "@/components/mobile/m-store-select"
import { Panel } from "@/components/mobile/panel"
import { LaborWeekStrip } from "@/components/mobile/labor-week-strip"
import { LaborPositionList } from "@/components/mobile/labor-position-list"
import { LaborAlertsList } from "@/components/mobile/labor-alerts-list"

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

function startOfDayUTC(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(0, 0, 0, 0)
  return out
}

function todayUtc(): Date {
  const now = new Date()
  return startOfDayUTC(now)
}

function daysAgoUtc(n: number): Date {
  const out = todayUtc()
  out.setUTCDate(out.getUTCDate() - n)
  return out
}

function endOfDayUtc(d: Date): Date {
  const out = new Date(d)
  out.setUTCHours(23, 59, 59, 999)
  return out
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

  const today = todayUtc()
  const sevenDaysAgo = daysAgoUtc(6)

  const [weeklyRows, alerts, positionsToday]: [
    HarriDailyRow[],
    Awaited<ReturnType<typeof getHarriAlerts>>,
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
    getHarriDailyLabor(storeId, sevenDaysAgo, endOfDayUtc(today)),
    getHarriAlerts(storeId, daysAgoUtc(13), endOfDayUtc(today)),
    prisma.harriPositionDaily.findMany({
      where: { storeId, date: today },
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
    }),
  ])

  const todayKey = today.toISOString().slice(0, 10)
  const todayRow = weeklyRows.find((r) => r.date === todayKey) ?? null
  const actualToday = todayRow?.actualCost ?? null
  const forecastToday = todayRow?.forecastCost ?? null
  const variancePct = todayRow?.variancePct ?? null
  const overbudget = variancePct != null && variancePct > 0.05

  const cells: MastheadCell[] = [
    {
      label: "ACTUAL · TODAY",
      value: actualToday != null ? fmtMoney(actualToday) : "—",
      sub:
        forecastToday != null ? `vs ${fmtMoney(forecastToday)} forecast` : "no forecast",
    },
    {
      label: "VARIANCE",
      value: (
        <span
          style={{
            color: overbudget ? "var(--accent)" : "var(--ink)",
          }}
        >
          {fmtPct(variancePct)}
        </span>
      ),
      sub:
        variancePct == null
          ? "no comparison"
          : overbudget
            ? "over budget"
            : "within band",
    },
    {
      label: "ALERTS · 14D",
      value: alerts.length.toLocaleString("en-US"),
      sub: `${alerts.filter((a) => a.alertCode.includes("MISSED")).length} missed`,
    },
  ]

  const positionRows = positionsToday.map((p) => ({
    id: p.id,
    category: p.categoryName ?? p.categoryCode,
    position: p.positionName ?? p.positionCode,
    hours: p.actualSeconds != null ? p.actualSeconds / 3600 : null,
    totalLabor: p.totalLabor,
    overtimeAmount: p.overtimeAmount,
  }))

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
        title="Today's labor"
        sub={`${activeStore.name} · Harri sync`}
      />

      <MastheadFigures cells={cells} />

      <div style={{ marginTop: 14 }}>
        <Panel dept="ACTUAL VS FORECAST · LAST 7D">
          <LaborWeekStrip rows={weeklyRows} label="ACTUAL VS FORECAST" />
        </Panel>
      </div>

      <div style={{ marginTop: 14 }}>
        <Panel
          dept={`POSITIONS · ${todayKey} · ${positionRows.length} ROW${positionRows.length === 1 ? "" : "S"}`}
        >
          <LaborPositionList rows={positionRows} />
        </Panel>
      </div>

      <div style={{ marginTop: 14 }}>
        <Panel
          dept={`TIMEKEEPING ALERTS · 14D · ${alerts.length} TOTAL`}
        >
          <LaborAlertsList alerts={alerts} limit={30} />
        </Panel>
      </div>
    </div>
  )
}
