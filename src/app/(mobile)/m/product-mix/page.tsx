import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getProductMixData } from "@/app/actions/store-actions"
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

export default async function MobileProductMixPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (session.user.role !== "OWNER") redirect("/m")

  const sp = await searchParams
  const presetDays = Math.max(1, Number.parseInt(sp.days ?? "7", 10) || 7)

  const data = await getProductMixData(undefined, { days: presetDays })

  if (!data) {
    return (
      <>
        <PageHead dept="PERFORMANCE" title="Product Mix" />
        <div className="m-empty dock-in dock-in-2">
          <strong>No product-mix data yet.</strong> Run an Otter sync first.
        </div>
      </>
    )
  }

  const cells: MastheadCell[] = [
    {
      label: "REVENUE",
      value: fmtMoney(data.tableTotals.revenue),
      sub: `${data.dayCount} day${data.dayCount === 1 ? "" : "s"}`,
    },
    {
      label: "UNITS",
      value: data.tableTotals.quantitySold.toLocaleString(),
      sub:
        data.tableTotals.modifierRevenue > 0
          ? `${fmtMoney(data.tableTotals.modifierRevenue)} mods`
          : undefined,
    },
  ]

  const top = [...data.paretoItems].slice(0, 25)

  return (
    <>
      <PageHead
        dept="PERFORMANCE"
        title="Product Mix"
        sub={`Top items · last ${presetDays} day${presetDays === 1 ? "" : "s"}`}
      />

      <nav
        className="m-segmented dock-in dock-in-2"
        style={{ marginBottom: 14 }}
        aria-label="Window"
      >
        {[7, 30, 90].map((d) => (
          <a
            key={d}
            href={`/m/product-mix?days=${d}`}
            className={`m-segmented__item${presetDays === d ? " is-active" : ""}`}
            aria-current={presetDays === d ? "page" : undefined}
          >
            {d}d
          </a>
        ))}
      </nav>

      <MastheadFigures cells={cells} />

      <div className="dock-in dock-in-3" style={{ marginTop: 14 }}>
        <Panel
          dept={`TOP ${top.length}`}
          title="By revenue"
          flush
        >
          {top.length === 0 ? (
            <div className="m-empty m-empty--flush">
              <strong>No items in this window.</strong>
            </div>
          ) : (
            top.map((item, i) => (
              <div
                key={item.itemName}
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
                    letterSpacing: "0.1em",
                    color: "var(--ink-faint)",
                    minWidth: 24,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span
                    className="inv-row__vendor-name"
                    style={{ fontSize: 14 }}
                  >
                    {item.itemName}
                  </span>
                  <span
                    style={{
                      fontFamily:
                        "var(--font-jetbrains-mono), ui-monospace, monospace",
                      fontSize: 9.5,
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      color: "var(--ink-faint)",
                    }}
                  >
                    {item.category} · CLASS {item.abcClass}
                  </span>
                </span>
                <span style={{ textAlign: "right" }}>
                  <span className="inv-row__total">
                    {fmtMoney(item.revenue)}
                  </span>
                  <div
                    style={{
                      fontFamily:
                        "var(--font-jetbrains-mono), ui-monospace, monospace",
                      fontSize: 9.5,
                      letterSpacing: "0.16em",
                      color: "var(--ink-faint)",
                      marginTop: 3,
                    }}
                  >
                    {item.cumulativePercent.toFixed(0)}%
                  </div>
                </span>
              </div>
            ))
          )}
        </Panel>
      </div>
    </>
  )
}
