"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCurrency } from "@/lib/format"
import type { PlatformBreakdown } from "@/types/analytics"

const PLATFORM_LABELS: Record<string, string> = {
  "css-pos": "Otter POS",
  "bnm-web": "Otter Online Ordering",
  doordash: "DoorDash",
  ubereats: "Uber Eats",
  grubhub: "Grubhub",
  caviar: "Caviar",
}

function getChannelLabel(row: PlatformBreakdown): string {
  const base = PLATFORM_LABELS[row.platform] ?? row.platform
  if (row.paymentMethod) return `${base} (${row.paymentMethod})`
  return base
}

interface FinancialTableProps {
  data: PlatformBreakdown[]
}

export function FinancialTable({ data }: FinancialTableProps) {
  const baseTotals = data.reduce(
    (acc, p) => ({
      grossSales: acc.grossSales + p.grossSales,
      netSales: acc.netSales + p.netSales,
      fees: acc.fees + p.fees,
      discounts: acc.discounts + p.discounts,
      taxCollected: acc.taxCollected + p.taxCollected,
      taxRemitted: acc.taxRemitted + p.taxRemitted,
      tips: acc.tips + p.tips,
      serviceCharges: acc.serviceCharges + p.serviceCharges,
      loyalty: acc.loyalty + p.loyalty,
      refundsAdjustments: acc.refundsAdjustments + p.refundsAdjustments,
      orderCount: acc.orderCount + p.orderCount,
      paidIn: acc.paidIn + p.paidIn,
      paidOut: acc.paidOut + p.paidOut,
    }),
    {
      grossSales: 0,
      netSales: 0,
      fees: 0,
      discounts: 0,
      taxCollected: 0,
      taxRemitted: 0,
      tips: 0,
      serviceCharges: 0,
      loyalty: 0,
      refundsAdjustments: 0,
      orderCount: 0,
      paidIn: 0,
      paidOut: 0,
    }
  )

  // Recompute derived deposit fields from summed base metrics
  const theoreticalDeposit =
    baseTotals.netSales + baseTotals.taxCollected - Math.abs(baseTotals.taxRemitted)
    + baseTotals.tips + baseTotals.serviceCharges - Math.abs(baseTotals.fees)
  const expectedDeposit = theoreticalDeposit + baseTotals.paidIn - Math.abs(baseTotals.paidOut)

  const totals = {
    ...baseTotals,
    theoreticalDeposit,
    cashDrawerRecon: null as number | null,
    expectedDeposit,
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Financial Breakdown</CardTitle>
        <CardDescription>All channels and metrics</CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className="overflow-x-auto">
          <Table className="min-w-[1100px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Channel</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Orders</TableHead>
                <TableHead className="text-right">Discounts</TableHead>
                <TableHead className="text-right">Loyalty</TableHead>
                <TableHead className="text-right">Refunds</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Svc Charges</TableHead>
                <TableHead className="text-right">Fees</TableHead>
                <TableHead className="text-right">Tax Coll.</TableHead>
                <TableHead className="text-right">Tax Rem.</TableHead>
                <TableHead className="text-right">Tips</TableHead>
                <TableHead className="text-right">Paid In</TableHead>
                <TableHead className="text-right">Paid Out</TableHead>
                <TableHead className="text-right">Theo. Dep.</TableHead>
                <TableHead className="text-right">Cash Recon</TableHead>
                <TableHead className="text-right">Exp. Dep.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => (
                <TableRow key={`${row.platform}-${row.paymentMethod ?? "all"}`}>
                  <TableCell className="font-medium pl-6">
                    {getChannelLabel(row)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(row.grossSales)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.orderCount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(row.discounts)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(row.loyalty)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(row.refundsAdjustments)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(row.netSales)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(row.serviceCharges)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(row.fees)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(row.taxCollected)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(row.taxRemitted)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(row.tips)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(row.paidIn)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(row.paidOut)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(row.theoreticalDeposit)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.cashDrawerRecon != null ? formatCurrency(row.cashDrawerRecon) : "\u2014"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(row.expectedDeposit)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow className="font-semibold">
                <TableCell className="pl-6">Total</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(totals.grossSales)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {totals.orderCount.toLocaleString()}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(totals.discounts)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(totals.loyalty)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(totals.refundsAdjustments)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(totals.netSales)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(totals.serviceCharges)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(totals.fees)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(totals.taxCollected)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(totals.taxRemitted)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(totals.tips)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(totals.paidIn)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(totals.paidOut)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(totals.theoreticalDeposit)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {totals.cashDrawerRecon != null ? formatCurrency(totals.cashDrawerRecon) : "\u2014"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(totals.expectedDeposit)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
