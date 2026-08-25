import { getCostByCategory } from "@/lib/cogs"
import type { CogsFilters } from "./data"

function formatMoney(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
}

export async function CostByCategorySection({
  storeId,
  filters,
}: {
  storeId: string
  filters: CogsFilters
}) {
  const cats = await getCostByCategory(
    storeId,
    filters.startDate,
    filters.endDate
  )
  const total = cats.reduce((acc, c) => acc + c.cogsDollars, 0)

  return (
    <section className="inv-panel dock-in dock-in-4">
      <div className="inv-panel__head">
        <div>
          <span className="inv-panel__dept">§ 04 Categories</span>
          <h2 className="inv-panel__title">Category spend ledger</h2>
        </div>
        {total > 0 ? (
          <div className="cogs-panel-stat">
            <span>period COGS</span>
            <strong>{formatMoney(total)}</strong>
          </div>
        ) : null}
      </div>
      {cats.length === 0 || total === 0 ? (
        <div className="cogs-empty-note">
          No COGS data for this period. Sync invoices and Otter sales.
        </div>
      ) : (
        <div className="cogs-ledger-table" role="table" aria-label="Cost by category">
          <div className="cogs-ledger-table__row cogs-ledger-table__row--head" role="row">
            <span role="columnheader">Category</span>
            <span role="columnheader">COGS</span>
            <span role="columnheader">Share</span>
          </div>
          {cats.map((category) => (
            <div key={category.category} className="cogs-ledger-table__row" role="row">
              <span className="cogs-ledger-table__name" role="cell">
                {category.category}
              </span>
              <span role="cell">{formatMoney(category.cogsDollars)}</span>
              <span className="text-(--ink-muted)" role="cell">
                {category.pctOfCogs.toFixed(1)}%
              </span>
            </div>
          ))}
          <div className="cogs-ledger-table__row cogs-ledger-table__row--total" role="row">
            <span role="cell">Total</span>
            <span role="cell">{formatMoney(total)}</span>
            <span role="cell">100.0%</span>
          </div>
        </div>
      )}
    </section>
  )
}
