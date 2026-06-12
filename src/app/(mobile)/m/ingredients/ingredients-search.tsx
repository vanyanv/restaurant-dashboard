"use client"

import { formatCurrency as fmtMoney } from "@/lib/format"
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
  hasPhoto: boolean
  photoVersion: string | null
}

const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`

function photoUrl(id: string, version: string | null): string {
  const base = `/api/canonical-ingredients/${id}/photo`
  return version ? `${base}?v=${encodeURIComponent(version)}` : base
}

function Thumbnail({ row }: { row: Row }) {
  if (!row.hasPhoto) {
    return (
      <span aria-hidden className="m-ingredient-thumb m-ingredient-thumb--empty">
        ·
      </span>
    )
  }
  return (
    <img
      src={photoUrl(row.id, row.photoVersion)}
      alt=""
      loading="lazy"
      decoding="async"
      className="m-ingredient-thumb"
    />
  )
}

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
        valueTone:
          row.costPerRecipeUnit == null
            ? "muted"
            : row.trendPct && row.trendPct > 0
              ? "accent"
              : "default",
        searchText: `${row.name} ${category}`.toLowerCase(),
        leading: <Thumbnail row={row} />,
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
