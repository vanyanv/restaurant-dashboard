"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowRight, FileText, Search } from "lucide-react"
import { formatCurrency } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type {
  InvoiceKpis,
  InvoiceBreakdownData,
  InvoiceStoreRow,
  InvoiceVendorRow,
} from "@/types/invoice"

const fmtCurrency = (v: number) => formatCurrency(v)
const fmtInt = (v: number) => v.toLocaleString()

interface Column {
  key: string
  label: string
  format: (v: number) => string
  highlight?: boolean
}

const STORE_COLUMNS: Column[] = [
  { key: "totalSpend", label: "Total Spend", format: fmtCurrency },
  { key: "invoiceCount", label: "Invoices", format: fmtInt },
  { key: "avgInvoice", label: "Avg Invoice", format: fmtCurrency },
  { key: "vendorCount", label: "Vendors", format: fmtInt },
  { key: "needsReview", label: "Needs Review", format: fmtInt, highlight: true },
]

const VENDOR_COLUMNS: Column[] = [
  { key: "totalSpend", label: "Total Spend", format: fmtCurrency },
  { key: "invoiceCount", label: "Invoices", format: fmtInt },
  { key: "avgInvoice", label: "Avg Invoice", format: fmtCurrency },
  { key: "storeCount", label: "Stores", format: fmtInt },
  { key: "needsReview", label: "Needs Review", format: fmtInt, highlight: true },
]

interface InvoiceSnapshotProps {
  summary: InvoiceKpis
  breakdown: InvoiceBreakdownData
}

export function InvoiceSnapshot({ breakdown }: InvoiceSnapshotProps) {
  const [viewBy, setViewBy] = useState<"store" | "vendor">("store")
  const [search, setSearch] = useState("")

  const displayedRows = viewBy === "store" ? breakdown.storeRows : breakdown.vendorRows
  const columns = viewBy === "store" ? STORE_COLUMNS : VENDOR_COLUMNS
  const totals = viewBy === "store" ? breakdown.storeTotals : breakdown.vendorTotals

  const filteredRows = search
    ? displayedRows.filter((r) =>
        (viewBy === "store"
          ? (r as InvoiceStoreRow).storeName
          : (r as InvoiceVendorRow).vendorName
        )
          .toLowerCase()
          .includes(search.toLowerCase())
      )
    : displayedRows

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-3 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">
              Invoice Spending
            </h3>
            <span className="text-[11px] text-muted-foreground">
              Last 30 days
            </span>
          </div>
          <ToggleGroup
            type="single"
            value={viewBy}
            onValueChange={(v) => {
              if (v) {
                setViewBy(v as "store" | "vendor")
                setSearch("")
              }
            }}
            variant="outline"
            className="h-7"
          >
            <ToggleGroupItem value="store" className="h-6 px-2 text-xs">
              Store
            </ToggleGroupItem>
            <ToggleGroupItem value="vendor" className="h-6 px-2 text-xs">
              Vendor
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder={
                viewBy === "store" ? "Search stores..." : "Search vendors..."
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-full sm:w-[180px] rounded-md border border-input bg-background pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <Link
            href="/dashboard/invoices"
            className="flex items-center gap-1 text-xs text-primary hover:underline whitespace-nowrap"
          >
            View All
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Table */}
      <div className="relative overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="sticky left-0 z-20 bg-muted/95 backdrop-blur-sm px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground min-w-[160px]">
                {viewBy === "store" ? "Store" : "Vendor"}
              </th>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap min-w-[100px]"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {filteredRows.map((row, idx) => {
              const isStore = viewBy === "store"
              const name = isStore
                ? (row as InvoiceStoreRow).storeName
                : (row as InvoiceVendorRow).vendorName
              const rowKey = isStore
                ? ((row as InvoiceStoreRow).storeId ?? "unassigned")
                : (row as InvoiceVendorRow).vendorName

              return (
                <tr
                  key={rowKey}
                  className={cn(
                    "group border-b border-border/40 transition-colors hover:bg-primary/[0.03]",
                    idx % 2 === 1 && "bg-muted/15"
                  )}
                >
                  <td className="sticky left-0 z-10 bg-card group-hover:bg-primary/[0.03] px-3 py-2 transition-colors">
                    <div className="flex items-center gap-1">
                      <span className="absolute left-0 top-0 h-full w-[3px] bg-transparent group-hover:bg-primary transition-colors" />
                      {isStore && (row as InvoiceStoreRow).storeId ? (
                        <Link
                          href={`/dashboard/invoices?storeId=${(row as InvoiceStoreRow).storeId}`}
                          className="font-medium text-foreground hover:text-primary hover:underline underline-offset-2 transition-colors"
                        >
                          {name}
                        </Link>
                      ) : (
                        <span
                          className={cn(
                            "font-medium text-foreground",
                            isStore &&
                              !(row as InvoiceStoreRow).storeId &&
                              "text-muted-foreground italic"
                          )}
                        >
                          {name}
                        </span>
                      )}
                    </div>
                  </td>
                  {columns.map((col) => {
                    const val = (row as unknown as Record<string, number>)[
                      col.key
                    ]
                    return (
                      <td key={col.key} className="px-3 py-2 text-right">
                        <span
                          className={cn(
                            "font-mono-numbers text-sm whitespace-nowrap",
                            col.highlight &&
                              val > 0 &&
                              "text-rose-600 dark:text-rose-400 font-medium"
                          )}
                        >
                          {col.format(val)}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            {filteredRows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  No {viewBy === "store" ? "stores" : "vendors"} match
                  &ldquo;{search}&rdquo;
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
              {columns.map((col) => {
                const val = (totals as Record<string, number>)[col.key]
                return (
                  <td key={col.key} className="px-3 py-2 text-right">
                    <span
                      className={cn(
                        "font-mono-numbers text-sm font-semibold whitespace-nowrap",
                        col.highlight &&
                          val > 0 &&
                          "text-rose-600 dark:text-rose-400"
                      )}
                    >
                      {col.format(val)}
                    </span>
                  </td>
                )
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Row count footer */}
      <div className="px-3 py-1.5 border-t border-border/50 bg-muted/20">
        <span className="text-[11px] text-muted-foreground">
          {filteredRows.length} of {displayedRows.length}{" "}
          {viewBy === "store" ? "store" : "vendor"}
          {displayedRows.length !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  )
}
