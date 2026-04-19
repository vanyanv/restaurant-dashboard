"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { Plus, Save, X, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  upsertRecipe,
  previewRecipeCost,
  confirmRecipe,
} from "@/app/actions/recipe-actions"
import { mapOtterItemToRecipe } from "@/app/actions/menu-item-actions"
import { SortableIngredientRow, type IngredientRowData } from "./sortable-ingredient-row"
import type { IngredientPickerValue } from "./ingredient-command"
import { CostPanel } from "./cost-panel"
import type {
  CanonicalIngredientSummary,
  RecipeSummary,
} from "@/types/recipe"
import type { RecipeCostResult } from "@/lib/recipe-cost"

export type CanvasInitialValue = {
  recipeId?: string
  itemName: string
  category: string
  servingSize: number
  isSellable: boolean
  notes: string
  foodCostOverride: string
  isConfirmed: boolean
  mapOtterItemName?: string
  ingredients: IngredientRowData[]
}

type Props = {
  initial: CanvasInitialValue
  canonicalIngredients: CanonicalIngredientSummary[]
  recipes: RecipeSummary[]
  onSaved: () => void
  onCancel: () => void
  onRequestCreateIngredient: () => void
  onCanonicalCreated: () => void
}

export function RecipeCanvas({
  initial,
  canonicalIngredients,
  recipes,
  onSaved,
  onCancel,
  onRequestCreateIngredient,
  onCanonicalCreated,
}: Props) {
  const [itemName, setItemName] = useState(initial.itemName)
  const [category, setCategory] = useState(initial.category)
  const [servingSize, setServingSize] = useState(String(initial.servingSize))
  const [isSellable, setIsSellable] = useState(initial.isSellable)
  const [notes, setNotes] = useState(initial.notes)
  const [foodCost, setFoodCost] = useState(initial.foodCostOverride)
  const [rows, setRows] = useState<IngredientRowData[]>(
    initial.ingredients.length > 0 ? initial.ingredients : [blankRow()]
  )
  const [isConfirmed, setIsConfirmed] = useState(initial.isConfirmed)

  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [cost, setCost] = useState<RecipeCostResult | null>(null)
  const [costLoading, setCostLoading] = useState(false)
  const costReqId = useRef(0)

  const servingSizeNum = Number(servingSize) || 1

  const excludeRecipeIds = useMemo(
    () => (initial.recipeId ? [initial.recipeId] : []),
    [initial.recipeId]
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Live cost preview — debounced
  useEffect(() => {
    const valid = rows.filter(
      (r) => r.picker !== null && Number(r.quantity) > 0
    )
    if (valid.length === 0) {
      setCost(null)
      return
    }
    const reqId = ++costReqId.current
    setCostLoading(true)
    const timer = setTimeout(() => {
      previewRecipeCost({
        ingredients: valid.map((r) => ({
          canonicalIngredientId:
            r.picker?.kind === "ingredient"
              ? r.picker.canonicalIngredientId
              : null,
          componentRecipeId:
            r.picker?.kind === "recipe" ? r.picker.componentRecipeId : null,
          quantity: Number(r.quantity),
          unit: r.unit,
          ingredientName:
            r.picker?.kind === "ingredient" || r.picker?.kind === "recipe"
              ? r.picker.label
              : null,
        })),
      })
        .then((result) => {
          if (reqId === costReqId.current) setCost(result)
        })
        .catch(() => {})
        .finally(() => {
          if (reqId === costReqId.current) setCostLoading(false)
        })
    }, 250)
    return () => clearTimeout(timer)
  }, [rows])

  // Map: row.id → cost line (aligned by order of valid rows)
  const costByRowId = useMemo(() => {
    const map = new Map<string, (typeof cost extends null ? never : RecipeCostResult)["lines"][number]>()
    if (!cost) return map
    const validRows = rows.filter(
      (r) => r.picker !== null && Number(r.quantity) > 0
    )
    validRows.forEach((r, i) => {
      const line = cost.lines[i]
      if (line) map.set(r.id, line)
    })
    return map
  }, [cost, rows])

  function addRow() {
    setRows((prev) => [...prev, blankRow()])
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  function patchRow(id: string, patch: Partial<IngredientRowData>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setRows((prev) => {
      const oldIndex = prev.findIndex((r) => r.id === active.id)
      const newIndex = prev.findIndex((r) => r.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return prev
      return arrayMove(prev, oldIndex, newIndex)
    })
  }

  function handleSave() {
    setError(null)

    const trimmedName = itemName.trim()
    if (!trimmedName) {
      setError("Item name is required.")
      return
    }
    if (!category.trim()) {
      setError("Category is required.")
      return
    }

    const payloadIngredients = rows
      .filter((r) => r.picker !== null && Number(r.quantity) > 0)
      .map((r) => {
        const p = r.picker!
        return {
          canonicalIngredientId:
            p.kind === "ingredient" ? p.canonicalIngredientId : null,
          componentRecipeId:
            p.kind === "recipe" ? p.componentRecipeId : null,
          ingredientName: p.label,
          quantity: Number(r.quantity),
          unit:
            r.unit || (p.kind === "ingredient" ? p.defaultUnit : "unit"),
          notes: r.notes || null,
        }
      })

    if (payloadIngredients.length === 0) {
      setError("Add at least one ingredient.")
      return
    }

    startTransition(async () => {
      try {
        const result = await upsertRecipe({
          id: initial.recipeId,
          itemName: trimmedName,
          category: category.trim(),
          servingSize: servingSizeNum,
          isSellable,
          notes: notes || null,
          foodCostOverride: foodCost ? Number(foodCost) : null,
          ingredients: payloadIngredients,
        })
        if (initial.mapOtterItemName && result.id) {
          await mapOtterItemToRecipe({
            otterItemName: initial.mapOtterItemName,
            recipeId: result.id,
          })
        }
        onSaved()
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed")
      }
    })
  }

  function handleConfirm(next: boolean) {
    if (!initial.recipeId) return
    setIsConfirmed(next)
    confirmRecipe(initial.recipeId, next).catch(() => {
      setIsConfirmed(!next)
    })
  }

  return (
    <div className="grid h-full grid-cols-[1fr_320px] overflow-hidden">
      {/* Canvas column */}
      <div className="relative flex h-full flex-col overflow-hidden bg-[var(--paper)]">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[720px] flex-col gap-6 px-10 py-10">
            {/* Title block */}
            <div>
              <div className="editorial-section-label">
                {initial.recipeId ? "Editing" : "New"} · {isSellable ? "menu item" : "prep recipe"}
              </div>
              <input
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                placeholder="Name this dish…"
                className="mt-2 w-full bg-transparent font-display text-[38px] italic leading-[1.05] tracking-[-0.02em] text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none"
                style={{ fontFeatureSettings: "'ss01','dlig','liga'" }}
              />
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-dashed border-[var(--hairline-bold)] pb-4 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--ink-muted)]">
                <MetaPill label="Category">
                  <input
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-28 bg-transparent uppercase tracking-[0.08em] text-[var(--ink)] focus:outline-none"
                    placeholder="category"
                  />
                </MetaPill>
                <MetaPill label="Serves">
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={servingSize}
                    onChange={(e) => setServingSize(e.target.value)}
                    className="w-12 bg-transparent tabular-nums text-[var(--ink)] focus:outline-none"
                  />
                </MetaPill>
                <MetaPill label="Override">
                  <span className="text-[var(--ink-faint)]">$</span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="—"
                    value={foodCost}
                    onChange={(e) => setFoodCost(e.target.value)}
                    className="w-14 bg-transparent tabular-nums text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none"
                  />
                </MetaPill>
                <label className="flex cursor-pointer items-center gap-2">
                  <Switch
                    checked={isSellable}
                    onCheckedChange={setIsSellable}
                  />
                  <span>sellable</span>
                </label>
                {initial.recipeId && (
                  <button
                    type="button"
                    onClick={() => handleConfirm(!isConfirmed)}
                    className={`ml-auto inline-flex items-center gap-1 border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] transition ${
                      isConfirmed
                        ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                        : "border-[var(--hairline-bold)] text-[var(--ink-muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
                    }`}
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    {isConfirmed ? "Confirmed" : "Mark confirmed"}
                  </button>
                )}
              </div>
            </div>

            {/* Ingredients */}
            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="editorial-section-label">Ingredients</h2>
                <span className="font-mono text-[10px] tabular-nums text-[var(--ink-faint)]">
                  {rows.filter((r) => r.picker !== null).length} line{rows.filter((r) => r.picker !== null).length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="border-t border-[var(--hairline)]">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={rows.map((r) => r.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {rows.map((row) => (
                      <SortableIngredientRow
                        key={row.id}
                        row={row}
                        canonicalIngredients={canonicalIngredients}
                        recipes={recipes}
                        excludeRecipeIds={excludeRecipeIds}
                        costLine={costByRowId.get(row.id)}
                        onChange={(patch) => patchRow(row.id, patch)}
                        onRemove={() => removeRow(row.id)}
                        removable={rows.length > 1}
                        onCanonicalCreated={onCanonicalCreated}
                        onOpenCreateDialog={onRequestCreateIngredient}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              </div>

              <button
                type="button"
                onClick={addRow}
                className="mt-3 inline-flex items-center gap-2 border border-dashed border-[var(--hairline-bold)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)] transition hover:border-[var(--ink)] hover:text-[var(--ink)]"
              >
                <Plus className="h-3 w-3" />
                Add ingredient
              </button>
            </div>

            {/* Notes */}
            <div className="border-t border-[var(--hairline)] pt-5">
              <h2 className="editorial-section-label mb-2">Notes</h2>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Prep instructions, allergens, plating…"
                rows={3}
                className="w-full resize-none border-b border-dashed border-[var(--hairline)] bg-transparent px-0 py-1 text-sm leading-relaxed text-[var(--ink)] placeholder:italic placeholder:text-[var(--ink-faint)] focus:border-[var(--ink)] focus:outline-none"
              />
            </div>

            {error && (
              <div className="border border-[var(--accent)] bg-[var(--accent-bg)] px-3 py-2 text-sm text-[var(--accent-dark)]">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Sticky action bar */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--hairline)] bg-[var(--paper-deep)] px-6 py-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            className="h-8 text-[var(--ink-muted)] hover:bg-[var(--paper)] hover:text-[var(--ink)]"
          >
            <X className="mr-1 h-3.5 w-3.5" />
            Close
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={pending}
            className="h-8 bg-[var(--ink)] text-[var(--paper)] hover:bg-[var(--accent-dark)]"
          >
            <Save className="mr-1 h-3.5 w-3.5" />
            {pending ? "Saving…" : initial.recipeId ? "Save changes" : "Save recipe"}
          </Button>
        </div>
      </div>

      {/* Right panel */}
      <CostPanel
        cost={cost}
        loading={costLoading}
        servingSize={servingSizeNum}
        foodCostOverride={foodCost ? Number(foodCost) : null}
      />
    </div>
  )
}

function MetaPill({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[var(--ink-faint)]">{label}</span>
      <span className="inline-flex items-center gap-0.5">{children}</span>
    </span>
  )
}

function blankRow(): IngredientRowData {
  return {
    id: Math.random().toString(36).slice(2),
    picker: null as IngredientPickerValue,
    quantity: "1",
    unit: "",
    notes: "",
  }
}
