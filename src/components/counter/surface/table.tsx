import Link from "next/link"
import { TABULAR } from "@/lib/counter/format"

export interface Column {
  key: string
  label: string
  /** Right-aligned and tabular. Every figure column should set this. */
  numeric?: boolean
}

export interface Row {
  key: string
  cells: React.ReactNode[]
  /** Where this row opens. Omit it and the row is inert — see note 47. */
  href?: string
}

/**
 * Horizontal rules only, sticky head, right-aligned figures.
 *
 * Sole state renderer is `Section` (R3): a `Table` takes `columns` and `rows`
 * directly and has no loading/empty/failed branches of its own — nest it
 * inside a `Section` to get the six-state contract. That also means the old
 * double-render risk (the same data reaching both a `Section` and a `Table`)
 * cannot happen: only `Section` ever sees a `SectionData`.
 *
 * Note 47 is why the `href` handling is written the way it is: in the
 * prototype, `.tbl tbody tr` set `cursor:pointer` and an accent hover wash on
 * EVERY row of EVERY table, and not one of them led anywhere. A row that opens
 * nothing must not be focusable, must not wear a pointer, and must not light up
 * under the cursor — otherwise the table lies about what it can do.
 *
 * A navigable row uses the "stretched link" pattern rather than either
 * extreme: wrapping every cell in click handlers (synthetic interactivity,
 * wrong keyboard/focus/ARIA behaviour — the same lie note 47 warns about, just
 * relocated) or leaving only column one clickable while the whole row still
 * wears a pointer (a smaller version of the same lie — the affordance
 * promises more than the behaviour delivers). Instead there is exactly one
 * native `<a>`, in the first cell, whose `::after` is stretched with
 * `after:absolute after:inset-0` to cover the row — the row itself supplies
 * the `relative` positioning context that stretch resolves against. One link
 * in the accessibility tree, correct keyboard/focus behaviour for free, and a
 * pointer that now tells the truth across the full row width.
 *
 * `maxHeight` is optional. When set, the wrapper is constrained to that
 * height and scrolls vertically, and the header genuinely sticks inside it.
 * When unset, there is nothing to scroll vertically inside, `overflow-y`
 * resolves to visible, and the header is NOT sticky — `overflow-x-auto`
 * alone makes the wrapper its own scroll container with
 * `clientHeight === scrollHeight`, so a `sticky` header inside it never
 * moves relative to that container and never sticks against the page.
 * Verified in a real browser (2a): see the fix report for measured values.
 */
export function Table({
  columns,
  rows,
  maxHeight,
}: {
  columns: Column[]
  rows: Row[]
  /** e.g. "480px". Constrains the wrapper so it scrolls vertically and the head sticks. */
  maxHeight?: string
}) {
  return (
    <div
      data-table-scroll
      className="overflow-x-auto"
      style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}
    >
      <table className="w-full border-collapse text-ct-body">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`${maxHeight ? "sticky top-0 z-10 " : ""}border-b border-ct-line-strong bg-ct-surface px-3 py-2 font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3 ${
                  c.numeric ? "text-right" : "text-left"
                }`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const navigable = Boolean(r.href)
            return (
              <tr
                key={r.key}
                className={
                  navigable
                    ? "relative cursor-pointer border-b border-ct-line hover:bg-ct-accent-wash"
                    : "border-b border-ct-line"
                }
              >
                {r.cells.map((cell, i) => {
                  const c = columns[i]
                  const content =
                    navigable && i === 0 ? (
                      // Stretched over the whole `relative` row via `::after`.
                      // If a row ever gains its own interactive control (a
                      // checkbox, a row menu), that control MUST be given
                      // `relative z-10` or this overlay will swallow its
                      // clicks. Known, accepted cost: dragging to select this
                      // cell's text is harder with the overlay in place.
                      <Link href={r.href!} className="block after:absolute after:inset-0">
                        {cell}
                      </Link>
                    ) : (
                      cell
                    )
                  return (
                    <td
                      key={c.key}
                      className={`px-3 py-2 text-ct-ink ${
                        c.numeric ? `text-right ${TABULAR}` : "text-left"
                      }`}
                    >
                      {content}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
