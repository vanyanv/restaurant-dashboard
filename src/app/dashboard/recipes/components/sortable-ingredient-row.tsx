"use client"

import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, Trash2, BookOpen } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { IngredientCommand, type IngredientPickerValue } from "./ingredient-command"
import { ProvenanceChip } from "@/components/recipe/provenance-chip"
import type { CanonicalIngredientSummary, RecipeSummary } from "@/types/recipe"
import type { RecipeCostLine } from "@/lib/recipe-cost"

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

  const hasPick = row.picker !== null
  const isSubRecipe = row.picker?.kind === "recipe"

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative grid grid-cols-[24px_1fr_72px_64px_auto_24px] items-center gap-2 border-b border-[var(--hairline)] px-1 py-2.5 transition-opacity",
        isDragging && "z-10 bg-[var(--paper-deep)] opacity-80 shadow-sm"
      )}
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        className="flex h-6 w-6 cursor-grab items-center justify-center text-[var(--ink-faint)] opacity-0 transition-opacity hover:text-[var(--ink)] group-hover:opacity-100 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="min-w-0">
        {isSubRecipe ? (
          <div className="flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5 text-[var(--accent)]" />
            <span className="font-display italic text-[15px] leading-snug text-[var(--ink)]">
              {row.picker?.kind === "recipe" ? row.picker.label : ""}
            </span>
          </div>
        ) : (
          <IngredientCommand
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
          />
        )}
      </div>

      <Input
        type="number"
        step="0.01"
        min={0}
        placeholder="qty"
        value={row.quantity}
        onChange={(e) => onChange({ quantity: e.target.value })}
        className="h-9 border-[var(--hairline-bold)] bg-transparent text-right font-mono text-sm tabular-nums"
      />

      <Input
        placeholder="unit"
        value={row.unit}
        onChange={(e) => onChange({ unit: e.target.value })}
        className="h-9 border-[var(--hairline-bold)] bg-transparent font-mono text-xs uppercase tracking-[0.08em]"
      />

      <div className="flex min-w-[140px] justify-end">
        {hasPick && costLine ? (
          <ProvenanceChip line={costLine} />
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
            —
          </span>
        )}
      </div>

      <button
        type="button"
        aria-label="Remove row"
        onClick={onRemove}
        disabled={!removable}
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-sm text-[var(--ink-faint)] opacity-0 transition-opacity hover:text-[var(--accent)] disabled:cursor-not-allowed group-hover:opacity-100",
          !removable && "hover:text-[var(--ink-faint)]"
        )}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

