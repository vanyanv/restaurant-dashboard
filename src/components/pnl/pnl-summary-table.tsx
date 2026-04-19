import Link from "next/link"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { PnLRow } from "@/lib/pnl"
import {
  TOTAL_SALES_CODE,
  UBER_COMMISSION_CODE,
  DOORDASH_COMMISSION_CODE,
  NET_AFTER_COMMISSIONS_CODE,
  LABOR_CODE,
  RENT_CODE,
  AFTER_LABOR_RENT_CODE,
} from "@/lib/pnl"

function formatDollar(v: number): string {
  const abs = Math.abs(v)
  const str = abs.toLocaleString("en-US", { maximumFractionDigits: 0 })
  return v < 0 ? `(${str})` : str
}

function formatPercent(p: number): string {
  return `${(p * 100).toFixed(1)}%`
}

function rangeSum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}

interface SummaryEntry {
  label: string
  value: number
  pct: number
  isSubtotal?: boolean
  isCost?: boolean
  isUnknown?: boolean
}

/** Group the GL rows into operator-friendly summary rows. */
function buildSummary(
  rows: PnLRow[],
  totalSalesRange: number
): SummaryEntry[] {
  const byCode = new Map(rows.map((r) => [r.code, r]))
  const sumRange = (codes: string[]): number => {
    let s = 0
    for (const c of codes) {
      const r = byCode.get(c)
      if (r) s += rangeSum(r.values)
    }
    return s
  }
  const pct = (v: number) => (totalSalesRange === 0 ? 0 : v / totalSalesRange)

  const inStore = sumRange(["4010", "4011"])
  const delivery = sumRange(["4012", "4013", "4014"])
  const other = sumRange(["4015", "4016", "4017", "4018", "4018P", "4020"])
  const svc = sumRange(["4040"])
  const tax = sumRange(["4100"])
  const disc = sumRange(["4110"])
  const total = sumRange([TOTAL_SALES_CODE])
  const uberCom = sumRange([UBER_COMMISSION_CODE])
  const ddCom = sumRange([DOORDASH_COMMISSION_CODE])
  const netAC = sumRange([NET_AFTER_COMMISSIONS_CODE])
  const laborRow = byCode.get(LABOR_CODE)
  const rentRow = byCode.get(RENT_CODE)
  const labor = laborRow ? rangeSum(laborRow.values) : 0
  const rent = rentRow ? rangeSum(rentRow.values) : 0
  const bottom = sumRange([AFTER_LABOR_RENT_CODE])

  const laborUnknown = laborRow?.isUnknown?.every(Boolean) ?? false
  const rentUnknown = rentRow?.isUnknown?.every(Boolean) ?? false

  return [
    { label: "In-Store (Credit Cards + Cash)", value: inStore, pct: pct(inStore) },
    { label: "3P Delivery (Uber + DoorDash + Grubhub)", value: delivery, pct: pct(delivery) },
    { label: "Other Channels", value: other, pct: pct(other) },
    { label: "Service Charge", value: svc, pct: pct(svc) },
    { label: "Sales Tax", value: tax, pct: pct(tax) },
    { label: "Discounts", value: disc, pct: pct(disc) },
    { label: "Total Sales", value: total, pct: 1, isSubtotal: true },
    { label: "Uber + DoorDash Commissions", value: uberCom + ddCom, pct: pct(uberCom + ddCom), isCost: true },
    { label: "Net Sales After Commissions", value: netAC, pct: pct(netAC), isSubtotal: true },
    { label: "Labor (fixed)", value: labor, pct: pct(labor), isCost: true, isUnknown: laborUnknown },
    { label: "Rent (fixed)", value: rent, pct: pct(rent), isCost: true, isUnknown: rentUnknown },
    { label: "Bottom Line", value: bottom, pct: pct(bottom), isSubtotal: true },
  ]
}

export interface PnLSummaryTableProps {
  rows: PnLRow[]
  configureHref?: string
  className?: string
}

export function PnLSummaryTable({
  rows,
  configureHref,
  className,
}: PnLSummaryTableProps) {
  const totalRow = rows.find((r) => r.code === TOTAL_SALES_CODE)
  const totalSalesRange = totalRow ? rangeSum(totalRow.values) : 0
  const entries = buildSummary(rows, totalSalesRange)

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">Summary</CardTitle>
        <CardDescription>Key lines for the selected range</CardDescription>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <tbody>
            {entries.map((e, i) => {
              const negative = e.value < 0
              const subtotalCls = e.isSubtotal
                ? "font-semibold bg-muted/40 border-t-2"
                : i === 0
                ? ""
                : "border-t"
              const valueCls = cn(
                "tabular-nums text-right px-3 py-2",
                negative && !e.isUnknown && "text-red-600 dark:text-red-400"
              )
              return (
                <tr key={e.label} className={subtotalCls}>
                  <td className="px-3 py-2">{e.label}</td>
                  {e.isUnknown ? (
                    <td className="px-3 py-2 text-right">
                      {configureHref ? (
                        <Link href={configureHref} className="text-muted-foreground underline underline-offset-2 hover:text-foreground">
                          —
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  ) : (
                    <td className={valueCls}>{formatDollar(e.value)}</td>
                  )}
                  <td className="px-3 py-2 text-right text-xs text-muted-foreground w-16 tabular-nums">
                    {formatPercent(e.pct)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
