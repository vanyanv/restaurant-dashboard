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

  return (
    <section>
      <div className="font-label mb-2">§ 04 · Worst-margin items</div>
      {rows.length === 0 ? (
        <div className="font-mono text-xs italic text-(--ink-muted) py-10 text-center border-t border-(--hairline)">
          No costed sales in this period.
        </div>
      ) : (
        <table className="w-full text-xs font-mono">
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
      )}
    </section>
  )
}
