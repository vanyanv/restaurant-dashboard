import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getStores, getOtterAnalytics } from "@/app/actions/store-actions"
import { getHourlyOrderPatterns } from "@/app/actions/hourly-orders-actions"
import { PageHead } from "@/components/mobile/page-head"
import {
  MastheadFigures,
  type MastheadCell,
} from "@/components/mobile/masthead-figures"
import { MToolbar } from "@/components/mobile/m-toolbar"
import { HourlyChart } from "@/components/mobile/hourly-chart"
import { DailyRevenueChart } from "@/components/mobile/daily-revenue-chart"
import { parsePeriod, MOBILE_PERIODS, periodDateStrings } from "@/lib/mobile/period"
import { todayInLA } from "@/lib/dashboard-utils"
import { laDateMinusDays } from "@/lib/hourly-orders"

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
  const period = parsePeriod(sp.period)
  const storeId = sp.store && sp.store !== "" ? sp.store : null

  const stores = await getStores()
  const validStoreId = storeId && stores.some((s) => s.id === storeId)
    ? storeId
    : null
  const activeStoreName = validStoreId
    ? stores.find((s) => s.id === validStoreId)?.name ?? null
    : null

  // Period totals come from `otterDailySummary` (same source the desktop uses)
  // so the masthead never shows a stale zero just because the hourly precompute
  // table is behind. The 14-day chart trails the period's end so a yesterday
  // selection still gives meaningful context.
  const periodDates = periodDateStrings(period)
  const periodStart = periodDates[0]
  const periodEnd = periodDates[periodDates.length - 1]
  const trendEnd = periodEnd
  const trendStart = laDateMinusDays(trendEnd, 13)

  const [hourlyResult, otterPeriod, otterTrend] = await Promise.all([
    getHourlyOrderPatterns(validStoreId ?? undefined, period),
    getOtterAnalytics(validStoreId ?? undefined, {
      startDate: periodStart,
      endDate: periodEnd,
    }),
    getOtterAnalytics(validStoreId ?? undefined, {
      startDate: trendStart,
      endDate: trendEnd,
    }),
  ])

  const hourly = hourlyResult?.hourly ?? []

  const totalSales = otterPeriod?.kpis.netRevenue ?? 0
  const totalOrders = otterPeriod?.kpis.totalOrders ?? 0
  const netGrowth = otterPeriod?.comparison.netGrowth ?? null
  const previousNet = otterPeriod?.comparison.previousNet ?? 0

  const periodLabel =
    MOBILE_PERIODS.find((p) => p.value === period)?.short ?? "TODAY"

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
    : `DAILY REVENUE · 14D TO ${periodLabel}`

  return (
    <>
      <MToolbar
        pathname="/m"
        searchParams={sp}
        stores={stores.map((s) => ({ id: s.id, name: s.name }))}
        storeId={validStoreId}
        period={period}
      />

      <PageHead
        dept="DAILY EDITION"
        title={
          period === "today"
            ? fmtTodayTitle()
            : (PERIOD_TITLE[period] ?? "Today")
        }
        sub={
          activeStoreName
            ? `${activeStoreName} · late edition`
            : `All stores · late edition`
        }
      />

      <MastheadFigures cells={cells} />

      <div style={{ marginTop: 14 }}>
        <HourlyChart data={hourly} metric="orders" showBaseline />
      </div>

      <div style={{ marginTop: 14 }}>
        <DailyRevenueChart
          data={otterTrend?.dailyTrends ?? []}
          label={trendLabel}
        />
      </div>
    </>
  )
}
