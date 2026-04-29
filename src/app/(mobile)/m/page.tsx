import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getStores } from "@/app/actions/store-actions"
import { getHourlyOrderPatterns } from "@/app/actions/hourly-orders-actions"
import { PageHead } from "@/components/mobile/page-head"
import {
  MastheadFigures,
  type MastheadCell,
} from "@/components/mobile/masthead-figures"
import { MToolbar } from "@/components/mobile/m-toolbar"
import { HourlyChart } from "@/components/mobile/hourly-chart"
import { parsePeriod, MOBILE_PERIODS } from "@/lib/mobile/period"

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

  const result = await getHourlyOrderPatterns(
    validStoreId ?? undefined,
    period
  )
  const hourly = result?.hourly ?? []
  const cmp = result?.hourlyComparison ?? null

  const totalOrders = hourly.reduce((s, h) => s + h.orderCount, 0)
  const totalSales = hourly.reduce((s, h) => s + h.totalSales, 0)
  const periodLabel =
    MOBILE_PERIODS.find((p) => p.value === period)?.short ?? "TODAY"

  const cells: MastheadCell[] = [
    {
      label: `NET ${periodLabel}`,
      value: fmtMoney(totalSales),
      sub: cmp?.pacePct != null
        ? `${cmp.pacePct >= 0 ? "+" : ""}${cmp.pacePct.toFixed(0)}% vs prior`
        : "no prior comparison",
    },
    {
      label: "ORDERS",
      value: fmtCount(totalOrders),
      sub: activeStoreName ?? `${stores.length} stores`,
    },
  ]

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
        <HourlyChart data={hourly} metric="sales" showBaseline />
      </div>
    </>
  )
}
