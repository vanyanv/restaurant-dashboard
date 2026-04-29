import Link from "next/link"
import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getAllStoresPnL } from "@/app/actions/store-actions"
import { defaultPnLRangeState } from "@/components/pnl/pnl-date-presets"
import { PageHead } from "@/components/mobile/page-head"
import {
  MastheadFigures,
  type MastheadCell,
} from "@/components/mobile/masthead-figures"
import { Panel } from "@/components/mobile/panel"

export const dynamic = "force-dynamic"

const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

const fmtPct = (n: number) => `${n.toFixed(1)}%`

export default async function MobilePnLPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (session.user.role !== "OWNER") redirect("/m")

  const range = defaultPnLRangeState()
  const result = await getAllStoresPnL({
    startDate: range.startDate,
    endDate: range.endDate,
    granularity: range.granularity,
  })

  if ("error" in result) {
    return (
      <>
        <PageHead dept="P&L" title="Profit & Loss" sub="Last 8 weeks" />
        <div className="m-empty dock-in dock-in-2">
          <strong>Couldn&apos;t load P&amp;L.</strong> {result.error}
        </div>
      </>
    )
  }

  const cells: MastheadCell[] = [
    {
      label: "GROSS",
      value: fmtMoney(result.combined.grossSales),
      sub: "all stores",
    },
    {
      label: "COGS",
      value: fmtPct(result.combined.cogsPct),
      sub: fmtMoney(result.combined.cogsValue),
    },
    {
      label: "BOTTOM",
      value: fmtMoney(result.combined.bottomLine),
      sub: fmtPct(result.combined.marginPct),
    },
  ]

  const sorted = [...result.perStore].sort(
    (a, b) => b.grossSales - a.grossSales
  )

  return (
    <>
      <PageHead dept="P&L" title="Profit & Loss" sub="Last 8 weeks · all stores" />
      <MastheadFigures cells={cells} />

      <div style={{ marginTop: 14 }} className="dock-in dock-in-3">
        <Panel
          dept={`${result.storeCount} STORES`}
          title="By store"
          flush
        >
          <div style={{ padding: "0 0 4px 0" }}>
            {sorted.map((s) => (
              <Link
                key={s.storeId}
                href={`/m/pnl/${s.storeId}`}
                className="inv-row"
                style={{
                  gridTemplateColumns: "1fr auto auto",
                  gap: 12,
                  padding: "16px 20px",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="inv-row__vendor-name">{s.storeName}</span>
                  <span
                    style={{
                      fontFamily:
                        "var(--font-jetbrains-mono), ui-monospace, monospace",
                      fontSize: 10,
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      color: "var(--ink-faint)",
                    }}
                  >
                    {`COGS ${fmtPct(s.cogsPct)} · MARGIN ${fmtPct(s.marginPct)}`}
                  </span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span className="inv-row__total">
                    {fmtMoney(s.grossSales)}
                  </span>
                  <div
                    style={{
                      fontFamily:
                        "var(--font-dm-sans), ui-sans-serif, sans-serif",
                      fontSize: 11,
                      color:
                        s.bottomLine >= 0
                          ? "var(--ink-muted)"
                          : "var(--subtract)",
                      fontVariantNumeric: "tabular-nums lining-nums",
                    }}
                  >
                    {`${s.bottomLine >= 0 ? "" : "−"}${fmtMoney(Math.abs(s.bottomLine))}`}
                  </div>
                </div>
                <span
                  className="m-section-row__chev"
                  aria-hidden
                  style={{ alignSelf: "center" }}
                >
                  ›
                </span>
              </Link>
            ))}
          </div>
        </Panel>
      </div>
    </>
  )
}
