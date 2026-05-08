"use client"

import { useMemo, useState, useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { EditorialTopbar } from "../../../../../components/editorial-topbar"
import {
  saveStockCountLine,
  completeStockCount,
} from "@/app/actions/inventory/stock-count-actions"
import type { CountEntryHeader, CountEntryIngredient } from "@/app/actions/inventory/count-entry-actions"

type RowState = {
  nativeQty: string
  nativeUnit: string
  saving: boolean
  saved: boolean
  error: string | null
  qtyInRecipeUnit: number | null
}

interface Props {
  count: CountEntryHeader
  ingredients: CountEntryIngredient[]
  resumed: boolean
  storePicker: ReactNode
}

export function CountEntryForm({ count, ingredients, resumed, storePicker }: Props) {
  const router = useRouter()
  const [isCompleting, startCompleting] = useTransition()

  const initialRows = useMemo(() => {
    const map: Record<string, RowState> = {}
    for (const i of ingredients) {
      map[i.id] = {
        nativeQty: i.existingLine ? String(i.existingLine.nativeQty) : "",
        nativeUnit: i.existingLine?.nativeUnit ?? i.recipeUnit ?? "",
        saving: false,
        saved: !!i.existingLine,
        error: null,
        qtyInRecipeUnit: i.existingLine?.qtyInRecipeUnit ?? null,
      }
    }
    return map
  }, [ingredients])
  const [rows, setRows] = useState<Record<string, RowState>>(initialRows)

  const grouped = useMemo(() => {
    const buckets = new Map<string, CountEntryIngredient[]>()
    for (const i of ingredients) {
      const key = i.category
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key)!.push(i)
    }
    return Array.from(buckets.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [ingredients])

  const updateRow = (id: string, patch: Partial<RowState>) => {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  const saveRow = async (ingredient: CountEntryIngredient) => {
    const row = rows[ingredient.id]
    if (!row) return
    const qty = Number(row.nativeQty)
    if (row.nativeQty === "" || !Number.isFinite(qty) || qty < 0) {
      updateRow(ingredient.id, { error: "Enter a non-negative number", saved: false })
      return
    }
    if (!row.nativeUnit.trim()) {
      updateRow(ingredient.id, { error: "Pick a unit", saved: false })
      return
    }
    updateRow(ingredient.id, { saving: true, error: null })
    const result = await saveStockCountLine({
      stockCountId: count.id,
      canonicalIngredientId: ingredient.id,
      nativeQty: qty,
      nativeUnit: row.nativeUnit,
    })
    if (!result) {
      updateRow(ingredient.id, { saving: false, error: "Not authenticated" })
      return
    }
    if (!result.ok) {
      const msg =
        result.error === "missing_conversion"
          ? `No conversion ${result.fromUnit} → ${result.toUnit}`
          : result.error.replace(/_/g, " ")
      updateRow(ingredient.id, { saving: false, error: msg, saved: false })
      return
    }
    updateRow(ingredient.id, {
      saving: false,
      saved: true,
      error: null,
      qtyInRecipeUnit: result.qtyInRecipeUnit,
    })
  }

  const handleComplete = () => {
    startCompleting(async () => {
      const result = await completeStockCount({ stockCountId: count.id })
      if (result?.ok) router.push("/dashboard/operations/inventory")
    })
  }

  const completedCount = Object.values(rows).filter((r) => r.saved).length

  return (
    <div className="flex flex-col h-full">
      <EditorialTopbar
        section="§ 06"
        title={`Count · ${count.storeName}`}
        stamps={
          <span>
            {completedCount}/{ingredients.length} entered
            {resumed ? " · resumed" : ""}
          </span>
        }
      >
        {storePicker}
        <button
          type="button"
          onClick={handleComplete}
          disabled={isCompleting || completedCount === 0}
          className="font-mono text-[10px] uppercase tracking-[0.18em] border border-[var(--hairline-bold)] px-3 py-1.5 rounded-[2px] hover:bg-[rgba(220,38,38,0.045)] hover:text-[var(--accent)] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--ink)]"
        >
          {isCompleting ? "Closing…" : "Complete count"}
        </button>
      </EditorialTopbar>

      <div className="px-6 py-6 space-y-6">
        {grouped.map(([category, items]) => (
          <section key={category} className="inv-panel inv-panel--flush">
            <header className="inv-panel__head px-5 pt-4">
              <span className="inv-panel__dept">{category}</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                {items.filter((i) => rows[i.id]?.saved).length}/{items.length}
              </span>
            </header>
            <div>
              {items.map((i) => (
                <CountRow
                  key={i.id}
                  ingredient={i}
                  row={rows[i.id]}
                  onChange={(patch) => updateRow(i.id, patch)}
                  onCommit={() => saveRow(i)}
                />
              ))}
            </div>
          </section>
        ))}
        {grouped.length === 0 && (
          <div className="inv-panel">
            <p className="text-[var(--ink-muted)]">
              No canonical ingredients yet. Map some invoice line items first.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

interface CountRowProps {
  ingredient: CountEntryIngredient
  row: RowState
  onChange: (patch: Partial<RowState>) => void
  onCommit: () => void
}

function CountRow({ ingredient, row, onChange, onCommit }: CountRowProps) {
  const recipeUnit = ingredient.recipeUnit ?? "—"
  return (
    <div className="grid grid-cols-[1fr_120px_100px_120px_120px] gap-4 items-center px-5 py-3 border-t border-[var(--hairline)] hover:bg-[rgba(220,38,38,0.045)] transition-colors">
      <div>
        <div className="text-[14px] text-[var(--ink)]">{ingredient.name}</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          recipe unit · {recipeUnit}
        </div>
      </div>
      <input
        type="number"
        inputMode="decimal"
        step="any"
        min="0"
        value={row?.nativeQty ?? ""}
        onChange={(e) => onChange({ nativeQty: e.target.value, saved: false })}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            ;(e.currentTarget as HTMLInputElement).blur()
          }
        }}
        placeholder="0"
        className="h-9 px-3 text-right border border-[var(--hairline-bold)] rounded-[2px] bg-[rgba(255,253,247,0.72)] focus:outline-none focus:border-[var(--accent)] font-medium tabular-nums"
        style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
      />
      <input
        type="text"
        value={row?.nativeUnit ?? ""}
        onChange={(e) => onChange({ nativeUnit: e.target.value, saved: false })}
        onBlur={onCommit}
        placeholder={recipeUnit}
        className="h-9 px-3 text-center border border-[var(--hairline-bold)] rounded-[2px] bg-[rgba(255,253,247,0.72)] focus:outline-none focus:border-[var(--accent)] font-mono text-[12px] uppercase"
      />
      <div
        className="text-right text-[13px] tabular-nums text-[var(--ink-muted)]"
        style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
      >
        {row?.qtyInRecipeUnit != null
          ? `${row.qtyInRecipeUnit.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${recipeUnit}`
          : "—"}
      </div>
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-right">
        {row?.saving ? (
          <span className="text-[var(--ink-faint)]">saving…</span>
        ) : row?.error ? (
          <span className="text-[var(--accent)]">{row.error}</span>
        ) : row?.saved ? (
          <span className="text-[var(--ink-faint)]">saved</span>
        ) : (
          <span className="text-[var(--ink-faint)]">—</span>
        )}
      </div>
    </div>
  )
}
