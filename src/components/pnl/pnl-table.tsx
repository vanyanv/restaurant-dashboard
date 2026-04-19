import { PnLRow } from "./pnl-row"
import type { Period, PnLRow as PnLRowType } from "@/lib/pnl"

export interface PnLTableProps {
  periods: Period[]
  rows: PnLRowType[]
  configureHref?: string
}

export function PnLTable({ periods, rows, configureHref }: PnLTableProps) {
  return (
    <div className="rounded-lg border overflow-x-auto bg-card">
      <table className="w-full border-collapse">
        <thead className="bg-muted/60">
          <tr>
            <th className="sticky left-0 bg-muted/60 px-3 py-2 text-left text-xs font-semibold whitespace-nowrap">
              Account
            </th>
            {periods.map((p, i) => (
              <th
                key={i}
                className="px-3 py-2 text-right text-xs font-semibold whitespace-nowrap"
              >
                {p.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <PnLRow
              key={r.code}
              row={r}
              periodCount={periods.length}
              configureHref={r.isFixed ? configureHref : undefined}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
