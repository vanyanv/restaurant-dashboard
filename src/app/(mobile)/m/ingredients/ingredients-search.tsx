"use client"

import { useCallback, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  MobileCatalogList,
  type MobileCatalogRow,
} from "@/components/mobile/mobile-catalog-list"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

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

const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

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

export function IngredientsSearch({
  rows,
  canUploadPhotos,
}: {
  rows: Row[]
  canUploadPhotos: boolean
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId])

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
        leading: <Thumbnail row={row} />,
      }
    })
  }, [rows])

  return (
    <>
      <MobileCatalogList
        rows={catalogRows}
        placeholder="Search ingredients"
        ariaLabel="Search ingredients"
        onSelect={(id) => setSelectedId(id)}
      />
      <PhotoSheet
        ingredient={selected}
        canUpload={canUploadPhotos}
        onClose={() => setSelectedId(null)}
      />
    </>
  )
}

function PhotoSheet({
  ingredient,
  canUpload,
  onClose,
}: {
  ingredient: Row | null
  canUpload: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const onPickFile = useCallback(() => {
    setError(null)
    fileInputRef.current?.click()
  }, [])

  const onFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ""
      if (!file || !ingredient) return
      setError(null)
      try {
        const form = new FormData()
        form.append("photo", file)
        const res = await fetch(`/api/canonical-ingredients/${ingredient.id}/photo`, {
          method: "POST",
          body: form,
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          setError(body?.error ?? `Upload failed (${res.status})`)
          return
        }
        startTransition(() => router.refresh())
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed")
      }
    },
    [ingredient, router],
  )

  const onDelete = useCallback(async () => {
    if (!ingredient) return
    setError(null)
    try {
      const res = await fetch(`/api/canonical-ingredients/${ingredient.id}/photo`, {
        method: "DELETE",
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body?.error ?? `Delete failed (${res.status})`)
        return
      }
      startTransition(() => router.refresh())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed")
    }
  }, [ingredient, router])

  const open = ingredient !== null
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="m-ingredient-photo-sheet">
        <SheetHeader>
          <SheetTitle>{ingredient?.name ?? ""}</SheetTitle>
          <SheetDescription>
            {ingredient?.category ?? "uncategorized"}
            {ingredient?.recipeUnit ? ` · ${ingredient.recipeUnit}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="m-ingredient-photo-sheet__body">
          {ingredient && ingredient.hasPhoto ? (
            <img
              src={photoUrl(ingredient.id, ingredient.photoVersion)}
              alt={`Reference photo of ${ingredient.name}`}
              className="m-ingredient-photo-sheet__photo"
            />
          ) : (
            <div className="m-ingredient-photo-sheet__empty">No reference photo yet.</div>
          )}

          {canUpload ? (
            <div className="m-ingredient-photo-sheet__actions">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                onChange={onFileChange}
                hidden
              />
              <button
                type="button"
                onClick={onPickFile}
                disabled={pending}
                className="m-ingredient-photo-sheet__btn m-ingredient-photo-sheet__btn--primary"
              >
                {ingredient?.hasPhoto ? "Replace photo" : "Take / upload photo"}
              </button>
              {ingredient?.hasPhoto ? (
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={pending}
                  className="m-ingredient-photo-sheet__btn m-ingredient-photo-sheet__btn--ghost"
                >
                  Remove
                </button>
              ) : null}
              {error ? (
                <div className="m-ingredient-photo-sheet__error">{error}</div>
              ) : null}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
