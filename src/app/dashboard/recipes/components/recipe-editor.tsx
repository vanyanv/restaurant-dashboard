"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { Trash2, Plus, Save, X, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  upsertRecipe,
  previewRecipeCost,
  confirmRecipe,
} from "@/app/actions/recipe-actions"
import { mapOtterItemToRecipe } from "@/app/actions/menu-item-actions"
import { IngredientPicker, type IngredientPickerValue } from "./ingredient-picker"
import { RecipeCostSummary } from "./recipe-cost-summary"
import type {
  CanonicalIngredientSummary,
  RecipeSummary,
} from "@/types/recipe"
import type { RecipeCostResult } from "@/lib/recipe-cost"

export type EditorInitialValue = {
  recipeId?: string
  itemName: string
  category: string
  servingSize: number
  isSellable: boolean
  notes: string
  foodCostOverride: string
  isConfirmed: boolean
  /** Otter item this recipe is being mapped to on save (used for new menu-item recipes). */
  mapOtterItemName?: string
  ingredients: EditorIngredientRow[]
}

export type EditorIngredientRow = {
  id: string
  picker: IngredientPickerValue
  quantity: string
  unit: string
  notes: string
}

type Props = {
  key?: string
  initial: EditorInitialValue
  canonicalIngredients: CanonicalIngredientSummary[]
  recipes: RecipeSummary[]
  onSaved: () => void
  onCancel: () => void
  onRequestCreateIngredient: () => void
}

export function RecipeEditor({
  initial,
  canonicalIngredients,
  recipes,
  onSaved,
  onCancel,
  onRequestCreateIngredient,
}: Props) {
  const [itemName, setItemName] = useState(initial.itemName)
  const [category, setCategory] = useState(initial.category)
  const [servingSize, setServingSize] = useState(String(initial.servingSize))
  const [isSellable, setIsSellable] = useState(initial.isSellable)
  const [notes, setNotes] = useState(initial.notes)
  const [foodCost, setFoodCost] = useState(initial.foodCostOverride)
  const [ingredients, setIngredients] = useState<EditorIngredientRow[]>(
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

  // Live cost preview — debounced
  useEffect(() => {
    const valid = ingredients.filter(
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
  }, [ingredients])

  function addRow() {
    setIngredients((prev) => [...prev, blankRow()])
  }

  function removeRow(id: string) {
    setIngredients((prev) => prev.filter((r) => r.id !== id))
  }

  function patchRow(id: string, patch: Partial<EditorIngredientRow>) {
    setIngredients((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
    )
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

    const payloadIngredients = ingredients
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
          unit: r.unit || (p.kind === "ingredient" ? p.defaultUnit : "unit"),
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
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">
            {initial.recipeId ? "Edit recipe" : "New recipe"}
          </h2>
          {initial.recipeId && (
            <Button
              size="sm"
              variant={isConfirmed ? "default" : "outline"}
              onClick={() => handleConfirm(!isConfirmed)}
              className="h-7"
            >
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              {isConfirmed ? "Confirmed" : "Mark confirmed"}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            <X className="mr-1 h-3.5 w-3.5" />
            Close
          </Button>
          <Button size="sm" onClick={handleSave} disabled={pending}>
            <Save className="mr-1 h-3.5 w-3.5" />
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="itemName">Name</Label>
            <Input
              id="itemName"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="category">Category</Label>
            <Input
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="servingSize">Serving size</Label>
            <Input
              id="servingSize"
              type="number"
              step="0.01"
              min={0}
              value={servingSize}
              onChange={(e) => setServingSize(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="foodCost">Food cost override</Label>
            <Input
              id="foodCost"
              type="number"
              step="0.01"
              min={0}
              placeholder="optional $"
              value={foodCost}
              onChange={(e) => setFoodCost(e.target.value)}
            />
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <Switch
              checked={isSellable}
              onCheckedChange={setIsSellable}
              id="sellable"
            />
            <Label htmlFor="sellable" className="cursor-pointer">
              Sellable menu item (uncheck for prep recipes / sub-components)
            </Label>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Ingredients</h3>
            <Button size="sm" variant="outline" onClick={addRow} className="h-7">
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add row
            </Button>
          </div>

          <div className="space-y-2">
            {ingredients.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-[1fr_100px_100px_36px] items-center gap-2"
              >
                <IngredientPicker
                  value={row.picker}
                  canonicalIngredients={canonicalIngredients}
                  recipes={recipes}
                  excludeRecipeIds={excludeRecipeIds}
                  onCreateIngredient={onRequestCreateIngredient}
                  onChange={(v) => {
                    const patch: Partial<EditorIngredientRow> = { picker: v }
                    if (v?.kind === "ingredient" && !row.unit) {
                      patch.unit = v.defaultUnit
                    }
                    if (v?.kind === "recipe" && !row.unit) {
                      patch.unit = "serving"
                    }
                    patchRow(row.id, patch)
                  }}
                />
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="qty"
                  value={row.quantity}
                  onChange={(e) => patchRow(row.id, { quantity: e.target.value })}
                />
                <Input
                  placeholder="unit"
                  value={row.unit}
                  onChange={(e) => patchRow(row.id, { unit: e.target.value })}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => removeRow(row.id)}
                  disabled={ingredients.length === 1}
                  className="h-8 w-8"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor="notes">Notes</Label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="prep instructions, allergens, etc."
            rows={2}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        <RecipeCostSummary
          cost={cost}
          loading={costLoading}
          servingSize={servingSizeNum}
        />

        {error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}

function blankRow(): EditorIngredientRow {
  return {
    id: Math.random().toString(36).slice(2),
    picker: null,
    quantity: "1",
    unit: "",
    notes: "",
  }
}
