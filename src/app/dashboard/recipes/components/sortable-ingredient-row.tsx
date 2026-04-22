"use client"

import { useEffect, useRef, useState } from "react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  GripVertical,
  Trash2,
  BookOpen,
  Plus,
  Minus,
  ChevronDown,
  Pencil,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ProvenanceChip } from "@/components/recipe/provenance-chip"
import type { CanonicalIngredientSummary, RecipeSummary } from "@/types/recipe"
import type { RecipeCostLine } from "@/lib/recipe-cost"
import { IngredientPickerSheet } from "./ingredient-picker-sheet"
import {
  categorySwatch,
  COMMON_UNITS,
  prettifyIngredientName,
  type IngredientPickerValue,
} from "./ingredient-picker-utils"

export type IngredientRowData = {
  id: string
  picker: IngredientPickerValue
  quantity: string
  unit: string
  notes: string
}

type Props = {
  row: IngredientRowData
  canonicalIngredients: CanonicalIngredientSummary[]
  recipes: RecipeSummary[]
  excludeRecipeIds: string[]
  costLine?: RecipeCostLine
  onChange: (patch: Partial<IngredientRowData>) => void
  onRemove: () => void
  removable: boolean
  onCanonicalCreated?: () => void
  onOpenCreateDialog?: () => void
  /** Optional row index for the marginalia tick numbers. */
  index?: number
}

export function SortableIngredientRow({
  row,
  canonicalIngredients,
  recipes,
  excludeRecipeIds,
  costLine,
  onChange,
  onRemove,
  removable,
  onCanonicalCreated,
  onOpenCreateDialog,
  index,
}: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const [pickerOpen, setPickerOpen] = useState(false)
  const [unitOpen, setUnitOpen] = useState(false)
  const unitRef = useRef<HTMLDivElement | null>(null)

  // Click-outside for the unit popover.
  useEffect(() => {
    if (!unitOpen) return
    function onDoc(e: MouseEvent) {
      if (!unitRef.current?.contains(e.target as Node)) setUnitOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [unitOpen])

  const hasPick = row.picker !== null
  const isSubRecipe = row.picker?.kind === "recipe"
  // Sub-recipes keep their original (user-authored) name; canonical
  // ingredients get prettified (Title Case, pack-size noise stripped).
  const rawLabel =
    row.picker?.kind === "ingredient" || row.picker?.kind === "recipe"
      ? row.picker.label
      : null
  const label =
    row.picker?.kind === "ingredient" && rawLabel
      ? prettifyIngredientName(rawLabel)
      : rawLabel

  // Resolve a category swatch — sub-recipes get the dedicated red, ingredients
  // pull from their canonical category.
  const swatch = (() => {
    if (isSubRecipe) return categorySwatch("sub-recipe")
    if (row.picker?.kind === "ingredient") {
      const id = row.picker.canonicalIngredientId
      const ing = canonicalIngredients.find((c) => c.id === id)
      return categorySwatch(ing?.category)
    }
    return categorySwatch(null)
  })()

  const qtyNum = Number(row.quantity) || 0

  function bumpQty(delta: number) {
    // Use a step that adapts to scale: small numbers step by .5, larger by 1.
    const step = qtyNum < 2 ? 0.5 : qtyNum < 10 ? 1 : 5
    const next = Math.max(0, +(qtyNum + delta * step).toFixed(2))
    onChange({ quantity: String(next) })
  }

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          "group relative mb-2 flex border-2 bg-[var(--paper)] transition-shadow",
          hasPick
            ? "border-[var(--hairline-bold)]"
            : "border-dashed border-[var(--hairline-bold)]",
          isDragging && "z-10 shadow-[6px_6px_0_var(--hairline-bold)]"
        )}
      >
        {/* Category color stripe — full-height left bar */}
        <div
          aria-hidden
          className="w-1.5 shrink-0"
          style={{ background: hasPick ? swatch.bg : "transparent" }}
        />

        {/* Always-visible drag handle */}
        <button
          type="button"
          aria-label="Drag to reorder"
          className="flex w-9 shrink-0 cursor-grab items-center justify-center border-r border-dashed border-[var(--hairline)] text-[var(--ink-faint)] transition-colors hover:bg-[var(--paper-deep)] hover:text-[var(--ink)] active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <div className="flex flex-1 flex-col gap-0 px-4 py-3.5">
          {/* Top row: badge + name + (optional) tick number + remove */}
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex h-11 w-11 shrink-0 items-center justify-center font-mono text-[16px] font-bold text-white transition hover:scale-[1.04]"
              style={{
                background: hasPick ? swatch.bg : "var(--hairline-bold)",
              }}
              aria-label={hasPick ? "Change ingredient" : "Pick ingredient"}
              title={hasPick ? swatch.label : "Pick an ingredient"}
            >
              {hasPick ? (
                isSubRecipe ? (
                  <BookOpen className="h-5 w-5" />
                ) : (
                  swatch.letter
                )
              ) : (
                <Plus className="h-5 w-5 text-[var(--ink-muted)]" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className={cn(
                "min-w-0 flex-1 text-left transition",
                hasPick ? "" : "py-2"
              )}
            >
              {hasPick ? (
                <>
                  <div className="flex items-baseline gap-2">
                    <span
                      className={cn(
                        "truncate font-display text-[20px] leading-tight text-[var(--ink)]",
                        isSubRecipe && "italic"
                      )}
                    >
                      {label}
                    </span>
                    <Pencil className="h-3 w-3 shrink-0 text-[var(--ink-faint)] opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                    {isSubRecipe
                      ? "sub-recipe component"
                      : (swatch.label ?? "ingredient")}
                  </div>
                </>
              ) : (
                <span className="font-display text-[18px] italic text-[var(--ink-faint)]">
                  Pick an ingredient or sub-recipe…
                </span>
              )}
            </button>

            {index != null && (
              <span className="font-mono text-[10px] tabular-nums text-[var(--ink-faint)]">
                {String(index + 1).padStart(2, "0")}
              </span>
            )}

            <button
              type="button"
              aria-label="Remove ingredient"
              onClick={onRemove}
              disabled={!removable}
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center text-[var(--ink-faint)] transition hover:bg-[var(--accent-bg)] hover:text-[var(--accent-dark)] disabled:cursor-not-allowed disabled:opacity-30",
                !removable && "hover:bg-transparent hover:text-[var(--ink-faint)]"
              )}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Bottom row: quantity steppers + unit chip + cost */}
          {hasPick && (
            <div className="mt-3 flex flex-wrap items-center gap-2 pl-[3.5rem]">
              {/* Quantity stepper cluster */}
              <div className="inline-flex items-stretch border border-[var(--hairline-bold)] bg-[var(--paper)]">
                <button
                  type="button"
                  onClick={() => bumpQty(-1)}
                  disabled={qtyNum <= 0}
                  className="flex h-9 w-9 items-center justify-center text-[var(--ink-muted)] transition hover:bg-[var(--paper-deep)] hover:text-[var(--ink)] disabled:opacity-30"
                  aria-label="Decrease quantity"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={row.quantity}
                  onChange={(e) => onChange({ quantity: e.target.value })}
                  onFocus={(e) => e.target.select()}
                  className="h-9 w-16 border-x border-[var(--hairline-bold)] bg-transparent text-center font-display text-[18px] tabular-nums text-[var(--ink)] focus:bg-[var(--paper-deep)] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  onClick={() => bumpQty(1)}
                  className="flex h-9 w-9 items-center justify-center text-[var(--ink-muted)] transition hover:bg-[var(--paper-deep)] hover:text-[var(--ink)]"
                  aria-label="Increase quantity"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Unit chip + popover */}
              <div className="relative" ref={unitRef}>
                <button
                  type="button"
                  onClick={() => setUnitOpen((v) => !v)}
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 border px-3 font-mono text-[11px] uppercase tracking-[0.12em] transition",
                    unitOpen
                      ? "border-[var(--ink)] bg-[var(--paper-deep)] text-[var(--ink)]"
                      : "border-[var(--hairline-bold)] bg-[var(--paper)] text-[var(--ink)] hover:border-[var(--ink)]"
                  )}
                >
                  {row.unit || "unit"}
                  <ChevronDown
                    className={cn(
                      "h-3 w-3 transition-transform",
                      unitOpen && "rotate-180"
                    )}
                  />
                </button>
                {unitOpen && (
                  <div className="absolute left-0 top-full z-30 mt-1 w-[260px] border-2 border-[var(--ink)] bg-[var(--paper)] p-2 shadow-[4px_4px_0_var(--hairline-bold)]">
                    <div className="mb-1.5 px-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                      Common units
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {COMMON_UNITS.map((u) => {
                        const active = row.unit === u
                        return (
                          <button
                            key={u}
                            type="button"
                            onClick={() => {
                              onChange({ unit: u })
                              setUnitOpen(false)
                            }}
                            className={cn(
                              "border px-2 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] transition",
                              active
                                ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
                                : "border-[var(--hairline)] text-[var(--ink-muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
                            )}
                          >
                            {u}
                          </button>
                        )
                      })}
                    </div>
                    <div className="mt-2 border-t border-dashed border-[var(--hairline)] pt-2">
                      <input
                        type="text"
                        value={row.unit}
                        onChange={(e) => onChange({ unit: e.target.value })}
                        placeholder="…or type a custom unit"
                        className="h-8 w-full border border-[var(--hairline-bold)] bg-transparent px-2 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--ink)] placeholder:normal-case placeholder:tracking-normal placeholder:text-[var(--ink-faint)] focus:border-[var(--ink)] focus:outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Cost provenance */}
              <div className="ml-auto flex items-center">
                {costLine ? (
                  <ProvenanceChip line={costLine} />
                ) : (
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
                    no cost yet
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <IngredientPickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        value={row.picker}
        canonicalIngredients={canonicalIngredients}
        recipes={recipes}
        excludeRecipeIds={excludeRecipeIds}
        onChange={(v) => {
          const patch: Partial<IngredientRowData> = { picker: v }
          if (v?.kind === "ingredient" && !row.unit) {
            patch.unit = v.defaultUnit
          }
          if (v?.kind === "recipe" && !row.unit) {
            patch.unit = "serving"
          }
          onChange(patch)
        }}
        onCanonicalCreated={onCanonicalCreated}
        onCreateIngredient={onOpenCreateDialog}
        title={hasPick ? "Swap ingredient" : "Pick an ingredient"}
      />
    </>
  )
}
