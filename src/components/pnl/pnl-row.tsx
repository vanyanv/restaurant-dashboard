import Link from "next/link"
import { cn } from "@/lib/utils"
import type { PnLRow as PnLRowType } from "@/lib/pnl"

function formatDollar(v: number): string {
  const abs = Math.abs(v)
  const str = abs.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  return v < 0 ? `(${str})` : str
}

function formatPercent(p: number): string {
  return `${(p * 100).toFixed(1)}%`
}

export interface PnLRowProps {
  row: PnLRowType
  periodCount: number
  configureHref?: string
}

export function PnLRow({ row, periodCount, configureHref }: PnLRowProps) {
  const rowClasses = cn(
    "border-t",
    row.isSubtotal && "font-semibold bg-muted/40 border-t-2",
    row.isFixed && "text-muted-foreground"
  )

  return (
    <tr className={rowClasses}>
      <td className="sticky left-0 bg-inherit px-3 py-1.5 text-xs whitespace-nowrap">
        {row.code && !row.code.startsWith("TOTAL") && !row.code.startsWith("AFTER")
          ? `${row.code} - ${row.label}`
          : row.label}
      </td>
      {Array.from({ length: periodCount }).map((_, i) => {
        const val = row.values[i] ?? 0
        const pct = row.percents[i] ?? 0
        const unknown = row.isUnknown?.[i] ?? false
        const negative = val < 0

        return (
          <td
            key={i}
            className={cn(
              "px-3 py-1.5 text-right text-xs tabular-nums whitespace-nowrap",
              negative && !unknown && "text-red-600 dark:text-red-400"
            )}
          >
            {unknown ? (
              configureHref ? (
                <Link
                  href={configureHref}
                  className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  title="Set fixed costs"
                >
                  —
                </Link>
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            ) : (
              <>
                <div>{formatDollar(val)}</div>
                <div className="text-[10px] text-muted-foreground">
                  {formatPercent(pct)}
                </div>
              </>
            )}
          </td>
        )
      })}
    </tr>
  )
}
