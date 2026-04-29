import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import {
  getRevenueTrendData,
  getStores,
} from "@/app/actions/store-actions"
import { PageHead } from "@/components/mobile/page-head"
import {
  MastheadFigures,
  type MastheadCell,
} from "@/components/mobile/masthead-figures"
import { Panel } from "@/components/mobile/panel"
import { MToolbar } from "@/components/mobile/m-toolbar"
import { parsePeriod, periodDateStrings, MOBILE_PERIODS } from "@/lib/mobile/period"

export const dynamic = "force-dynamic"

const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

const fmtDate = (iso: string) => {
  const d = new Date(iso + "T12:00:00")
  return d.toLocaleDateString("en-US", { weekday: "short", day: "numeric" })
}

export default async function MobileAnalyticsPage({
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

  // The trend action is owner-wide today (no per-store filter). We pull
  // enough history to cover the period window — last-week + this-week
  // means up to 14 days back is sufficient for any of the four periods.
  const trend = await getRevenueTrendData({ days: 14 })
  const all = trend?.dailyTrends ?? []
  const wantedDates = new Set(periodDateStrings(period))
  const days = all.filter((d) => wantedDates.has(d.date))

  const totalNet = days.reduce((s, d) => s + d.netRevenue, 0)
  const totalGross = days.reduce((s, d) => s + d.grossRevenue, 0)
  const avgDaily = days.length > 0 ? totalNet / days.length : 0
  const periodLabel =
    MOBILE_PERIODS.find((p) => p.value === period)?.short ?? "TODAY"

  const cells: MastheadCell[] = [
    {
      label: `NET ${periodLabel}`,
      value: fmtMoney(totalNet),
      sub: `${days.length} day${days.length === 1 ? "" : "s"}`,
    },
    {
      label: "AVG / DAY",
      value: fmtMoney(avgDaily),
      sub: `${fmtMoney(totalGross)} gross`,
    },
  ]

  return (
    <>
      <MToolbar
        pathname="/m/analytics"
        searchParams={sp}
        stores={stores.map((s) => ({ id: s.id, name: s.name }))}
        storeId={validStoreId}
        period={period}
      />

      <PageHead
        dept="PERFORMANCE"
        title="Analytics"
        sub={
          validStoreId
            ? `${stores.find((s) => s.id === validStoreId)?.name ?? ""} · revenue trend`
            : "All stores · revenue trend"
        }
      />

      <MastheadFigures cells={cells} />

      <div style={{ marginTop: 14 }} className="dock-in dock-in-3">
        <Panel dept="DAILY" title="Net by day" flush>
          {days.length === 0 ? (
            <div className="m-empty m-empty--flush">
              <strong>No revenue data in this window.</strong>
            </div>
          ) : (
            [...days].reverse().map((d) => (
              <div
                key={d.date}
                className="inv-row"
                style={{
                  cursor: "default",
                  gridTemplateColumns: "1fr auto",
                  gap: 14,
                  padding: "14px 18px",
                }}
              >
                <span
                  style={{
                    fontFamily:
                      "var(--font-jetbrains-mono), ui-monospace, monospace",
                    fontSize: 11,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    color: "var(--ink-muted)",
                  }}
                >
                  {fmtDate(d.date)}
                </span>
                <span className="inv-row__total">{fmtMoney(d.netRevenue)}</span>
              </div>
            ))
          )}
        </Panel>
      </div>
    </>
  )
}
