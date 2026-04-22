import { getTopCostDriverIngredients } from "@/lib/cogs"
import type { CogsFilters } from "./data"

const LIMIT = 15

export async function TopCostDriverIngredientsSection({
  storeId,
  filters,
}: {
  storeId: string
  filters: CogsFilters
}) {
  const drivers = await getTopCostDriverIngredients(
    storeId,
    filters.startDate,
    filters.endDate,
    LIMIT
  )

  if (drivers.length === 0) {
    return (
      <section>
        <div className="font-label mb-2">§ 05 · Top cost-driver ingredients</div>
        <div className="font-mono text-xs italic text-(--ink-muted) py-10 text-center border-t border-(--hairline)">
          No costed sales in this period.
        </div>
      </section>
    )
  }

  const max = drivers[0].theoreticalDollars

  return (
    <section>
      <div className="font-label mb-2">§ 05 · Top cost-driver ingredients</div>
      <div role="list">
        {drivers.map((d) => {
          const arrow =
            d.latestUnitCost != null && d.priorUnitCost != null
              ? d.latestUnitCost > d.priorUnitCost
                ? "up"
                : d.latestUnitCost < d.priorUnitCost
                  ? "down"
                  : "flat"
              : "flat"
          const fillPct = max > 0 ? (d.theoreticalDollars / max) * 100 : 0
          return (
            <div key={d.canonicalIngredientId} className="cogs-bar-row">
              <span
                className="cogs-bar-row__bar"
                style={{ width: `${fillPct}%` }}
                aria-hidden
              />
              <span className="cogs-bar-row__name">
                {arrow !== "flat" && (
                  <span
                    className={`cogs-bar-row__arrow cogs-bar-row__arrow--${arrow}`}
                    aria-label={
                      arrow === "up"
                        ? "Price up vs prior period"
                        : "Price down vs prior period"
                    }
                  >
                    {arrow === "up" ? "▲" : "▼"}
                  </span>
                )}
                {d.name}
                {d.latestUnitCost != null && d.costUnit && (
                  <span className="ml-2 text-(--ink-muted) text-[11px]">
                    ${d.latestUnitCost.toFixed(2)}/{d.costUnit}
                  </span>
                )}
              </span>
              <span className="cogs-bar-row__amount">
                ${d.theoreticalDollars.toFixed(0)}
              </span>
              <span className="cogs-bar-row__pct">
                {d.pctOfCogs.toFixed(1)}%
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
