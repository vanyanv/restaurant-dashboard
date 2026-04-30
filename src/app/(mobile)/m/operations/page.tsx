import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getOperationalAnalytics } from "@/app/actions/operational-actions"
import { getStores } from "@/app/actions/store-actions"
import { PageHead } from "@/components/mobile/page-head"
import {
  MastheadFigures,
  type MastheadCell,
} from "@/components/mobile/masthead-figures"
import { Panel } from "@/components/mobile/panel"
import { MToolbar } from "@/components/mobile/m-toolbar"
import {
  parsePeriod,
  periodToDateRange,
  MOBILE_PERIODS,
  type MobileNamedPeriod,
} from "@/lib/mobile/period"

export const dynamic = "force-dynamic"

const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

const fmtPct = (n: number | null) =>
  n == null ? "—" : `${n.toFixed(1)}%`

function periodToOpsOptions(p: MobileNamedPeriod) {
  const range = periodToDateRange(p)
  return {
    startDate: range.startDate.toISOString().slice(0, 10),
    endDate: range.endDate.toISOString().slice(0, 10),
  }
}

export default async function MobileOperationsPage({
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

  const opts = periodToOpsOptions(period)
  const data = await getOperationalAnalytics(validStoreId ?? undefined, opts)

  const periodLabel =
    MOBILE_PERIODS.find((p) => p.value === period)?.short ?? "TODAY"

  return (
    <>
      <MToolbar
        pathname="/m/operations"
        searchParams={sp}
        stores={stores.map((s) => ({ id: s.id, name: s.name }))}
        storeId={validStoreId}
        period={period}
      />

      <PageHead
        dept="DAILY"
        title="Operations"
        sub={
          validStoreId
            ? `${stores.find((s) => s.id === validStoreId)?.name ?? ""} · ${periodLabel.toLowerCase()}`
            : `All stores · ${periodLabel.toLowerCase()}`
        }
      />

      {!data ? (
        <div className="m-empty dock-in dock-in-2">
          <strong>No operational data in this window.</strong>
        </div>
      ) : (
        <>
          <MastheadFigures
            cells={[
              {
                label: "COST / ORDER",
                value: fmtMoney(data.comparison.current.costPerOrder),
                sub: `${data.comparison.current.totalOrders.toLocaleString()} orders`,
              },
              {
                label: "GROSS MARGIN",
                value: fmtPct(data.comparison.current.grossMarginPct),
                sub: `${fmtMoney(data.comparison.current.totalSpending)} spend`,
              },
            ] satisfies MastheadCell[]}
          />

          <div className="dock-in dock-in-3" style={{ marginTop: 14 }}>
            <Panel dept="WEEKLY" title="Cost / order trend" flush>
              {data.weeklyBuckets.length === 0 ? (
                <div className="m-empty m-empty--flush">
                  <strong>No weekly data.</strong>
                </div>
              ) : (
                [...data.weeklyBuckets].reverse().map((w) => (
                  <div
                    key={w.weekStart}
                    className="inv-row"
                    style={{
                      cursor: "default",
                      gridTemplateColumns: "auto 1fr auto",
                      gap: 12,
                      padding: "12px 18px",
                    }}
                  >
                    <span
                      style={{
                        fontFamily:
                          "var(--font-jetbrains-mono), ui-monospace, monospace",
                        fontSize: 10,
                        letterSpacing: "0.16em",
                        color: "var(--ink-muted)",
                        minWidth: 36,
                      }}
                    >
                      {w.weekLabel}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--ink-faint)",
                        fontVariantNumeric: "tabular-nums lining-nums",
                      }}
                    >
                      {w.totalOrders.toLocaleString()} orders ·{" "}
                      {fmtPct(w.cogsRatioPct)} COGS
                    </span>
                    <span className="inv-row__total">
                      {fmtMoney(w.costPerOrder)}
                    </span>
                  </div>
                ))
              )}
            </Panel>
          </div>

          <div className="dock-in dock-in-4" style={{ marginTop: 14 }}>
            <Panel dept="CATEGORIES" title="Spend breakdown" flush>
              {data.categoryBreakdown.length === 0 ? (
                <div className="m-empty m-empty--flush">
                  <strong>No category data.</strong>
                </div>
              ) : (
                data.categoryBreakdown.map((c) => (
                  <div
                    key={c.category}
                    className="inv-row"
                    style={{
                      cursor: "default",
                      gridTemplateColumns: "1fr auto",
                      gap: 12,
                      padding: "12px 18px",
                    }}
                  >
                    <span
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                      }}
                    >
                      <span
                        className="inv-row__vendor-name"
                        style={{ fontSize: 14 }}
                      >
                        {c.category}
                      </span>
                      <span
                        style={{
                          fontFamily:
                            "var(--font-jetbrains-mono), ui-monospace, monospace",
                          fontSize: 9.5,
                          letterSpacing: "0.18em",
                          color: "var(--ink-faint)",
                        }}
                      >
                        {c.percentOfTotal.toFixed(1)}% OF SPEND
                      </span>
                    </span>
                    <span className="inv-row__total">
                      {fmtMoney(c.totalSpend)}
                    </span>
                  </div>
                ))
              )}
            </Panel>
          </div>
        </>
      )}
    </>
  )
}
