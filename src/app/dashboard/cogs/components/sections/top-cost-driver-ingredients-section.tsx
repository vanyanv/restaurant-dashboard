import { getTopCostDriverIngredients } from "@/lib/cogs"
import type { CogsFilters } from "./data"

const LIMIT = 15

function formatMoney(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
}

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
      <section className="inv-panel dock-in dock-in-6">
        <div className="inv-panel__head">
          <div>
            <span className="inv-panel__dept">§ 06 Ingredients</span>
            <h2 className="inv-panel__title">Top cost drivers</h2>
          </div>
        </div>
        <div className="cogs-empty-note">
          No costed sales in this period.
        </div>
      </section>
    )
  }

  const max = drivers[0].theoreticalDollars

  return (
    <section className="inv-panel dock-in dock-in-6">
      <div className="inv-panel__head">
        <div>
          <span className="inv-panel__dept">§ 06 Ingredients</span>
          <h2 className="inv-panel__title">Top cost drivers</h2>
        </div>
        <div className="cogs-panel-stat">
          <span>top driver</span>
          <strong>{formatMoney(drivers[0].theoreticalDollars)}</strong>
          <em>{drivers[0].pctOfCogs.toFixed(1)}% of COGS</em>
        </div>
      </div>
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
                {formatMoney(d.theoreticalDollars)}
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
