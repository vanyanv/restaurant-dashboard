import type { ReactNode } from "react"

/**
 * Where a column goes when the container is phone width and the table
 * becomes a stack of cards: `title` and `amount` share the top line,
 * `detail` and `status` the second. `hide` drops it on the phone.
 */
export type RowSlot = "title" | "detail" | "amount" | "status" | "hide"

export type RowsColumn<R> = {
  key: string
  label: string
  slot: RowSlot
  align?: "start" | "end"
  render: (row: R) => ReactNode
}

/**
 * A table on the desk, stacked cards on the phone, from the same rows.
 *
 * Shared block: the phone form `Table` never had (45 desk files use one,
 * the phone pages draw `.mlist` instead), plus `.iv-row`, `.ck-row`,
 * `.pp-row`. It is a real `<table>` so a screen reader reads it as one at
 * every width; at phone width CSS lays each `<tr>` out as a card.
 */
export function Rows<R>({
  columns,
  rows,
  rowKey,
  caption,
}: {
  columns: RowsColumn<R>[]
  rows: R[]
  rowKey: (row: R) => string
  caption?: string
}) {
  return (
    <div className="cu-rows">
      <table className="cu-rows__t">
        {caption ? <caption className="cu-rows__cap">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.align === "end" ? "cu-end" : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  data-slot={c.slot}
                  className={c.align === "end" ? "cu-end" : undefined}
                >
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
