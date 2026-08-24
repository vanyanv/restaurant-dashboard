import Link from "next/link"
import { TABULAR } from "@/lib/counter/format"
import { hasData, type SectionData } from "@/lib/counter/section-data"
import { Skeleton } from "@/components/counter/state/skeleton"

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
 * Note 47 is why the `href` handling is written the way it is: in the
 * prototype, `.tbl tbody tr` set `cursor:pointer` and an accent hover wash on
 * EVERY row of EVERY table, and not one of them led anywhere. A row that opens
 * nothing must not be focusable, must not wear a pointer, and must not light up
 * under the cursor — otherwise the table lies about what it can do.
 */
export function Table<T>({
  data,
  columns,
  rows,
}: {
  data: SectionData<T>
  columns: Column[]
  rows: (data: T) => Row[]
}) {
  const items = hasData(data) ? rows(data.data) : []

  return (
    <div data-table-scroll className="overflow-x-auto">
      <table className="w-full border-collapse text-ct-body">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`sticky top-0 z-10 border-b border-ct-line-strong bg-ct-surface px-3 py-2 font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3 ${
                  c.numeric ? "text-right" : "text-left"
                }`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((r) => {
            const navigable = Boolean(r.href)
            return (
              <tr
                key={r.key}
                className={
                  navigable
                    ? "cursor-pointer border-b border-ct-line hover:bg-ct-accent-wash"
                    : "border-b border-ct-line"
                }
              >
                {r.cells.map((cell, i) => {
                  const c = columns[i]
                  const content =
                    navigable && i === 0 ? (
                      <Link href={r.href!} className="block">
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
      {data.status === "loading" ? (
        <div className="p-3">
          <Skeleton rows={4} />
        </div>
      ) : null}
    </div>
  )
}
