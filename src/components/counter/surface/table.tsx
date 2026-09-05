"use client"

import { Fragment, isValidElement, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { useFlip } from "@/components/counter/motion/use-flip"

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
 * `.tbl tbody tr[data-goto] td:first-child{position:relative}` (line 202)
 * makes the FIRST CELL the containing block, so the stretch resolves against
 * the cell instead of the row and covers one column. Line 204 does the same to
 * the last cell and hangs the chevron off it. So the row-level affordance and
 * the cell-level overlay are two designs for the same job, and only one of
 * them is the one every rule in `counter-components.css` was written for.
 *
 * Note 47 states the replacement outright: "because a row is not a button, it
 * carries `role="link"`, a tab stop, and an Enter/Space handler". THREE costs
 * are real and worth naming, and none of them is fixed here because each
 * follows from matching the prototype:
 *
 *   1. a `<tr role="link">` is no longer a `row` in the accessibility tree;
 *   2. there is no href, so no middle-click and no "open in new tab" (a real
 *      `<a>` on the first cell's own text was investigated in task 5 and
 *      declined: it restores the gesture for one word rather than the row, and
 *      costs a second focusable element inside a `role="link"` whose children
 *      are presentational — six tab stops on a three-row table, three of them
 *      announcing nothing — plus a double navigation);
 *   3. the `<td>`s inside a `role="link"` row lose their implicit `cell` role,
 *      so a screen reader reads the row as ONE concatenated link label instead
 *      of column by column. The stretched anchor kept the table intact; this
 *      is what the prototype's row-level affordance costs.
 *
 * What IS fixed is a bug that was hiding inside cost 2. `onClick` on the whole
 * `<tr>` fires for any click anywhere in it — including the mouseup that ends a
 * text-selection drag, and including a click on any control a cell gains later.
 * A native anchor did neither. `rowClick` below guards both.
 */
/**
 * Anything inside a row that has its own click behaviour. A click that lands on
 * one of these is that control's, not the row's — which is how a native anchor
 * behaved, and what an `onClick` on the whole `<tr>` silently took away.
 *
 * `[tabindex]:not([tabindex="-1"])` would match the ROW itself, so the match is
 * always tested against the row it started from before it is honoured.
 */
const INTERACTIVE_IN_ROW =
  'a[href],button,input,select,textarea,label,summary,[role="button"],[role="link"],' +
  '[role="checkbox"],[role="menuitem"],[contenteditable="true"],[tabindex]:not([tabindex="-1"])'

/**
 * True when the reader has text selected. A drag that starts in one cell and
 * ends in another fires `click` on the row at mouseup, and navigating away from
 * the figures someone just selected is the worst possible response to
 * "I wanted to copy this".
 *
 * Guarded for the environments where `getSelection` is absent rather than
 * assumed present — this component renders under jsdom in tests and inside a
 * server-rendered tree in production.
 */
function hasTextSelection(): boolean {
  if (typeof window === "undefined" || typeof window.getSelection !== "function") return false
  const selection = window.getSelection()
  return !!selection && !selection.isCollapsed && selection.toString().length > 0
}

export function Table({ columns, rows }: { columns: Column[]; rows: Row[] }) {
  const router = useRouter()
  // D11: when the same rows come back in a different order (a sort, a range
  // change that re-ranks them), each row travels to its new place over 220ms
  // instead of being redrawn there, so the row the reader was on stays
  // findable. Rows that are new fade in under the generated sheet's own rule.
  const body = useRef<HTMLTableSectionElement>(null)
  useFlip(body, rows.map((r) => r.key).join("\n"))

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
        <tbody ref={body}>
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
            // The guard the stretched anchor used to give for free. Keyboard
            // activation deliberately does NOT go through it: Enter on a
            // focused row is unambiguous, and it can neither land on a
            // descendant nor end a drag.
            const rowClick = act
              ? (e: MouseEvent<HTMLTableRowElement>) => {
                  const target = e.target as Element | null
                  const control = target?.closest?.(INTERACTIVE_IN_ROW) ?? null
                  if (control && control !== e.currentTarget) return
                  if (hasTextSelection()) return
                  act()
                }
              : undefined
            // `is-on`, NOT `is-sel`. Task 4's report claimed both were unused
            // hooks and picked the wrong one; the prototype emits
            // `data-ln="…" tabindex="0" role="button"` (counter-prototype.html
            // 6770, 6773) and its own `select()` toggles `is-on` (8968–8976).
            // The sheet follows: `.tbl tbody tr[data-ln].is-on td` washes the
            // row (line 305) and `…td:first-child` adds the accent rail and the
            // bold first cell (306), while `.is-sel` (207–209) has the wash and
            // the bold cell but NO rail and is emitted by nothing. The selector
            // needs BOTH the attribute and the class, which is why `is-on` is
            // only ever set on a row that already carries `data-ln`.
            const classes = [r.className, r.selected ? "is-on" : null].filter(Boolean).join(" ")

            return (
              <Fragment key={r.key}>
                <tr
                  className={classes || undefined}
                  data-flip-key={r.key}
                  // `data-goto` on a link row is what the sheet paints; a
                  // pressable row uses the sheet's other pressable-row hook,
                  // `data-ln` (line 304: `.tbl tbody tr[data-ln]{cursor:pointer}`),
                  // which the `is-on` selector above also depends on.
                  data-goto={r.href}
                  data-ln={r.onSelect ? r.key : undefined}
                  role={r.href ? "link" : r.onSelect ? "button" : undefined}
                  tabIndex={act ? 0 : undefined}
                  aria-label={act ? r.ariaLabel : undefined}
                  onClick={rowClick}
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
