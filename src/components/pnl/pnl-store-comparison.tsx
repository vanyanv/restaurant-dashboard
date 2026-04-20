import Link from "next/link"
import { cn } from "@/lib/utils"

/**
 * Side-by-side P&L comparison for the home page. Stores are columns, GL
 * lines are rows, with a Total column on the right. Aggregated for the
 * selected dashboard range (no per-period breakdown — that's the /pnl page).
 */
export type StoreComparisonColumn = {
  storeId: string | null
  storeName: string
  grossSales: number
  cogsValue: number
  laborValue: number
  rentValue: number
  bottomLine: number
  marginPct: number
  /** "—" badge when the store has rent/labor gaps that skew the numbers. */
  fixedCostsConfigured: boolean
}

export interface PnLStoreComparisonProps {
  stores: StoreComparisonColumn[]
  total: StoreComparisonColumn
  className?: string
}

function formatDollar(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "—"
  const abs = Math.abs(v)
  const str = abs.toLocaleString("en-US", { maximumFractionDigits: 0 })
  return v < 0 ? `(${str})` : `$${str}`
}

function formatPct(p: number): string {
  if (!Number.isFinite(p) || p === 0) return "—"
  return `${(p * 100).toFixed(1)}%`
}

interface RowSpec {
  code: string
  label: string
  isSubtotal?: boolean
  /** When true, render as a cost (parens / red tone optional). */
  isCost?: boolean
  value: (c: StoreComparisonColumn) => number
  /** Percent-of-sales displayed beneath the dollar figure. */
  pct?: (c: StoreComparisonColumn) => number
}

export function PnLStoreComparison({
  stores,
  total,
  className,
}: PnLStoreComparisonProps) {
  if (stores.length === 0) return null

  const pctOfSales = (c: StoreComparisonColumn, v: number) =>
    c.grossSales === 0 ? 0 : v / c.grossSales

  const rows: RowSpec[] = [
    {
      code: "gross",
      label: "Gross Sales",
      value: (c) => c.grossSales,
    },
    {
      code: "cogs",
      label: "COGS",
      isCost: true,
      value: (c) => c.cogsValue,
      pct: (c) => pctOfSales(c, c.cogsValue),
    },
    {
      code: "labor",
      label: "Labor",
      isCost: true,
      value: (c) => c.laborValue,
      pct: (c) => pctOfSales(c, c.laborValue),
    },
    {
      code: "rent",
      label: "Rent + Fixed",
      isCost: true,
      value: (c) => c.rentValue,
      pct: (c) => pctOfSales(c, c.rentValue),
    },
    {
      code: "bottom",
      label: "Bottom Line",
      isSubtotal: true,
      value: (c) => c.bottomLine,
    },
    {
      code: "margin",
      label: "Margin",
      isSubtotal: true,
      value: (c) => c.marginPct,
    },
  ]

  // Columns: each store + total
  const cols = [...stores, total]
  const templateCols = [
    "minmax(120px, 1.2fr)",
    ...cols.map((c, i) =>
      i === cols.length - 1
        ? "minmax(100px, 1.2fr)"
        : "minmax(100px, 1fr)"
    ),
  ].join(" ")

  return (
    <section className={cn("pnl-comparison", className)} aria-label="Stores side by side">
      <div
        className="pnl-comparison__grid"
        style={{ gridTemplateColumns: templateCols }}
        role="table"
      >
        {/* Header row */}
        <div className="pnl-comparison__cell pnl-comparison__cell--head pnl-comparison__cell--label" role="columnheader" />
        {cols.map((c, i) => {
          const isTotal = i === cols.length - 1
          const name = c.storeName
          const inner = (
            <>
              <span className={cn("pnl-comparison__storeName font-display", isTotal && "pnl-comparison__storeName--total")}>
                {name}
              </span>
              {!c.fixedCostsConfigured && !isTotal ? (
                <span className="pnl-comparison__warn" title="Fixed costs not configured">
                  incomplete
                </span>
              ) : null}
            </>
          )
          return (
            <div
              key={c.storeId ?? "total"}
              className={cn(
                "pnl-comparison__cell pnl-comparison__cell--head pnl-comparison__cell--num",
                isTotal && "pnl-comparison__cell--total"
              )}
              role="columnheader"
            >
              {c.storeId ? (
                <Link
                  href={`/dashboard/pnl/${c.storeId}`}
                  className="pnl-comparison__storeLink"
                >
                  {inner}
                </Link>
              ) : (
                <div className="pnl-comparison__storeLink pnl-comparison__storeLink--static">
                  {inner}
                </div>
              )}
            </div>
          )
        })}

        {/* Body rows */}
        {rows.flatMap((row) => {
          const cells: React.ReactNode[] = []
          cells.push(
            <div
              key={`${row.code}-label`}
              className={cn(
                "pnl-comparison__cell pnl-comparison__cell--label",
                row.isSubtotal && "pnl-comparison__cell--subtotal"
              )}
              role="rowheader"
            >
              <span
                className={cn(
                  "pnl-comparison__rowLabel",
                  row.isSubtotal && "font-display"
                )}
              >
                {row.label}
              </span>
            </div>
          )
          for (let i = 0; i < cols.length; i++) {
            const c = cols[i]
            const isTotal = i === cols.length - 1
            const raw = row.value(c)
            const pct = row.pct ? row.pct(c) : null
            const display =
              row.code === "margin" ? formatPct(raw) : formatDollar(raw)
            cells.push(
              <div
                key={`${row.code}-${c.storeId ?? "total"}`}
                className={cn(
                  "pnl-comparison__cell pnl-comparison__cell--num",
                  row.isSubtotal && "pnl-comparison__cell--subtotal",
                  isTotal && "pnl-comparison__cell--total",
                  row.code === "margin" &&
                    raw < 0 &&
                    "pnl-comparison__cell--negative"
                )}
                role="cell"
              >
                <span className={cn("font-mono", row.isSubtotal && "pnl-comparison__subtotalNum")}>
                  {display}
                </span>
                {pct != null ? (
                  <span className="pnl-comparison__pct font-mono">
                    {formatPct(pct)}
                  </span>
                ) : null}
              </div>
            )
          }
          return cells
        })}
      </div>
    </section>
  )
}
