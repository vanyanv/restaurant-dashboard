"use client"

import { useMemo, useState } from "react"
import {
  MobileCatalogList,
  type MobileCatalogRow,
} from "@/components/mobile/mobile-catalog-list"

type Row = {
  name: string
  category: string
  totalQty: number
  mappedRecipeName: string | null
  storeCount: number
}

export function MenuSearch({ rows }: { rows: Row[] }) {
  const [unmappedOnly, setUnmappedOnly] = useState(false)

  const catalogRows = useMemo<MobileCatalogRow[]>(() => {
    return rows
      .filter((row) => !unmappedOnly || !row.mappedRecipeName)
      .map((row) => ({
        id: `${row.name}::${row.category}`,
        title: row.name,
        meta: `${row.category} · ${row.storeCount} store${row.storeCount === 1 ? "" : "s"} · ${
          row.mappedRecipeName ?? "UNMAPPED"
        }`,
        value: row.totalQty.toLocaleString(),
        searchText: `${row.name} ${row.category}`.toLowerCase(),
      }))
  }, [rows, unmappedOnly])

  return (
    <MobileCatalogList
      rows={catalogRows}
      placeholder="Search menu items"
      ariaLabel="Search menu items"
      actions={
        <button
          type="button"
          onClick={() => setUnmappedOnly((value) => !value)}
          className={`toolbar-btn${unmappedOnly ? " active" : ""}`}
          style={{ fontSize: 11 }}
        >
          Unmapped
        </button>
      }
    />
  )
}
