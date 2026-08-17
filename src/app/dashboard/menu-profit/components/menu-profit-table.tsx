"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  ariaSort,
  sortLabel,
  type SortDirection,
} from "@/components/dashboard/sort-affordance"
import { cn } from "@/lib/utils"
import type { MenuEngineeringRow } from "@/app/actions/forecasts/menu-engineering-actions"

type SortKey =
  | "soldQty"
  | "revenue"
  | "unitPrice"
  | "unitCost"
  | "unitMargin"
  | "marginPct"
  | "totalContribution"

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: "soldQty", label: "Sold" },
  { key: "revenue", label: "Revenue" },
  { key: "unitPrice", label: "Price" },
  { key: "unitCost", label: "Cost" },
  { key: "unitMargin", label: "Margin" },
  { key: "marginPct", label: "Margin %" },
  { key: "totalContribution", label: "Contribution" },
]

function money(value: number, decimals = 2): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`
}

// Number tier (DESIGN.md §3): DM Sans 600, tabular + lining figures.
const NUM_CLASS =
  "py-1.5 pl-2 text-right font-semibold text-(--ink) [font-variant-numeric:tabular-nums_lining-nums]"

/**
 * Per-item ledger, client-sortable in memory (a menu is ~50 rows — plain
 * useState sort, no table library). Quadrant is a text label per the
 * Color-Plus-Label rule; negative margins render in --subtract.
 */
export function MenuProfitTable({ rows }: { rows: MenuEngineeringRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("totalContribution")
  const [sortDesc, setSortDesc] = useState(true)

  const sorted = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = a[sortKey] ?? 0
      const bv = b[sortKey] ?? 0
      return sortDesc ? (bv as number) - (av as number) : (av as number) - (bv as number)
    })
    return copy
  }, [rows, sortKey, sortDesc])

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDesc((d) => !d)
    else {
      setSortKey(key)
      setSortDesc(true)
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]" data-testid="menu-profit-table">
        <thead>
          <tr className="border-b border-(--hairline-bold)">
            <th className="py-1.5 pr-2 text-left font-label">Item</th>
            {COLUMNS.map((col) => {
              const dir: SortDirection =
                sortKey === col.key ? (sortDesc ? "desc" : "asc") : false
              return (
                <th
                  key={col.key}
                  className="py-1.5 pl-2 text-right font-label"
                  aria-sort={ariaSort(dir)}
                >
                  <button
                    type="button"
                    onClick={() => handleSort(col.key)}
                    aria-label={sortLabel(col.label, dir)}
                    className={cn(
                      "inline-flex items-center gap-0.5 uppercase tracking-[0.1em] transition hover:text-(--ink)",
                      dir && "font-semibold text-(--ink)",
                    )}
                  >
                    {col.label}
                    {dir && <span aria-hidden>{sortDesc ? "▾" : "▴"}</span>}
                  </button>
                </th>
              )
            })}
            <th className="py-1.5 pl-2 text-right font-label" title="How much volume moves when price moves. -1.0 is unit elastic; nearer 0 means price changes barely move demand.">
              Elasticity
            </th>
            <th className="py-1.5 pl-2 text-right font-label">Class</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const negative = r.unitMargin < 0
            return (
              <tr
                key={`${r.itemName}|${r.category}`}
                className="border-b border-(--hairline) transition hover:bg-[rgba(220,38,38,0.045)]"
              >
                <td
                  className="py-1.5 pr-2 font-display italic text-[13px] text-(--ink)"
                  style={{ fontVariationSettings: '"opsz" 96, "SOFT" 40' }}
                >
                  {r.recipeId ? (
                    <Link
                      href={`/dashboard/recipes?recipeId=${r.recipeId}`}
                      className="hover:underline"
                    >
                      {r.itemName}
                    </Link>
                  ) : (
                    r.itemName
                  )}
                </td>
                <td className={NUM_CLASS}>
                  {r.soldQty.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </td>
                <td className={NUM_CLASS}>{money(r.revenue, 0)}</td>
                <td className={NUM_CLASS}>{money(r.unitPrice)}</td>
                <td className={NUM_CLASS}>{money(r.unitCost)}</td>
                <td
                  className={NUM_CLASS}
                  style={negative ? { color: "var(--subtract)" } : undefined}
                >
                  {money(r.unitMargin)}
                </td>
                <td
                  className={NUM_CLASS}
                  style={negative ? { color: "var(--subtract)" } : undefined}
                >
                  {r.marginPct != null ? `${r.marginPct.toFixed(1)}%` : "—"}
                </td>
                <td className={NUM_CLASS}>{money(r.totalContribution, 0)}</td>
                <td className="py-1.5 pl-2 text-right">
                  {r.elasticity != null ? (
                    <span
                      className="[font-variant-numeric:tabular-nums_lining-nums]"
                      style={{
                        color:
                          r.elasticityConfidence === "high"
                            ? "var(--ink)"
                            : "var(--ink-muted)",
                        fontWeight: r.elasticityConfidence === "high" ? 600 : 400,
                      }}
                      title={
                        r.elasticityConfidence === "high"
                          ? "Strong fit"
                          : "Weak fit — directional only"
                      }
                    >
                      {r.elasticity.toFixed(2)}
                      {r.elasticityConfidence === "low" ? (
                        <span className="ml-1 font-mono text-[9px] uppercase tracking-[0.12em] text-(--ink-muted)">
                          weak
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-(--ink-muted)">
                      no signal
                    </span>
                  )}
                </td>
                <td className="py-1.5 pl-2 text-right">
                  <span
                    className="font-mono text-[9.5px] uppercase tracking-[0.14em]"
                    style={{
                      color: r.quadrant === "DOG" ? "var(--subtract)" : "var(--ink-muted)",
                    }}
                  >
                    {r.quadrant}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
