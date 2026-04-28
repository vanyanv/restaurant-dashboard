"use client"

import { useState, useMemo } from "react"
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type SortingState,
  type ColumnDef,
} from "@tanstack/react-table"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ArrowUpDown, TriangleAlert } from "lucide-react"
import Link from "next/link"
import { formatCurrency, formatNumber } from "@/lib/format"
import type { MenuItemCostRow } from "@/types/product-usage"

interface MenuItemCostTableProps {
  data: MenuItemCostRow[]
}

const NUM_CLASS =
  "[font-variant-numeric:tabular-nums_lining-nums] [font-feature-settings:'tnum','lnum']"

function marginToneColor(pct: number | null): string {
  if (pct === null) return "var(--ink-faint)"
  if (pct > 60) return "var(--ink)"
  if (pct >= 40) return "var(--ink-muted)"
  return "var(--accent)"
}

function profitColor(value: number): string {
  return value >= 0 ? "var(--ink)" : "var(--subtract)"
}

function CardStat({
  label,
  value,
  color,
  muted,
  bold,
}: {
  label: string
  value: string
  color?: string
  muted?: boolean
  bold?: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        style={{
          fontFamily: "var(--font-jetbrains-mono), monospace",
          fontSize: 9.5,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: color ?? (muted ? "var(--ink-muted)" : "var(--ink)"),
          fontWeight: bold ? 600 : 500,
        }}
      >
        {value}
      </span>
    </div>
  )
}

function SortHeader({
  label,
  isSorted,
  onClick,
}: {
  label: string
  isSorted: false | "asc" | "desc"
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 -ml-1"
      style={{
        color: isSorted ? "var(--ink)" : "var(--ink-faint)",
        fontFamily: "var(--font-jetbrains-mono), monospace",
        fontSize: 10,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        fontWeight: 600,
      }}
    >
      {label}
      <ArrowUpDown className="ml-0.5 h-3 w-3" />
    </button>
  )
}

export function MenuItemCostTable({ data }: MenuItemCostTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "totalSalesRevenue", desc: true },
  ])

  const withRecipe = data.filter((d) => d.hasRecipe).length
  const coveragePct = data.length > 0 ? Math.round((withRecipe / data.length) * 100) : 100

  const columns = useMemo<ColumnDef<MenuItemCostRow>[]>(
    () => [
      {
        accessorKey: "itemName",
        header: ({ column }) => (
          <SortHeader
            label="Item name"
            isSorted={column.getIsSorted()}
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span className="text-[13px] font-medium" style={{ color: "var(--ink)" }}>
            {row.getValue("itemName")}
          </span>
        ),
      },
      {
        accessorKey: "category",
        header: ({ column }) => (
          <SortHeader
            label="Category"
            isSorted={column.getIsSorted()}
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
            {row.getValue("category") as string}
          </span>
        ),
      },
      {
        accessorKey: "totalQuantitySold",
        header: ({ column }) => (
          <SortHeader
            label="Units sold"
            isSorted={column.getIsSorted()}
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span className={`text-[13px] ${NUM_CLASS}`} style={{ color: "var(--ink)" }}>
            {formatNumber(row.getValue("totalQuantitySold") as number)}
          </span>
        ),
      },
      {
        accessorKey: "totalSalesRevenue",
        header: ({ column }) => (
          <SortHeader
            label="Revenue"
            isSorted={column.getIsSorted()}
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span className={`text-[13px] ${NUM_CLASS}`} style={{ color: "var(--ink)" }}>
            {formatCurrency(row.getValue("totalSalesRevenue") as number)}
          </span>
        ),
      },
      {
        accessorKey: "theoreticalCOGS",
        header: ({ column }) => (
          <SortHeader
            label="COGS"
            isSorted={column.getIsSorted()}
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span className={`text-[13px] ${NUM_CLASS}`} style={{ color: "var(--ink-muted)" }}>
            {formatCurrency(row.getValue("theoreticalCOGS") as number)}
          </span>
        ),
      },
      {
        accessorKey: "grossProfitEstimate",
        header: ({ column }) => (
          <SortHeader
            label="Gross profit"
            isSorted={column.getIsSorted()}
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => {
          const value = row.getValue("grossProfitEstimate") as number
          return (
            <span
              className={`text-[13px] font-semibold ${NUM_CLASS}`}
              style={{ color: profitColor(value) }}
            >
              {formatCurrency(value)}
            </span>
          )
        },
      },
      {
        accessorKey: "grossMarginPct",
        header: ({ column }) => (
          <SortHeader
            label="Margin %"
            isSorted={column.getIsSorted()}
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => {
          const pct = row.getValue("grossMarginPct") as number | null
          if (pct === null) {
            return (
              <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
                ··
              </span>
            )
          }
          return (
            <span
              className={`text-[13px] font-semibold ${NUM_CLASS}`}
              style={{ color: marginToneColor(pct) }}
            >
              {pct.toFixed(1)}%
            </span>
          )
        },
        sortingFn: (rowA, rowB) => {
          const a = rowA.getValue("grossMarginPct") as number | null
          const b = rowB.getValue("grossMarginPct") as number | null
          if (a === null && b === null) return 0
          if (a === null) return -1
          if (b === null) return 1
          return a - b
        },
      },
      {
        accessorKey: "hasRecipe",
        header: ({ column }) => (
          <SortHeader
            label="Recipe"
            isSorted={column.getIsSorted()}
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => {
          const hasRecipe = row.getValue("hasRecipe") as boolean
          return (
            <span className="inv-stamp" data-tone={hasRecipe ? "info" : "muted"}>
              {hasRecipe ? "Configured" : "No recipe"}
            </span>
          )
        },
      },
    ],
    []
  )

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <section className="inv-panel inv-panel--flush">
      <div className="px-5 pt-4 pb-3 flex items-baseline justify-between gap-4">
        <div>
          <span className="inv-panel__dept">All menu items</span>
          <p
            className="font-display italic text-[18px] mt-0.5"
            style={{ color: "var(--ink)" }}
          >
            {data.length} items <span style={{ color: "var(--ink-faint)" }}>· cost & margin per item</span>
          </p>
        </div>
        <span className="inv-stamp" data-tone={coveragePct === 100 ? "info" : "watch"}>
          {coveragePct}% recipe coverage
        </span>
      </div>

      {coveragePct < 100 && (
        <div className="px-5 pb-3">
          <aside
            role="note"
            className="flex items-start gap-3 px-4 py-3"
            style={{
              border: "1px solid var(--hairline-bold)",
              background: "var(--accent-bg)",
            }}
          >
            <TriangleAlert
              className="h-4 w-4 shrink-0"
              style={{ color: "var(--accent-dark)" }}
              aria-hidden
            />
            <p className="text-[13px] leading-snug" style={{ color: "var(--ink)" }}>
              <span
                className="text-[10px] uppercase tracking-[0.2em] mr-2"
                style={{
                  color: "var(--ink-muted)",
                  fontFamily: "var(--font-jetbrains-mono), monospace",
                }}
              >
                Notice
              </span>
              {withRecipe} of {data.length} items have recipes configured ({coveragePct}% coverage). Items without recipes show $0 COGS and 100% margin.{" "}
              <Link
                href="/dashboard/operations/recipes"
                className="font-medium underline underline-offset-2"
                style={{ color: "var(--accent)" }}
              >
                Configure recipes
              </Link>
            </p>
          </aside>
        </div>
      )}

      {/* Mobile: card stack — preserves the table's sort (rows come from
          getRowModel) so user-applied desktop sort persists if they rotate
          the device. Sort selector sits at the top so phone-only users can
          still re-order. */}
      <div className="sm:hidden">
        <div
          className="flex items-center justify-between gap-3 px-4 py-3"
          style={{
            borderTop: "1px solid var(--hairline-bold)",
            borderBottom: "1px solid var(--hairline)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-jetbrains-mono), monospace",
              fontSize: 9.5,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--ink-faint)",
            }}
          >
            Sort by
          </span>
          <select
            value={sorting[0]?.id ?? "totalSalesRevenue"}
            onChange={(e) =>
              setSorting([{ id: e.target.value, desc: true }])
            }
            className="border bg-transparent px-2 py-1 text-[12px]"
            style={{
              borderColor: "var(--hairline-bold)",
              color: "var(--ink)",
              fontFamily: "var(--font-dm-sans), sans-serif",
              borderRadius: 0,
            }}
          >
            <option value="totalSalesRevenue">Revenue</option>
            <option value="totalQuantitySold">Units sold</option>
            <option value="grossProfitEstimate">Gross profit</option>
            <option value="grossMarginPct">Margin %</option>
            <option value="theoreticalCOGS">COGS</option>
            <option value="itemName">Item name</option>
            <option value="category">Category</option>
          </select>
        </div>
        <ul>
          {table.getRowModel().rows.length === 0 ? (
            <li
              className="px-4 py-12 text-center text-[13px]"
              style={{ color: "var(--ink-muted)" }}
            >
              No menu item cost data available.
            </li>
          ) : (
            table.getRowModel().rows.map((row) => {
              const r = row.original
              const margin = r.grossMarginPct
              return (
                <li
                  key={row.id}
                  className="px-4 py-3"
                  style={{ borderTop: "1px solid var(--hairline)" }}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span
                      className="font-display italic text-[16px] leading-tight"
                      style={{ color: "var(--ink)", flex: 1, minWidth: 0 }}
                    >
                      {r.itemName}
                    </span>
                    <span
                      className="inv-stamp"
                      data-tone={r.hasRecipe ? "info" : "muted"}
                    >
                      {r.hasRecipe ? "Configured" : "No recipe"}
                    </span>
                  </div>
                  <div
                    className="mt-1"
                    style={{
                      fontFamily: "var(--font-jetbrains-mono), monospace",
                      fontSize: 10,
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      color: "var(--ink-muted)",
                    }}
                  >
                    {r.category}
                    <span aria-hidden> · </span>
                    {formatNumber(r.totalQuantitySold)} sold
                  </div>
                  <div
                    className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5"
                    style={{
                      fontFamily: "var(--font-dm-sans), sans-serif",
                      fontSize: 13,
                      fontVariantNumeric: "tabular-nums lining-nums",
                    }}
                  >
                    <CardStat
                      label="Revenue"
                      value={formatCurrency(r.totalSalesRevenue)}
                    />
                    <CardStat
                      label="COGS"
                      value={formatCurrency(r.theoreticalCOGS)}
                      muted
                    />
                    <CardStat
                      label="Gross profit"
                      value={formatCurrency(r.grossProfitEstimate)}
                      color={profitColor(r.grossProfitEstimate)}
                      bold
                    />
                    <CardStat
                      label="Margin %"
                      value={
                        margin === null ? "··" : `${margin.toFixed(1)}%`
                      }
                      color={margin === null ? undefined : marginToneColor(margin)}
                      bold
                    />
                  </div>
                </li>
              )
            })
          )}
        </ul>
      </div>

      {/* Desktop: dense reconciliation table */}
      <div
        className="hidden sm:block max-h-125 overflow-auto"
        style={{ borderTop: "1px solid var(--hairline-bold)" }}
      >
        <Table>
          <TableHeader
            className="sticky top-0 z-10"
            style={{ background: "var(--paper)" }}
          >
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow
                key={headerGroup.id}
                style={{ borderBottom: "1px solid var(--hairline)" }}
              >
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="pl-4">
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="editorial-tr"
                  style={{ borderBottom: "1px solid var(--hairline)" }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="pl-4">
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-[13px]"
                  style={{ color: "var(--ink-muted)" }}
                >
                  No menu item cost data available.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
