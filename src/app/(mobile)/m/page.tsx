import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { PageHead } from "@/components/mobile/page-head"
import {
  MastheadFigures,
  type MastheadCell,
} from "@/components/mobile/masthead-figures"
import { MToolbar } from "@/components/mobile/m-toolbar"
import { HourlyChart } from "@/components/mobile/hourly-chart"
import { DailyRevenueChart } from "@/components/mobile/daily-revenue-chart"
import {
  parseMobileRange,
  periodToDateRange,
  MOBILE_PERIODS,
} from "@/lib/mobile/period"
import { todayInLA } from "@/lib/dashboard-utils"
import {
  getMobileHomeSnapshot,
  trailingRevenueStart,
} from "@/lib/mobile/snapshots"

export const dynamic = "force-dynamic"

const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

const fmtCount = (n: number) => n.toLocaleString("en-US")

const fmtTodayTitle = () => {
  const today = new Date()
  return today.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  })
}

const PERIOD_TITLE: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "this-week": "This week",
  "last-week": "Last week",
}

export default async function MobileHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sp = await searchParams
  const range = parseMobileRange({ period: sp.period, start: sp.start, end: sp.end })
  const storeId = sp.store && sp.store !== "" ? sp.store : null

  // Period totals come from `otterDailySummary` (same source the desktop uses)
  // so the masthead never shows a stale zero just because the hourly precompute
  // table is behind. The 14-day chart trails the period's end so a yesterday
  // selection still gives meaningful context.
  const window =
    range.kind === "custom"
      ? { startDate: range.start, endDate: range.end }
      : (() => {
          const r = periodToDateRange(range.period)
          return { startDate: r.startDate, endDate: r.endDate }
        })()
  const periodStart = window.startDate.toISOString().slice(0, 10)
  const periodEnd = window.endDate.toISOString().slice(0, 10)
  const trendEnd = periodEnd
  const trendStart = trailingRevenueStart(trendEnd)

  const snapshot = await getMobileHomeSnapshot({
    storeId,
    periodStart,
    periodEnd,
    trendStart,
    trendEnd,
    hourlyPeriod: range.kind === "named" ? range.period : null,
  })

  const stores = snapshot?.stores ?? []
  const validStoreId = snapshot?.validStoreId ?? null
  const activeStoreName = snapshot?.activeStoreName ?? null
  const totalSales = snapshot?.totalSales ?? 0
  const totalOrders = snapshot?.totalOrders ?? 0
  const netGrowth = snapshot?.netGrowth ?? null
  const previousNet = snapshot?.previousNet ?? 0

  const periodLabel =
    range.kind === "named"
      ? (MOBILE_PERIODS.find((p) => p.value === range.period)?.short ?? "TODAY")
      : "CUSTOM"

  const cells: MastheadCell[] = [
    {
      label: `NET ${periodLabel}`,
      value: fmtMoney(totalSales),
      sub:
        netGrowth != null && previousNet > 0
          ? `${netGrowth >= 0 ? "+" : ""}${netGrowth.toFixed(0)}% vs prior`
          : "no prior comparison",
    },
    {
      label: "ORDERS",
      value: fmtCount(totalOrders),
      sub: activeStoreName ?? `${stores.length} stores`,
    },
  ]

  const trendIsTrailing = trendEnd === todayInLA()
  const trendLabel = trendIsTrailing
    ? "DAILY REVENUE · LAST 14D"
    : `DAILY REVENUE · 14D TO ${range.kind === "named" ? periodLabel : periodEnd}`

  return (
    <div data-perf-ready="/m">
      <MToolbar
        pathname="/m"
        searchParams={sp}
        stores={stores.map((s) => ({ id: s.id, name: s.name }))}
        storeId={validStoreId}
        range={range}
      />

      <PageHead
        dept="DAILY EDITION"
        title={
          range.kind === "named" && range.period === "today"
            ? fmtTodayTitle()
            : range.kind === "named"
            ? (PERIOD_TITLE[range.period] ?? "Today")
            : "Custom range"
        }
        sub={
          activeStoreName
            ? `${activeStoreName} · late edition`
            : `All stores · late edition`
        }
      />

      <MastheadFigures cells={cells} />

      {range.kind === "named" && (
        <div style={{ marginTop: 14 }}>
          <HourlyChart data={snapshot?.hourly ?? []} metric="orders" showBaseline />
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <DailyRevenueChart
          data={snapshot?.dailyTrends ?? []}
          label={trendLabel}
        />
      </div>
    </div>
  )
}
