"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
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
      <table className="w-full font-mono text-xs" data-testid="menu-profit-table">
        <thead>
          <tr className="border-b border-(--hairline-bold)">
            <th className="py-1.5 pr-2 text-left font-label">Item</th>
            {COLUMNS.map((col) => (
              <th key={col.key} className="py-1.5 pl-2 text-right font-label">
                <button
                  type="button"
                  onClick={() => handleSort(col.key)}
                  className="inline-flex items-center gap-0.5 uppercase tracking-[0.1em] transition hover:text-(--ink)"
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span aria-hidden>{sortDesc ? "▾" : "▴"}</span>
                  )}
                </button>
              </th>
            ))}
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
                <td className="py-1.5 pr-2 font-display italic text-[13px] text-(--ink)">
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
                <td className="py-1.5 pl-2 text-right tabular-nums">
                  {r.soldQty.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </td>
                <td className="py-1.5 pl-2 text-right tabular-nums">
                  {money(r.revenue, 0)}
                </td>
                <td className="py-1.5 pl-2 text-right tabular-nums">
                  {money(r.unitPrice)}
                </td>
                <td className="py-1.5 pl-2 text-right tabular-nums">
                  {money(r.unitCost)}
                </td>
                <td
                  className="py-1.5 pl-2 text-right tabular-nums"
                  style={negative ? { color: "var(--subtract)" } : undefined}
                >
                  {money(r.unitMargin)}
                </td>
                <td
                  className="py-1.5 pl-2 text-right tabular-nums"
                  style={negative ? { color: "var(--subtract)" } : undefined}
                >
                  {r.marginPct != null ? `${r.marginPct.toFixed(1)}%` : "—"}
                </td>
                <td className="py-1.5 pl-2 text-right tabular-nums">
                  {money(r.totalContribution, 0)}
                </td>
                <td className="py-1.5 pl-2 text-right">
                  <span
                    className="text-[9.5px] uppercase tracking-[0.14em]"
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
