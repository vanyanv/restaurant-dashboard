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
import { ArrowUpDown } from "lucide-react"
import { formatCurrency } from "@/lib/format"
import type { IngredientUsageRow } from "@/types/product-usage"

interface IngredientVarianceTableProps {
  data: IngredientUsageRow[]
  onRowClick?: (ingredientName: string) => void
}

const NUM_CLASS =
  "[font-variant-numeric:tabular-nums_lining-nums] [font-feature-settings:'tnum','lnum']"

function varianceColor(pct: number): string {
  const abs = Math.abs(pct)
  if (abs > 10) return "var(--accent)"
  if (abs > 5) return "var(--subtract)"
  return "var(--ink)"
}

function StatusStamp({ status }: { status: IngredientUsageRow["status"] }) {
  switch (status) {
    case "over_ordered":
      return <span className="inv-stamp" data-tone="alert">Over</span>
    case "under_ordered":
      return <span className="inv-stamp" data-tone="watch">Under</span>
    case "balanced":
      return <span className="inv-stamp" data-tone="info">Balanced</span>
    case "no_recipe":
      return <span className="inv-stamp" data-tone="muted">No recipe</span>
  }
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

export function IngredientVarianceTable({
  data,
  onRowClick,
}: IngredientVarianceTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "wasteEstimatedCost", desc: true },
  ])

  const columns = useMemo<ColumnDef<IngredientUsageRow>[]>(
    () => [
      {
        accessorKey: "canonicalName",
        header: ({ column }) => (
          <SortHeader
            label="Ingredient"
            isSorted={column.getIsSorted()}
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span className="text-[13px] font-medium" style={{ color: "var(--ink)" }}>
            {row.getValue("canonicalName")}
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
        cell: ({ row }) => {
          const cat = row.getValue("category") as string | null
          return cat ? (
            <span className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
              {cat}
            </span>
          ) : (
            <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>·</span>
          )
        },
      },
      {
        accessorKey: "purchasedQuantity",
        header: ({ column }) => (
          <SortHeader
            label="Purchased"
            isSorted={column.getIsSorted()}
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => {
          const orig = row.original
          return (
            <div>
              <span
                className={`text-[13px] ${NUM_CLASS}`}
                style={{ color: "var(--ink)" }}
              >
                {orig.purchasedQuantity.toFixed(1)} {orig.purchasedUnit}
              </span>
              <div
                className={`text-[11px] mt-0.5 ${NUM_CLASS}`}
                style={{ color: "var(--ink-muted)" }}
              >
                {formatCurrency(orig.purchasedCost)}
              </div>
            </div>
          )
        },
      },
      {
        accessorKey: "theoreticalUsage",
        header: ({ column }) => (
          <SortHeader
            label="Theoretical"
            isSorted={column.getIsSorted()}
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span className={`text-[13px] ${NUM_CLASS}`} style={{ color: "var(--ink-muted)" }}>
            {(row.getValue("theoreticalUsage") as number).toFixed(1)}
          </span>
        ),
      },
      {
        accessorKey: "variancePct",
        header: ({ column }) => (
          <SortHeader
            label="Variance %"
            isSorted={column.getIsSorted()}
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => {
          const pct = row.getValue("variancePct") as number
          return (
            <span
              className={`text-[13px] font-semibold ${NUM_CLASS}`}
              style={{ color: varianceColor(pct) }}
            >
              {pct > 0 ? "+" : ""}
              {pct.toFixed(1)}%
            </span>
          )
        },
      },
      {
        accessorKey: "wasteEstimatedCost",
        header: ({ column }) => (
          <SortHeader
            label="Waste cost"
            isSorted={column.getIsSorted()}
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span
            className={`editorial-tr__total text-[13px] font-semibold ${NUM_CLASS}`}
          >
            {formatCurrency(row.getValue("wasteEstimatedCost") as number)}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => (
          <SortHeader
            label="Status"
            isSorted={column.getIsSorted()}
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <StatusStamp status={row.getValue("status") as IngredientUsageRow["status"]} />
        ),
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
      <div className="px-5 pt-4 pb-3 flex items-baseline justify-between">
        <div>
          <span className="inv-panel__dept">§ Ingredients</span>
          <p
            className="font-display italic text-[18px] mt-0.5"
            style={{ color: "var(--ink)" }}
          >
            All ingredients{" "}
            <span style={{ color: "var(--ink-faint)" }}>· {data.length}</span>
          </p>
        </div>
      </div>
      {/* Mobile: card stack — preserves the table's sort. The whole card
          opens the same drilldown as desktop's row click, so the dense
          numeric grid below is informational, not interactive. */}
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
            value={sorting[0]?.id ?? "wasteEstimatedCost"}
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
            <option value="wasteEstimatedCost">Waste cost</option>
            <option value="variancePct">Variance %</option>
            <option value="purchasedQuantity">Purchased</option>
            <option value="theoreticalUsage">Theoretical</option>
            <option value="canonicalName">Ingredient</option>
            <option value="category">Category</option>
            <option value="status">Status</option>
          </select>
        </div>
        <ul>
          {table.getRowModel().rows.length === 0 ? (
            <li
              className="px-4 py-12 text-center text-[13px]"
              style={{ color: "var(--ink-muted)" }}
            >
              No ingredient data available.
            </li>
          ) : (
            table.getRowModel().rows.map((row) => {
              const r = row.original
              const interactive = !!onRowClick
              return (
                <li
                  key={row.id}
                  style={{ borderTop: "1px solid var(--hairline)" }}
                >
                  <button
                    type="button"
                    onClick={() => onRowClick?.(r.canonicalName)}
                    disabled={!interactive}
                    className="w-full text-left px-4 py-3 disabled:cursor-default"
                    style={{
                      cursor: interactive ? "pointer" : "default",
                      background: "transparent",
                      transition: "background 160ms ease",
                    }}
                    onMouseEnter={(e) => {
                      if (interactive)
                        e.currentTarget.style.background =
                          "rgba(220, 38, 38, 0.045)"
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent"
                    }}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span
                        className="font-display italic text-[16px] leading-tight"
                        style={{
                          color: "var(--ink)",
                          flex: 1,
                          minWidth: 0,
                        }}
                      >
                        {r.canonicalName}
                      </span>
                      <StatusStamp status={r.status} />
                    </div>
                    {r.category && (
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
                      </div>
                    )}
                    <div
                      className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5"
                      style={{
                        fontFamily: "var(--font-dm-sans), sans-serif",
                        fontSize: 13,
                        fontVariantNumeric: "tabular-nums lining-nums",
                      }}
                    >
                      <CardStat
                        label="Variance"
                        value={`${r.variancePct > 0 ? "+" : ""}${r.variancePct.toFixed(1)}%`}
                        color={varianceColor(r.variancePct)}
                        bold
                      />
                      <CardStat
                        label="Waste cost"
                        value={formatCurrency(r.wasteEstimatedCost)}
                        bold
                      />
                      <CardStat
                        label={`Purchased${r.purchasedUnit ? ` (${r.purchasedUnit})` : ""}`}
                        value={r.purchasedQuantity.toFixed(1)}
                      />
                      <CardStat
                        label="Theoretical"
                        value={r.theoreticalUsage.toFixed(1)}
                        muted
                      />
                    </div>
                  </button>
                </li>
              )
            })
          )}
        </ul>
      </div>

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
                  style={{
                    borderBottom: "1px solid var(--hairline)",
                    cursor: onRowClick ? "pointer" : undefined,
                  }}
                  onClick={() => onRowClick?.(row.original.canonicalName)}
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
                  No ingredient data available.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
