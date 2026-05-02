"use client"

import { useMemo } from "react"
import {
  MobileCatalogList,
  type MobileCatalogRow,
} from "@/components/mobile/mobile-catalog-list"

type Row = {
  id: string
  name: string
  category: string | null
  aliasCount: number
  recipeUnit: string | null
  costPerRecipeUnit: number | null
  trendPct: number | null
}

const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`

export function IngredientsSearch({ rows }: { rows: Row[] }) {
  const catalogRows = useMemo<MobileCatalogRow[]>(() => {
    return rows.map((row) => {
      const category = row.category ?? "uncategorized"
      const unit = row.recipeUnit ? `/ ${row.recipeUnit.toLowerCase()}` : ""
      const trend = row.trendPct != null ? ` · ${fmtPct(row.trendPct)}` : ""
      return {
        id: row.id,
        title: row.name,
        meta: `${category} · ${row.aliasCount} alias${row.aliasCount === 1 ? "" : "es"}`,
        value: row.costPerRecipeUnit != null ? fmtMoney(row.costPerRecipeUnit) : "—",
        subValue: `${unit}${trend}` || null,
        valueTone: row.costPerRecipeUnit == null ? "muted" : row.trendPct && row.trendPct > 0 ? "accent" : "default",
        searchText: `${row.name} ${category}`.toLowerCase(),
      }
    })
  }, [rows])

  return (
    <MobileCatalogList
      rows={catalogRows}
      placeholder="Search ingredients"
      ariaLabel="Search ingredients"
    />
  )
}
