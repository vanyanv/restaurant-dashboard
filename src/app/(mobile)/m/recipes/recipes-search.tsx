"use client"

import { useMemo } from "react"
import {
  MobileCatalogList,
  type MobileCatalogRow,
} from "@/components/mobile/mobile-catalog-list"

type Row = {
  id: string
  itemName: string
  category: string
  isSellable: boolean
  isConfirmed: boolean
  ingredientCount: number
  computedCost: number | null
  partialCost: boolean
}

const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

export function RecipesSearch({ rows }: { rows: Row[] }) {
  const catalogRows = useMemo<MobileCatalogRow[]>(() => {
    return rows.map((row) => ({
      id: row.id,
      title: row.itemName,
      meta: `${row.category} · ${row.ingredientCount} ingr · ${
        row.isConfirmed ? "CONFIRMED" : "DRAFT"
      }${row.isSellable ? " · SELLABLE" : ""}`,
      value: row.computedCost != null ? fmtMoney(row.computedCost) : "—",
      subValue: row.partialCost ? "PARTIAL" : null,
      valueTone: row.computedCost == null ? "muted" : row.partialCost ? "accent" : "default",
      searchText: `${row.itemName} ${row.category}`.toLowerCase(),
    }))
  }, [rows])

  return (
    <MobileCatalogList
      rows={catalogRows}
      placeholder="Search recipes"
      ariaLabel="Search recipes"
    />
  )
}
