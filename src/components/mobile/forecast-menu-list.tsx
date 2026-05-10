import type { MenuItemForecast } from "@/app/actions/forecasts/menu-item-forecast-actions"

type Props = {
  items: MenuItemForecast[]
  /** How many items to render. Default 8 — anything past that wants its own page. */
  limit?: number
}

const fmtQty = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 0 })

/**
 * Top-N forecasted menu items for the next horizon. Each row is an `.inv-row`
 * with the SKU as italic title, p10–p90 band as the meta line, and total
 * predicted qty as the trailing total. Sorted by `totalPredicted` desc.
 */
export function ForecastMenuList({ items, limit = 8 }: Props) {
  const top = [...items]
    .sort((a, b) => b.totalPredicted - a.totalPredicted)
    .slice(0, limit)

  if (top.length === 0) {
    return (
      <div className="m-empty m-empty--flush">
        No menu-item forecasts yet — first run pending.
      </div>
    )
  }

  return (
    <div>
      {top.map((item) => {
        const p10Sum = item.days.reduce((s, d) => s + (d.p10 ?? 0), 0)
        const p90Sum = item.days.reduce((s, d) => s + (d.p90 ?? 0), 0)
        const hasBand = p10Sum > 0 && p90Sum > 0
        return (
          <div
            key={item.otterItemSkuId}
            className="inv-row m-forecast-item"
            style={{
              gridTemplateColumns:
                "[rule] 8px [name] minmax(0, 1fr) [total] minmax(96px, auto)",
              gap: 12,
              padding: "14px 4px",
            }}
          >
            <div />
            <div style={{ minWidth: 0 }}>
              <div className="inv-row__vendor-name">
                {item.otterItemSkuId}
              </div>
              {hasBand ? (
                <div
                  style={{
                    fontFamily:
                      "var(--font-jetbrains-mono), ui-monospace, monospace",
                    fontSize: 9.5,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "var(--ink-faint)",
                    marginTop: 4,
                    fontVariantNumeric: "tabular-nums lining-nums",
                  }}
                >
                  band {fmtQty(p10Sum)}–{fmtQty(p90Sum)} · {item.days.length}d
                </div>
              ) : null}
            </div>
            <div className="inv-row__total">{fmtQty(item.totalPredicted)}</div>
          </div>
        )
      })}
    </div>
  )
}
