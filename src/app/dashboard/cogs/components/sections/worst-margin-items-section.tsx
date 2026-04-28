import Link from "next/link"
import { getWorstMarginItems } from "@/lib/cogs"
import type { CogsFilters } from "./data"

const LIMIT = 20

export async function WorstMarginItemsSection({
  storeId,
  filters,
}: {
  storeId: string
  filters: CogsFilters
}) {
  const rows = await getWorstMarginItems(
    storeId,
    filters.startDate,
    filters.endDate,
    LIMIT
  )

  if (rows.length === 0) {
    return (
      <section>
        <div className="font-label mb-2">§ 04 · Worst-margin items</div>
        <div className="font-mono text-xs italic text-(--ink-muted) py-10 text-center border-t border-(--hairline)">
          No costed sales in this period.
        </div>
      </section>
    )
  }

  return (
    <section>
      <div className="font-label mb-2">§ 04 · Worst-margin items</div>

      {/* Mobile: card stack ─ keep item name + margin % prominent, push
          unitsSold / revenue / cost into a meta strip. */}
      <ul className="sm:hidden divide-y divide-(--hairline) border-t border-(--hairline-bold)">
        {rows.map((r) => {
          const isHigh = r.foodCostPct >= 35
          const itemNode = (
            <span className="font-display italic text-(--ink) text-[16px] leading-tight">
              {r.itemName}
            </span>
          )
          return (
            <li
              key={`${r.itemName}|${r.recipeId ?? "-"}`}
              className="flex flex-col gap-1.5 py-3"
            >
              <div className="flex items-baseline justify-between gap-3">
                {r.recipeId ? (
                  <Link
                    href={`/dashboard/recipes?recipeId=${r.recipeId}`}
                    className="min-w-0 flex-1 hover:underline"
                  >
                    {itemNode}
                  </Link>
                ) : (
                  <span className="min-w-0 flex-1">{itemNode}</span>
                )}
                <span
                  className={`font-mono text-[15px] tabular-nums tracking-tight ${
                    isHigh
                      ? "cogs-margin-row__pct--high"
                      : "text-(--ink)"
                  }`}
                >
                  {isHigh && (
                    <span aria-hidden className="mr-1">
                      ▲
                    </span>
                  )}
                  {r.foodCostPct.toFixed(1)}%
                </span>
              </div>
              <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-(--ink-muted)">
                {r.unitsSold.toFixed(0)} sold
                <span aria-hidden> · </span>
                ${r.revenue.toFixed(0)} rev
                <span aria-hidden> · </span>
                ${r.foodCostDollars.toFixed(0)} cost
              </div>
            </li>
          )
        })}
      </ul>

      {/* Desktop: dense reconciliation table */}
      <table className="hidden sm:table w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-(--hairline-bold)">
            <th className="text-left py-1 font-label">Item</th>
            <th className="text-right py-1 font-label">Sold</th>
            <th className="text-right py-1 font-label">Revenue</th>
            <th className="text-right py-1 font-label">Cost</th>
            <th className="text-right py-1 font-label">Cost %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isHigh = r.foodCostPct >= 35
            return (
              <tr
                key={`${r.itemName}|${r.recipeId ?? "-"}`}
                className="cogs-margin-row"
              >
                <td className="py-1 font-display italic text-(--ink)">
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
                <td className="py-1 text-right">{r.unitsSold.toFixed(0)}</td>
                <td className="py-1 text-right">${r.revenue.toFixed(0)}</td>
                <td className="py-1 text-right">
                  ${r.foodCostDollars.toFixed(0)}
                </td>
                <td
                  className={`py-1 text-right ${
                    isHigh ? "cogs-margin-row__pct--high" : ""
                  }`}
                >
                  {isHigh && (
                    <span aria-hidden className="mr-1">
                      ▲
                    </span>
                  )}
                  {r.foodCostPct.toFixed(1)}%
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
