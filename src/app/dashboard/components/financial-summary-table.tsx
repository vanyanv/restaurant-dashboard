"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronRight, Search, TableProperties } from "lucide-react"
import { formatCurrency } from "@/lib/format"
import type { StoreSummaryRow } from "@/types/analytics"
import { cn } from "@/lib/utils"

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
        "text-sm tabular-nums whitespace-nowrap",
        bold && "font-semibold",
        isNeg && "text-rose-600 dark:text-rose-400",
        negative && num !== 0 && !isNeg && "text-rose-600 dark:text-rose-400",
        !isNeg && !negative && "text-(--ink)"
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

  const setView = (v: "location" | "channel") => {
    setViewBy(v)
    setSearch("")
  }

  return (
    <div className="relative rounded-none border border-[color:var(--hairline)] bg-[rgba(255,253,248,0.68)] shadow-none overflow-hidden">
      <span
        aria-hidden
        className="absolute left-0 top-0 h-px w-5 bg-[color:var(--accent)] opacity-80"
      />

      {/* Header bar */}
      <div className="flex flex-col gap-3 border-b border-dotted border-[color:var(--hairline-bold)] bg-transparent px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <TableProperties className="h-3 w-3 text-[color:var(--ink-faint)]" />
            <span className="editorial-section-label">Sales · Ledger</span>
          </div>
          <h3 className="font-display-tight text-[22px] leading-none text-[color:var(--ink)]">
            Sales Breakdown
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setView("location")}
              aria-pressed={viewBy === "location"}
              className={cn("toolbar-btn", viewBy === "location" && "active")}
            >
              Location
            </button>
            <button
              type="button"
              onClick={() => setView("channel")}
              aria-pressed={viewBy === "channel"}
              className={cn("toolbar-btn", viewBy === "channel" && "active")}
            >
              Channel
            </button>
          </div>
          <label className="search-shell !min-w-0 sm:!min-w-[220px]">
            <Search className="h-3.5 w-3.5 text-[color:var(--ink-faint)]" />
            <input
              type="text"
              placeholder={
                viewBy === "location"
                  ? "Search locations…"
                  : "Search channels…"
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
      </div>

      {/* Table */}
      <div className="relative overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[color:var(--hairline-bold)] bg-[rgba(0,0,0,0.02)]">
              <th className="sticky left-0 z-20 min-w-[160px] bg-[rgba(244,236,223,0.95)] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)] backdrop-blur-sm">
                {viewBy === "location" ? "Location" : "Channel"}
              </th>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className="min-w-[100px] whitespace-nowrap px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-muted)]"
                >
                  {col.shortLabel ?? col.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {filteredRows.map((row) => (
              <tr
                key={row.storeId}
                className="group border-b border-[color:var(--hairline)] transition-colors hover:bg-[rgba(220,38,38,0.028)]"
              >
                <td className="sticky left-0 z-10 bg-[rgba(255,253,248,0.98)] px-3 py-2 transition-colors group-hover:bg-[rgba(250,232,232,0.98)]">
                  <div className="relative flex items-center gap-1">
                    <span
                      aria-hidden
                      className="absolute -left-3 top-[10%] bottom-[10%] w-[3px] origin-center scale-y-0 bg-[color:var(--accent)] transition-transform duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)] group-hover:scale-y-100"
                    />
                    {viewBy === "location" ? (
                      <>
                        <Link
                          href={`/dashboard/analytics/${row.storeId}`}
                          className="font-medium text-[color:var(--ink)] underline-offset-2 transition-colors hover:text-[color:var(--accent)] hover:underline"
                        >
                          {row.storeName}
                        </Link>
                        <ChevronRight className="h-3.5 w-3.5 text-[color:var(--ink-faint)] opacity-0 transition-opacity group-hover:opacity-100" />
                      </>
                    ) : (
                      <span className="font-medium text-[color:var(--ink)]">
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
                  className="px-4 py-8 text-center text-sm text-[color:var(--ink-muted)]"
                >
                  No {viewBy === "location" ? "locations" : "channels"} match
                  &ldquo;{search}&rdquo;
                </td>
              </tr>
            )}
          </tbody>

          <tfoot>
            <tr className="border-t-2 border-[color:var(--hairline-bold)] bg-[rgba(0,0,0,0.03)]">
              <td className="sticky left-0 z-10 bg-[rgba(244,236,223,0.95)] px-3 py-2 backdrop-blur-sm">
                <span className="font-[family-name:var(--font-dm-sans)] text-[10px] font-bold uppercase tracking-[0.22em] text-[color:var(--ink)]">
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
      <div className="border-t border-[color:var(--hairline)] bg-transparent px-4 py-2">
        <span className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]">
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
    <div className="relative rounded-none border border-[color:var(--hairline)] bg-[rgba(255,253,248,0.68)] shadow-none overflow-hidden">
      <span
        aria-hidden
        className="absolute left-0 top-0 h-px w-5 bg-[color:var(--accent)] opacity-80"
      />

      {/* Header skeleton */}
      <div className="flex items-center justify-between border-b border-dotted border-[color:var(--hairline-bold)] bg-transparent px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded bg-[color:var(--hairline)] animate-pulse" />
          <div className="space-y-1.5">
            <div className="h-2.5 w-20 rounded bg-[color:var(--hairline)] animate-pulse" />
            <div className="h-4 w-40 rounded bg-[color:var(--hairline)] animate-pulse" />
          </div>
        </div>
        <div className="h-8 w-[200px] rounded-none bg-[color:var(--hairline)] animate-pulse" />
      </div>

      {/* Table skeleton */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[color:var(--hairline-bold)] bg-[rgba(0,0,0,0.02)]">
              <th className="px-3 py-2 text-left">
                <div className="h-3 w-16 rounded bg-[color:var(--hairline)] animate-pulse" />
              </th>
              {Array.from({ length: 8 }).map((_, i) => (
                <th key={i} className="px-3 py-2 text-right">
                  <div className="ml-auto h-3 w-16 rounded bg-[color:var(--hairline)] animate-pulse" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 3 }).map((_, rowIdx) => (
              <tr
                key={rowIdx}
                className="border-b border-[color:var(--hairline)]"
              >
                <td className="px-3 py-2">
                  <div className="h-4 w-28 rounded bg-[color:var(--hairline)] animate-pulse" />
                </td>
                {Array.from({ length: 8 }).map((_, cellIdx) => (
                  <td key={cellIdx} className="px-3 py-2 text-right">
                    <div className="ml-auto h-4 w-16 rounded bg-[color:var(--hairline)] animate-pulse" />
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
