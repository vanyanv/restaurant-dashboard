import type { CSSProperties, ReactNode } from "react"

/**
 * A row with a name, a sub-line under it, and controls on the right.
 *
 * Ported from `P.ingredients.desk()`'s review inbox at line 5793 of
 * `docs/counter/counter-prototype.html`:
 *
 * ```
 * <div class="rowline" style="grid-template-columns:minmax(0,1fr) 96px auto auto">
 *   <span class="nm">Ground beef 73/27<span>GRND BEEF FINE GRND 73/27 · I28517</span></span>
 *   <span class="mtag good">96% match</span>
 *   <button class="btn">Accept</button>
 *   <button class="btn btn--quiet">Not this</button>
 * </div>
 * ```
 *
 * `.rowline` and its four child rules
 * (`src/styles/counter-components.css:842-847`) carry the grid, the bottom
 * rule that the last row drops, and `.nm span`'s mono sub-line with its
 * ellipsis — and **nothing in this tree emitted any of them until this file**.
 *
 * ## The columns are the caller's
 *
 * The sheet's own `grid-template-columns` is the RECIPE EDITOR's six-column
 * shape (grip, name, qty, unit, cost, remove). The prototype overrides it
 * inline everywhere else, which is why `columns` is a required prop rather
 * than a default: a caller that forgets it gets the editor's grid and six
 * columns of empty space, silently.
 */
export function RowLine({
  columns,
  name,
  sub,
  children,
}: {
  /** The inline `grid-template-columns`, e.g. `"minmax(0,1fr) 96px auto auto"`. */
  columns: string
  name: string
  /** `.nm span` — the mono line under the name, ellipsised by the sheet. */
  sub?: string
  /** Everything after the name: tags, buttons, figures. */
  children: ReactNode
}) {
  return (
    <div className="rowline" style={{ gridTemplateColumns: columns } as CSSProperties}>
      <span className="nm">
        {name}
        {sub ? <span>{sub}</span> : null}
      </span>
      {children}
    </div>
  )
}
