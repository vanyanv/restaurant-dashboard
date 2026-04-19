"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowRight, FileText, Search } from "lucide-react"
import { formatCurrency } from "@/lib/format"
import { cn } from "@/lib/utils"
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

  const displayedRows =
    viewBy === "store" ? breakdown.storeRows : breakdown.vendorRows
  const columns = viewBy === "store" ? STORE_COLUMNS : VENDOR_COLUMNS
  const totals =
    viewBy === "store" ? breakdown.storeTotals : breakdown.vendorTotals

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

  const setView = (v: "store" | "vendor") => {
    setViewBy(v)
    setSearch("")
  }

  return (
    <div className="relative rounded-none border border-(--hairline) bg-[rgba(255,253,248,0.68)] shadow-none overflow-hidden">
      <span
        aria-hidden
        className="absolute left-0 top-0 h-px w-5 bg-(--accent) opacity-80"
      />

      {/* Header bar */}
      <div className="flex flex-col gap-3 border-b border-dotted border-(--hairline-bold) bg-transparent px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <FileText className="h-3 w-3 text-(--ink-faint)" />
            <span className="editorial-section-label">Invoices · 30 days</span>
          </div>
          <h3 className="font-display-tight text-[22px] leading-none text-(--ink)">
            Invoice Spending
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setView("store")}
              aria-pressed={viewBy === "store"}
              className={cn("toolbar-btn", viewBy === "store" && "active")}
            >
              Store
            </button>
            <button
              type="button"
              onClick={() => setView("vendor")}
              aria-pressed={viewBy === "vendor"}
              className={cn("toolbar-btn", viewBy === "vendor" && "active")}
            >
              Vendor
            </button>
          </div>
          <label className="search-shell !min-w-0 sm:!min-w-[200px]">
            <Search className="h-3.5 w-3.5 text-(--ink-faint)" />
            <input
              type="text"
              placeholder={
                viewBy === "store" ? "Search stores…" : "Search vendors…"
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <Link
            href="/dashboard/invoices"
            className="flex items-center gap-1 border-b border-(--ink) font-[family-name:var(--font-dm-sans)] text-[11px] uppercase tracking-[0.14em] text-(--ink) transition-colors hover:border-(--accent) hover:text-(--accent)"
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
            <tr className="border-b border-(--hairline-bold) bg-[rgba(0,0,0,0.02)]">
              <th className="sticky left-0 z-20 min-w-[160px] bg-[rgba(244,236,223,0.95)] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-(--ink-muted) backdrop-blur-sm">
                {viewBy === "store" ? "Store" : "Vendor"}
              </th>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="min-w-[100px] whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.16em] text-(--ink-muted)"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {filteredRows.map((row) => {
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
                  className="group border-b border-(--hairline) transition-colors hover:bg-[rgba(220,38,38,0.028)]"
                >
                  <td className="sticky left-0 z-10 bg-[rgba(255,253,248,0.98)] px-3 py-2 transition-colors group-hover:bg-[rgba(250,232,232,0.98)]">
                    <div className="relative flex items-center gap-1">
                      <span
                        aria-hidden
                        className="absolute -left-3 top-[10%] bottom-[10%] w-[3px] origin-center scale-y-0 bg-(--accent) transition-transform duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)] group-hover:scale-y-100"
                      />
                      {isStore && (row as InvoiceStoreRow).storeId ? (
                        <Link
                          href={`/dashboard/invoices?storeId=${(row as InvoiceStoreRow).storeId}`}
                          className="font-medium text-(--ink) underline-offset-2 transition-colors hover:text-(--accent) hover:underline"
                        >
                          {name}
                        </Link>
                      ) : (
                        <span
                          className={cn(
                            "font-medium text-(--ink)",
                            isStore &&
                              !(row as InvoiceStoreRow).storeId &&
                              "italic text-(--ink-muted)"
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
                            "text-sm tabular-nums whitespace-nowrap",
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
                  className="px-4 py-8 text-center text-sm text-(--ink-muted)"
                >
                  No {viewBy === "store" ? "stores" : "vendors"} match
                  &ldquo;{search}&rdquo;
                </td>
              </tr>
            )}
          </tbody>

          <tfoot>
            <tr className="border-t-2 border-(--hairline-bold) bg-[rgba(0,0,0,0.03)]">
              <td className="sticky left-0 z-10 bg-[rgba(244,236,223,0.95)] px-3 py-2 backdrop-blur-sm">
                <span className="font-[family-name:var(--font-dm-sans)] text-[10px] font-bold uppercase tracking-[0.22em] text-(--ink)">
                  Total
                </span>
              </td>
              {columns.map((col) => {
                const val = (totals as Record<string, number>)[col.key]
                return (
                  <td key={col.key} className="px-3 py-2 text-right">
                    <span
                      className={cn(
                        "text-sm tabular-nums font-semibold whitespace-nowrap",
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
      <div className="border-t border-(--hairline) bg-transparent px-4 py-2">
        <span className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
          {filteredRows.length} of {displayedRows.length}{" "}
          {viewBy === "store" ? "store" : "vendor"}
          {displayedRows.length !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  )
}
