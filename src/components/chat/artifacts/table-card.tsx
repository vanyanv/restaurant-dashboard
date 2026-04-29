"use client"

import type { ReactNode } from "react"
import { CardShell, Num } from "./card-shell"

export interface TableColumn<T> {
  header: string
  align?: "left" | "right"
  render: (row: T) => ReactNode
}

interface Props<T> {
  dept: string
  caption: ReactNode
  subline?: ReactNode
  rows: T[]
  columns: TableColumn<T>[]
  /** Cap visible rows so the card stays glanceable; full set still renders
   *  inside the scroll container. Defaults to 10. */
  maxVisible?: number
  footerHref?: string
  footerLabel?: string
  defaultOpen?: boolean
  /** Optional tail row rendered after the body, e.g. a totals row. */
  totalsRow?: ReactNode
  /** Index of the row that the assistant's prose is answering about
   *  (e.g. 0 for "biggest invoice", index of max for "best store"). The
   *  matching `<tr>` gets a red proofmark left-bar + faint tint. */
  highlightedRowIndex?: number
}

/**
 * Generic hairline-ruled table artifact. Used for vendor breakdowns, top
 * menu items, COGS rows, and any other multi-row tool result that doesn't
 * map to a per-entity card. Tabular numbers throughout via the cell
 * `align="right"` opt.
 */
export function TableCard<T>({
  dept,
  caption,
  subline,
  rows,
  columns,
  maxVisible = 10,
  footerHref,
  footerLabel,
  defaultOpen,
  totalsRow,
  highlightedRowIndex,
}: Props<T>) {
  const overflow = rows.length > maxVisible
  return (
    <CardShell
      dept={dept}
      headline={caption}
      subline={subline}
      footerHref={footerHref}
      footerLabel={footerLabel}
      defaultOpen={defaultOpen ?? rows.length <= 3}
    >
      <div
        className={
          "chat-artifact__table-wrap" +
          (overflow ? " chat-artifact__table-wrap--scroll" : "")
        }
      >
        <table className="chat-artifact__table">
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={i} className={c.align === "right" ? "num" : undefined}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={i}
                className={i === highlightedRowIndex ? "is-highlighted" : undefined}
              >
                {columns.map((c, j) => (
                  <td key={j} className={c.align === "right" ? "num" : undefined}>
                    {c.align === "right" ? <Num>{c.render(r)}</Num> : c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {totalsRow ? <tfoot>{totalsRow}</tfoot> : null}
        </table>
      </div>
    </CardShell>
  )
}
