import { formatCurrencyWhole as fmtMoney } from "@/lib/format"
import Link from "next/link"
import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { parsePnLRange, pnlRangeToState } from "@/lib/mobile/pnl-period"
import { getMobilePnLOverview } from "@/lib/mobile/snapshots"
import { PageHead } from "@/components/mobile/page-head"
import {
  MastheadFigures,
  type MastheadCell,
} from "@/components/mobile/masthead-figures"
import { Panel } from "@/components/mobile/panel"
import { MPnLToolbar } from "@/components/mobile/m-pnl-toolbar"

export const dynamic = "force-dynamic"

const fmtPct = (n: number) => `${n.toFixed(1)}%`

const PNL_PERIOD_LABELS: Record<string, string> = {
  "this-week": "this week",
  "last-week": "last week",
  "this-month": "this month",
  "last-month": "last month",
  "last-8-weeks": "last 8 weeks",
}

export default async function MobilePnLPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/m")

  const sp = normalize(await searchParams)
  const range = parsePnLRange(sp)
  const state = pnlRangeToState(range)

  const result = await getMobilePnLOverview({
    startDate: state.startDate,
    endDate: state.endDate,
    granularity: state.granularity,
  })

  const subLabel =
    range.kind === "custom"
      ? `Custom · ${state.granularity}`
      : `${PNL_PERIOD_LABELS[range.period]} · all stores`

  if ("error" in result) {
    return (
      <div data-perf-ready="/m/pnl">
        <PageHead dept="P&L" title="Profit & Loss" sub={subLabel} />
        <MPnLToolbar pathname="/m/pnl" searchParams={sp} range={range} />
        <div className="m-empty dock-in dock-in-2">
          <strong>Couldn&apos;t load P&amp;L.</strong> Try another period or
          return in a minute. The ledger kept the current range so you can
          retry without rebuilding the view.
        </div>
      </div>
    )
  }

  const cells: MastheadCell[] = [
    { label: "GROSS", value: fmtMoney(result.combined.grossSales), sub: "all stores" },
    { label: "COGS", value: fmtPct(result.combined.cogsPct), sub: fmtMoney(result.combined.cogsValue) },
    { label: "BOTTOM", value: fmtMoney(result.combined.bottomLine), sub: fmtPct(result.combined.marginPct) },
  ]

  const sorted = [...result.perStore].sort((a, b) => b.grossSales - a.grossSales)

  return (
    <div data-perf-ready="/m/pnl">
      <PageHead dept="P&L" title="Profit & Loss" sub={subLabel} />
      <MPnLToolbar pathname="/m/pnl" searchParams={sp} range={range} />
      <MastheadFigures cells={cells} />

      <div style={{ marginTop: 14 }} className="dock-in dock-in-3">
        <Panel dept={`${result.storeCount} STORES`} title="By store" flush>
          <div style={{ padding: "0 0 4px 0" }}>
            {sorted.map((s) => (
              <Link
                key={s.storeId}
                href={`/m/pnl/${s.storeId}${qsFor(sp)}`}
                prefetch={true}
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
                  <span className="inv-row__total">{fmtMoney(s.grossSales)}</span>
                  <div
                    style={{
                      fontFamily: "var(--font-dm-sans), ui-sans-serif, sans-serif",
                      fontSize: 11,
                      color: s.bottomLine >= 0 ? "var(--ink-muted)" : "var(--subtract)",
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
    </div>
  )
}

function normalize(
  raw: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) out[k] = v[0]
    else out[k] = v
  }
  return out
}

function qsFor(sp: Record<string, string | undefined>): string {
  // Carry the date selection into the per-store drilldown.
  const merged: Record<string, string> = {}
  for (const k of ["period", "start", "end", "grain"]) {
    const v = sp[k]
    if (v) merged[k] = v
  }
  const qs = new URLSearchParams(merged).toString()
  return qs ? `?${qs}` : ""
}
