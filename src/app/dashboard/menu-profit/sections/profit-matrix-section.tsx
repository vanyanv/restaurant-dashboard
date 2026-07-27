import { MenuProfitMatrix } from "@/components/charts/menu-profit-matrix"
import { loadMenuEngineering } from "./data"

/**
 * The volume × margin quadrant scatter. Star/Plowhorse/Puzzle/Dog counts sit
 * in the panel head so the picture reads even before hovering a dot.
 */
export async function ProfitMatrixSection({
  storeId,
  days,
}: {
  storeId?: string
  days: number
}) {
  const result = await loadMenuEngineering(storeId, days)
  if (!result?.ok) return null
  const { rows, counts, medianVelocity, medianUnitMargin } = result.data

  if (rows.length === 0) {
    return (
      <section className="inv-panel dock-in dock-in-2">
        <div className="inv-panel__head">
          <div>
            <span className="inv-panel__dept">§ 14 Menu</span>
            <h2 className="inv-panel__title">Profit matrix</h2>
          </div>
        </div>
        <p className="pt-2 text-[13px] text-[var(--ink-muted)]">
          No costed sales in this window yet.
        </p>
      </section>
    )
  }

  return (
    <section className="inv-panel dock-in dock-in-2">
      <div className="inv-panel__head">
        <div>
          <span className="inv-panel__dept">§ 14 Menu</span>
          <h2 className="inv-panel__title">Profit matrix</h2>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
          {counts.STAR} stars · {counts.PLOWHORSE} plowhorses · {counts.PUZZLE}{" "}
          puzzles · {counts.DOG} dogs
        </span>
      </div>
      <MenuProfitMatrix
        rows={rows}
        medianVelocity={medianVelocity}
        medianUnitMargin={medianUnitMargin}
      />
      <p className="mt-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
        Dashed lines are menu medians — quadrants are relative to your own menu
      </p>
    </section>
  )
}
