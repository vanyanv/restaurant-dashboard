"use client"

import { Fragment, isValidElement, type KeyboardEvent, type ReactNode } from "react"
import { useRouter } from "next/navigation"

export interface Column {
  key: string
  label: string
  /** The prototype's `c.n`. Puts `class="num"` on BOTH the `th` and every `td`. */
  numeric?: boolean
}

/**
 * The prototype's `{ v, cls }` cell. A bare value is the common case and stays
 * bare; the object form exists for the one thing a value cannot carry — a class
 * on the `td` itself (`hot`, `hole`), which is how the ported sheet paints a
 * cell that is over target or missing from a document.
 */
export interface CellObject {
  v: ReactNode
  cls?: string
}

export type Cell = ReactNode | CellObject

interface RowBase {
  key: string
  /**
   * Keyed by column key, not positional. A row with a missing or extra cell
   * relative to `columns` cannot mis-align or crash — it just renders a gap
   * for whatever key it didn't supply. (The prototype's rows ARE positional;
   * this is the one place we keep our own shape, because a positional array
   * silently shifts every figure one column left when a cell is omitted.)
   */
  cells: Record<string, Cell>
  /** The prototype's `r.attrs` class, e.g. `is-hole`, `is-flagged`. */
  className?: string
  /** The prototype's `r.aria`, on a row that opens something. */
  ariaLabel?: string
  /**
   * The prototype's `r.after` — a drawer that travels with the row that owns
   * it. It is concatenated AFTER `</tr>`, so it must be a SIBLING `<tr>`, not
   * a child: a `<tr>`, `<td>` or `<div>` nested inside a row is invalid table
   * markup that browsers silently reparent, and the reparented DOM would not
   * match the prototype's. Pass a `<tr>`.
   */
  after?: ReactNode
}

/**
 * A row that opens a page. Note 47: the cursor, the hover wash, the focus rail
 * and the chevron all belong to `tr[data-goto]` and arrive with the
 * destination or not at all.
 */
type RowLink = RowBase & { href: string; onSelect?: never; selected?: never }
/**
 * A row that moves a control rather than navigating — note 53's eight
 * pressable weeks. `href` and `onSelect` are mutually exclusive at the type
 * level, because a row that is both has two meanings for Enter.
 */
type RowPress = RowBase & { onSelect: () => void; selected?: boolean; href?: never }
/** A row that opens nothing, and says so by not being focusable. */
type RowInert = RowBase & { href?: never; onSelect?: never; selected?: never }

export type Row = RowLink | RowPress | RowInert

function cellOf(cell: Cell): CellObject {
  if (
    cell !== null &&
    typeof cell === "object" &&
    !isValidElement(cell) &&
    !Array.isArray(cell) &&
    "v" in cell
  ) {
    return cell as CellObject
  }
  return { v: cell as ReactNode }
}

/**
 * The prototype's `tbl()`, line 3055 of `docs/counter/counter-prototype.html`:
 *
 *   <div class="tblscroll">
 *     <table class="tbl">
 *       <thead><tr><th scope="col" class="num"?>…</th></tr></thead>
 *       <tbody>
 *         <tr {attrs}{nav}><td class="num? cls">…</td>…</tr>
 *         {row.after}
 *       </tbody>
 *     </table>
 *   </div>
 *
 * Sole state renderer is `Section` (R3): a `Table` takes `columns` and `rows`
 * directly and has no loading/empty/failed branches of its own.
 *
 * WHY THE STRETCHED LINK IS GONE. The version this replaces put a single
 * `<a class="block after:absolute after:inset-0">` in the first cell and made
 * the `<tr>` `relative`, so one native link covered the row. That pattern
 * cannot coexist with the ported sheet, and the sheet is now the design:
 * `.tbl tbody tr[data-goto] td:first-child{position:relative}` (line 268)
 * makes the FIRST CELL the containing block, so the stretch resolves against
 * the cell instead of the row and covers one column. Line 270 does the same to
 * the last cell and hangs the chevron off it. So the row-level affordance and
 * the cell-level overlay are two designs for the same job, and only one of
 * them is the one every rule in `counter-components.css` was written for.
 *
 * Note 47 states the replacement outright: "because a row is not a button, it
 * carries `role="link"`, a tab stop, and an Enter/Space handler". The cost is
 * real and worth naming: a `<tr role="link">` is no longer a `row` in the
 * accessibility tree, and there is no href for middle-click or "open in new
 * tab". That is the prototype's trade, made deliberately here rather than
 * inherited by accident.
 */
export function Table({ columns, rows }: { columns: Column[]; rows: Row[] }) {
  const router = useRouter()

  return (
    <div className="tblscroll">
      <table className="tbl">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric ? "num" : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const href = r.href
            const act = href ? () => router.push(href) : r.onSelect
            // Enter AND Space — note 47's own words. A row that opens nothing
            // gets no handler, no tab stop and no role, so it wears no cursor.
            const keyDown = act
              ? (e: KeyboardEvent<HTMLTableRowElement>) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    act()
                  }
                }
              : undefined
            const classes = [r.className, r.selected ? "is-sel" : null].filter(Boolean).join(" ")

            return (
              <Fragment key={r.key}>
                <tr
                  className={classes || undefined}
                  // `data-goto` on a link row is what the sheet paints; a
                  // pressable row uses the sheet's other pressable-row hook,
                  // `data-ln` (line 304: `.tbl tbody tr[data-ln]{cursor:pointer}`).
                  data-goto={r.href}
                  data-ln={r.onSelect ? r.key : undefined}
                  role={r.href ? "link" : r.onSelect ? "button" : undefined}
                  tabIndex={act ? 0 : undefined}
                  aria-label={act ? r.ariaLabel : undefined}
                  onClick={act}
                  onKeyDown={keyDown}
                >
                  {columns.map((c) => {
                    const { v, cls } = cellOf(r.cells[c.key])
                    const className = `${c.numeric ? "num " : ""}${cls ?? ""}`.trim()
                    return (
                      <td key={c.key} className={className || undefined}>
                        {v}
                      </td>
                    )
                  })}
                </tr>
                {/* A sibling of the row, never a child of it. */}
                {r.after}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
