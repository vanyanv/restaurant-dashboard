"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronRight, Search, TableProperties } from "lucide-react"
import { formatCurrency } from "@/lib/format"
import type { StoreSummaryRow } from "@/types/analytics"
import { cn } from "@/lib/utils"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

const fmtCurrency = (v: number | null) => formatCurrency(v ?? 0)

const COLUMNS: {
  key: keyof StoreSummaryRow
  label: string
  shortLabel?: string
  format: (v: number | null) => string
  negative?: boolean
}[] = [
  { key: "grossSales", label: "Gross Sales", format: fmtCurrency },
  {
    key: "fulfilledOrders",
    label: "Fulfilled Orders",
    shortLabel: "Orders",
    format: (v) => (v ?? 0).toLocaleString(),
  },
  { key: "discounts", label: "Discounts", format: fmtCurrency, negative: true },
  { key: "loyalty", label: "Loyalty", format: fmtCurrency, negative: true },
  {
    key: "refundsAdjustments",
    label: "Refunds & Adj",
    shortLabel: "Refunds",
    format: fmtCurrency,
    negative: true,
  },
  { key: "netSales", label: "Net Sales", format: fmtCurrency },
  {
    key: "serviceCharges",
    label: "Service Charges",
    shortLabel: "Svc Chg",
    format: fmtCurrency,
  },
  {
    key: "commissionFees",
    label: "Commission & Fees",
    shortLabel: "Comm & Fees",
    format: fmtCurrency,
    negative: true,
  },
  {
    key: "taxCollected",
    label: "Tax Collected",
    shortLabel: "Tax Coll",
    format: fmtCurrency,
  },
  {
    key: "taxRemitted",
    label: "Tax Remitted",
    shortLabel: "Tax Rem",
    format: fmtCurrency,
    negative: true,
  },
  { key: "tips", label: "Tips", format: fmtCurrency },
  { key: "paidIn", label: "Paid In", format: fmtCurrency },
  { key: "paidOut", label: "Paid Out", format: fmtCurrency, negative: true },
  {
    key: "theoreticalDeposit",
    label: "Theo. Deposit",
    shortLabel: "Theo Dep",
    format: fmtCurrency,
  },
  {
    key: "cashDrawerRecon",
    label: "Cash Recon",
    format: (v) => (v != null ? formatCurrency(v) : "\u2014"),
  },
  {
    key: "expectedDeposit",
    label: "Expected Deposit",
    shortLabel: "Exp Dep",
    format: fmtCurrency,
  },
]

function CellValue({
  value,
  negative,
  format,
  bold,
}: {
  value: number | null
  negative?: boolean
  format: (v: number | null) => string
  bold?: boolean
}) {
  const num = value ?? 0
  const isNeg = num < 0

  return (
    <span
      className={cn(
        "font-mono-numbers text-sm whitespace-nowrap",
        bold && "font-semibold",
        isNeg && "text-rose-600 dark:text-rose-400",
        negative && num !== 0 && !isNeg && "text-rose-600 dark:text-rose-400",
        !isNeg && !negative && "text-foreground"
      )}
    >
      {format(value)}
    </span>
  )
}

interface FinancialSummaryTableProps {
  rows: StoreSummaryRow[]
  totals: StoreSummaryRow
  channelRows: StoreSummaryRow[]
}

export function FinancialSummaryTable({
  rows,
  totals,
  channelRows,
}: FinancialSummaryTableProps) {
  const [search, setSearch] = useState("")
  const [viewBy, setViewBy] = useState<"location" | "channel">("location")

  const displayedRows = viewBy === "location" ? rows : channelRows
  const filteredRows = search
    ? displayedRows.filter((r) =>
        r.storeName.toLowerCase().includes(search.toLowerCase())
      )
    : displayedRows

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
      {/* Table Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <TableProperties className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">
              Sales Breakdown
            </h3>
          </div>
          <ToggleGroup
            type="single"
            value={viewBy}
            onValueChange={(v) => {
              if (v) {
                setViewBy(v as "location" | "channel")
                setSearch("")
              }
            }}
            variant="outline"
            className="h-7"
          >
            <ToggleGroupItem value="location" className="h-6 px-2 text-xs">
              Location
            </ToggleGroupItem>
            <ToggleGroupItem value="channel" className="h-6 px-2 text-xs">
              Channel
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder={viewBy === "location" ? "Search locations..." : "Search channels..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-full sm:w-[200px] rounded-md border border-input bg-background pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {/* Table */}
      <div className="relative overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="sticky left-0 z-20 bg-muted/95 backdrop-blur-sm px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground min-w-[160px]">
                {viewBy === "location" ? "Location" : "Channel"}
              </th>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap min-w-[100px]"
                >
                  {col.shortLabel ?? col.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {filteredRows.map((row, idx) => (
              <tr
                key={row.storeId}
                className={cn(
                  "group border-b border-border/40 transition-colors hover:bg-primary/[0.03]",
                  idx % 2 === 1 && "bg-muted/15"
                )}
              >
                <td className="sticky left-0 z-10 bg-card group-hover:bg-primary/[0.03] px-3 py-2 transition-colors">
                  <div className="flex items-center gap-1">
                    <span className="absolute left-0 top-0 h-full w-[3px] bg-transparent group-hover:bg-primary transition-colors" />
                    {viewBy === "location" ? (
                      <>
                        <Link
                          href={`/dashboard/analytics/${row.storeId}`}
                          className="font-medium text-foreground hover:text-primary hover:underline underline-offset-2 transition-colors"
                        >
                          {row.storeName}
                        </Link>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </>
                    ) : (
                      <span className="font-medium text-foreground">
                        {row.storeName}
                      </span>
                    )}
                  </div>
                </td>
                {COLUMNS.map((col) => (
                  <td key={col.key} className="px-3 py-2 text-right">
                    <CellValue
                      value={row[col.key] as number | null}
                      negative={col.negative}
                      format={col.format}
                    />
                  </td>
                ))}
              </tr>
            ))}
            {filteredRows.length === 0 && (
              <tr>
                <td
                  colSpan={COLUMNS.length + 1}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  No {viewBy === "location" ? "locations" : "channels"} match &ldquo;{search}&rdquo;
                </td>
              </tr>
            )}
          </tbody>

          <tfoot>
            <tr className="border-t-2 border-foreground/15 bg-muted/30">
              <td className="sticky left-0 z-10 bg-muted/90 backdrop-blur-sm px-3 py-2">
                <span className="text-xs font-bold uppercase tracking-widest text-foreground">
                  Total
                </span>
              </td>
              {COLUMNS.map((col) => (
                <td key={col.key} className="px-3 py-2 text-right">
                  <CellValue
                    value={totals[col.key] as number | null}
                    negative={col.negative}
                    format={col.format}
                    bold
                  />
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Row count footer */}
      <div className="px-3 py-1.5 border-t border-border/50 bg-muted/20">
        <span className="text-[11px] text-muted-foreground">
          {filteredRows.length} of {displayedRows.length}{" "}
          {viewBy === "location" ? "location" : "channel"}
          {displayedRows.length !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  )
}

export function FinancialSummaryTableSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
      {/* Header skeleton */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 rounded bg-muted animate-pulse" />
          <div className="space-y-1.5">
            <div className="h-3.5 w-28 rounded bg-muted animate-pulse" />
            <div className="h-2.5 w-20 rounded bg-muted animate-pulse" />
          </div>
        </div>
        <div className="h-8 w-[200px] rounded-md bg-muted animate-pulse" />
      </div>

      {/* Table skeleton */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="px-3 py-2 text-left">
                <div className="h-3 w-16 rounded bg-muted animate-pulse" />
              </th>
              {Array.from({ length: 8 }).map((_, i) => (
                <th key={i} className="px-3 py-2 text-right">
                  <div className="ml-auto h-3 w-16 rounded bg-muted animate-pulse" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 3 }).map((_, rowIdx) => (
              <tr key={rowIdx} className="border-b border-border/40">
                <td className="px-3 py-2">
                  <div className="h-4 w-28 rounded bg-muted animate-pulse" />
                </td>
                {Array.from({ length: 8 }).map((_, cellIdx) => (
                  <td key={cellIdx} className="px-3 py-2 text-right">
                    <div className="ml-auto h-4 w-16 rounded bg-muted animate-pulse" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
