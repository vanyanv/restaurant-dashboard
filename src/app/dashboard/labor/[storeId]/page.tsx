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
import { LaborStoreTabs, type LaborStoreTab } from "../components/labor-store-tabs"
import { LaborWeekNav } from "../components/labor-week-nav"
import { LaborWeekKpis } from "../components/labor-week-kpis"
import { LaborWeekDays } from "../components/labor-week-days"
import { LaborWeekTrend } from "../components/labor-week-trend"
import { isoMondayUTC, parseWeekParam } from "@/lib/labor-week"

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
    select: { id: true, name: true },
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

  const weekStart = parseWeekParam(sp.week)
  const weekEnd = new Date(weekStart)
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)

  const priorWeekStart = new Date(weekStart)
  priorWeekStart.setUTCDate(priorWeekStart.getUTCDate() - 7)
  const priorWeekEnd = new Date(weekStart)
  priorWeekEnd.setUTCDate(priorWeekEnd.getUTCDate() - 1)

  const thisWeekIso = isoMondayUTC(new Date()).toISOString().slice(0, 10)
  const weekIso = weekStart.toISOString().slice(0, 10)

  const [daily, alerts, prior, trend] = await Promise.all([
    getHarriDailyLabor(store.id, weekStart, weekEnd),
    getHarriAlerts(store.id, weekStart, weekEnd),
    getHarriDailyLabor(store.id, priorWeekStart, priorWeekEnd),
    getHarriTrend(store.id, isoMondayUTC(new Date()), TREND_WEEKS),
  ])

  const alertsByDate: Record<string, typeof alerts> = {}
  for (const a of alerts) {
    if (!alertsByDate[a.date]) alertsByDate[a.date] = []
    alertsByDate[a.date].push(a)
  }
  const priorWeekActual = prior.reduce((a, r) => a + (r.actualCost ?? 0), 0) || null
  const daysWithData = daily.filter((r) => r.actualCost != null).length

  return (
    <main className="labor-shell">
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

      <div className="dock-in dock-in-3">
        <LaborWeekNav
          weekStart={weekIso}
          isCurrentWeek={weekIso === thisWeekIso}
          daysWithData={daysWithData}
        />
      </div>

      <div className="dock-in dock-in-4">
        <LaborWeekKpis
          rows={daily}
          alertsCount={alerts.length}
          priorWeekActual={priorWeekActual}
        />
      </div>

      <section className="inv-panel dock-in dock-in-5">
        <div className="inv-panel__head">
          <div>
            <span className="inv-panel__dept">§ Day-by-day</span>
            <h2 className="inv-panel__title">Actual vs forecast. Open a day for clock anomalies.</h2>
          </div>
        </div>
        <LaborWeekDays
          weekStart={weekIso}
          rows={daily}
          alertsByDate={alertsByDate}
        />
      </section>

      <section className="inv-panel dock-in dock-in-6">
        <div className="inv-panel__head">
          <div>
            <span className="inv-panel__dept">§ Trend · {TREND_WEEKS} weeks</span>
            <h2 className="inv-panel__title">Rolling weekly totals</h2>
          </div>
        </div>
        <LaborWeekTrend trend={trend} selectedWeek={weekIso} storeId={store.id} />
      </section>
    </main>
  )
}
