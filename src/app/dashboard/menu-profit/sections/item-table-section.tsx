import { MenuProfitTable } from "../components/menu-profit-table"
import { loadMenuEngineering } from "./data"

/**
 * The per-item ledger: every costed item's volume, revenue, unit economics,
 * and quadrant. `inv-panel--flush` hosts the full-bleed table.
 */
export async function ItemTableSection({
  storeId,
  days,
}: {
  storeId?: string
  days: number
}) {
  const result = await loadMenuEngineering(storeId, days)
  if (!result?.ok) {
    return (
      <section className="inv-panel dock-in dock-in-3">
        <div className="inv-panel__head">
          <div>
            <span className="inv-panel__dept">§ 14 Menu</span>
            <h2 className="inv-panel__title">Item ledger</h2>
          </div>
        </div>
        <p className="pt-2 text-[13px] text-[var(--ink-muted)]">
          We couldn&apos;t load this section right now. Try refreshing in a
          moment.
        </p>
      </section>
    )
  }
  const { rows } = result.data

  if (rows.length === 0) {
    return (
      <section className="inv-panel dock-in dock-in-3">
        <div className="inv-panel__head">
          <div>
            <span className="inv-panel__dept">§ 14 Menu</span>
            <h2 className="inv-panel__title">Item ledger</h2>
          </div>
        </div>
        <p className="pt-2 text-[13px] text-[var(--ink-muted)]">
          No costed sales in this window yet.
        </p>
      </section>
    )
  }

  return (
    <section className="inv-panel dock-in dock-in-3">
      <div className="inv-panel__head">
        <div>
          <span className="inv-panel__dept">§ 14 Menu</span>
          <h2 className="inv-panel__title">Item ledger</h2>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
          {rows.length} items · sorted by contribution
        </span>
      </div>
      <MenuProfitTable rows={rows} />
    </section>
  )
}
