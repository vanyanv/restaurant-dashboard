import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getStorePnL } from "@/app/actions/store-actions"
import { parsePnLRange, pnlRangeToState } from "@/lib/mobile/pnl-period"
import { PageHead } from "@/components/mobile/page-head"
import {
  MastheadFigures,
  type MastheadCell,
} from "@/components/mobile/masthead-figures"
import { Panel } from "@/components/mobile/panel"
import { MPnLToolbar } from "@/components/mobile/m-pnl-toolbar"

export const dynamic = "force-dynamic"

const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

const fmtPct = (n: number) => `${n.toFixed(1)}%`

const fmtSigned = (n: number) =>
  `${n >= 0 ? "" : "−"}${fmtMoney(Math.abs(n))}`

const PNL_PERIOD_LABELS: Record<string, string> = {
  "this-week": "this week",
  "last-week": "last week",
  "this-month": "this month",
  "last-month": "last month",
  "last-8-weeks": "last 8 weeks",
}

export default async function MobileStorePnLPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (session.user.role !== "OWNER") redirect("/m")

  const { storeId } = await params
  const sp = normalize(await searchParams)
  const range = parsePnLRange(sp)
  const state = pnlRangeToState(range)

  const result = await getStorePnL({
    storeId,
    startDate: state.startDate,
    endDate: state.endDate,
    granularity: state.granularity,
  })

  const subLabel =
    range.kind === "custom"
      ? `Custom · ${state.granularity}`
      : PNL_PERIOD_LABELS[range.period] ?? range.period

  if ("error" in result) {
    if (result.error === "Store not found") notFound()
    return (
      <>
        <BackLink href="/m/pnl" label="All stores" />
        <PageHead dept="P&L" title="Error" sub={subLabel} />
        <MPnLToolbar pathname={`/m/pnl/${storeId}`} searchParams={sp} range={range} />
        <div className="m-empty dock-in dock-in-2">
          <strong>Couldn&apos;t load.</strong> {result.error}
        </div>
      </>
    )
  }

  const cells: MastheadCell[] = [
    {
      label: "GROSS",
      value: fmtMoney(result.kpis.grossSales),
      sub: subLabel,
    },
    {
      label: "MARGIN",
      value: fmtPct(result.kpis.marginPct),
      sub: fmtSigned(result.kpis.bottomLine),
    },
    {
      label: "FIXED",
      value: fmtMoney(result.kpis.fixedCosts),
      sub: result.fixedLaborConfigured && result.fixedRentConfigured
        ? "configured"
        : "incomplete",
    },
  ]

  // Show only meaningful rows: any row with non-zero values across periods,
  // or the labeled subtotals (which are always informative).
  const meaningfulRows = result.rows.filter((r) => {
    if (r.isSubtotal) return true
    return r.values.some((v) => v !== 0)
  })

  return (
    <>
      <BackLink href="/m/pnl" label="All stores" />

      <PageHead
        dept="P&L"
        title={result.storeName}
        sub={`${result.periods.length} periods · ${state.granularity}`}
      />

      <MPnLToolbar pathname={`/m/pnl/${storeId}`} searchParams={sp} range={range} />

      <MastheadFigures cells={cells} />

      <div className="dock-in dock-in-3" style={{ marginTop: 14 }}>
        <Panel
          dept={`COGS ${fmtPct(result.cogs.grossMarginPct)}`}
          title="Gross profit"
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 12,
              alignItems: "baseline",
            }}
          >
            <span
              style={{
                fontFamily:
                  "var(--font-jetbrains-mono), ui-monospace, monospace",
                fontSize: 10,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--ink-muted)",
              }}
            >
              {fmtMoney(result.cogs.totalCogs)} cost
            </span>
            <span className="inv-row__total">
              {fmtMoney(result.cogs.grossProfit)}
            </span>
          </div>
          {result.cogs.unmappedItems.length > 0 ||
          result.cogs.missingCostItems.length > 0 ? (
            <div className="m-readonly-note" style={{ marginTop: 12 }}>
              {result.cogs.unmappedItems.length} unmapped ·{" "}
              {result.cogs.missingCostItems.length} missing cost
            </div>
          ) : null}
        </Panel>
      </div>

      <div className="dock-in dock-in-4" style={{ marginTop: 14 }}>
        <Panel
          dept={`${meaningfulRows.length} ROWS`}
          title="Statement"
          flush
        >
          {meaningfulRows.map((row) => {
            const total = row.values.reduce((s, v) => s + v, 0)
            return (
              <div
                key={row.code}
                className="inv-row"
                style={{
                  cursor: "default",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 12,
                  padding: "12px 18px",
                  background: row.isSubtotal
                    ? "rgba(255, 253, 247, 0.55)"
                    : undefined,
                }}
              >
                <span
                  style={{
                    fontFamily:
                      "var(--font-jetbrains-mono), ui-monospace, monospace",
                    fontSize: 9.5,
                    letterSpacing: "0.16em",
                    color: "var(--ink-faint)",
                    minWidth: 56,
                  }}
                >
                  {row.code}
                </span>
                <span
                  style={{
                    fontFamily:
                      "var(--font-dm-sans), ui-sans-serif, sans-serif",
                    fontSize: 13,
                    fontWeight: row.isSubtotal ? 600 : 400,
                    color: "var(--ink)",
                  }}
                >
                  {row.label}
                </span>
                <span
                  className="inv-row__total"
                  style={{
                    color: total < 0 ? "var(--subtract)" : undefined,
                    fontWeight: row.isSubtotal ? 600 : undefined,
                  }}
                >
                  {fmtSigned(total)}
                </span>
              </div>
            )
          })}
        </Panel>
      </div>

      {result.channelMix.length > 0 ? (
        <div className="dock-in dock-in-5" style={{ marginTop: 14 }}>
          <Panel dept="CHANNEL MIX" title="By platform" flush>
            {result.channelMix
              .filter((c) => c.amount > 0)
              .sort((a, b) => b.amount - a.amount)
              .map((c) => (
                <div
                  key={c.channel}
                  className="inv-row"
                  style={{
                    cursor: "default",
                    gridTemplateColumns: "1fr auto",
                    gap: 12,
                    padding: "12px 18px",
                  }}
                >
                  <span className="inv-row__vendor-name" style={{ fontSize: 14 }}>
                    {c.channel}
                  </span>
                  <span className="inv-row__total">{fmtMoney(c.amount)}</span>
                </div>
              ))}
          </Panel>
        </div>
      ) : null}
    </>
  )
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="m-back-link">
      <span className="m-cap m-cap--ink">← {label}</span>
    </Link>
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
