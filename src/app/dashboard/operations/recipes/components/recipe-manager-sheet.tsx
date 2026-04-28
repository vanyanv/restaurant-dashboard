"use client"

import { useState, useEffect, useTransition } from "react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Plus,
  Trash2,
  Save,
  ArrowLeft,
  ChefHat,
  CheckCircle2,
  Sparkles,
  Loader2,
} from "lucide-react"
import {
  upsertRecipe,
  deleteRecipe,
  getMenuItemsForRecipeBuilder,
} from "@/app/actions/product-usage-actions"
import { useIsPhone } from "@/hooks/use-is-phone"
import type {
  RecipeWithIngredients,
  RecipeIngredientInput,
  MenuItemForRecipeBuilder,
  AiRecipeSuggestion,
} from "@/types/product-usage"

const UNITS = ["EA", "LB", "OZ", "CS", "GAL", "SLICE", "PUMP", "PORTION"] as const

const NUM_CLASS =
  "[font-variant-numeric:tabular-nums_lining-nums] [font-feature-settings:'tnum','lnum']"

interface IngredientRow {
  ingredientName: string
  quantity: string
  unit: string
}

interface RecipeManagerSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  recipes: RecipeWithIngredients[]
  storeId?: string
  onRecipeChange: () => void
}

type ListTab = "configured" | "unconfigured"

export function RecipeManagerSheet({
  open,
  onOpenChange,
  recipes,
  storeId,
  onRecipeChange,
}: RecipeManagerSheetProps) {
  const [mode, setMode] = useState<"list" | "edit">("list")
  const [tab, setTab] = useState<ListTab>("configured")
  const isPhone = useIsPhone()

  const [menuItems, setMenuItems] = useState<MenuItemForRecipeBuilder[]>([])
  const [isLoadingMenuItems, startMenuItemsTransition] = useTransition()

  const [editingRecipe, setEditingRecipe] = useState<RecipeWithIngredients | null>(null)
  const [editItemName, setEditItemName] = useState("")
  const [editCategory, setEditCategory] = useState("")
  const [servingSize, setServingSize] = useState("1")
  const [foodCost, setFoodCost] = useState("")
  const [ingredients, setIngredients] = useState<IngredientRow[]>([])
  const [error, setError] = useState("")
  const [isSaving, startSaveTransition] = useTransition()
  const [isDeleting, startDeleteTransition] = useTransition()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [aiSuggestions, setAiSuggestions] = useState<AiRecipeSuggestion[]>([])
  const [isGeneratingAi, setIsGeneratingAi] = useState(false)
  const [aiError, setAiError] = useState("")

  useEffect(() => {
    if (open) {
      startMenuItemsTransition(async () => {
        const items = await getMenuItemsForRecipeBuilder(storeId)
        setMenuItems(items)
      })
    }
  }, [open, storeId])

  useEffect(() => {
    if (!open) {
      setMode("list")
      setEditingRecipe(null)
      setError("")
      setConfirmDelete(false)
    }
  }, [open])

  function handleEditRecipe(recipe: RecipeWithIngredients) {
    setEditingRecipe(recipe)
    setEditItemName(recipe.itemName)
    setEditCategory(recipe.category)
    setServingSize(String(recipe.servingSize))
    setFoodCost(recipe.foodCostOverride != null ? String(recipe.foodCostOverride) : "")
    setIngredients(
      recipe.ingredients.map((ing) => ({
        ingredientName: ing.ingredientName ?? "",
        quantity: String(ing.quantity),
        unit: ing.unit,
      }))
    )
    setError("")
    setConfirmDelete(false)
    setMode("edit")
  }

  function handleConfigureItem(item: MenuItemForRecipeBuilder) {
    const existingRecipe = recipes.find(
      (r) => r.itemName === item.itemName && r.category === item.category
    )
    if (existingRecipe) {
      handleEditRecipe(existingRecipe)
      return
    }

    setEditingRecipe(null)
    setEditItemName(item.itemName)
    setEditCategory(item.category)
    setServingSize("1")
    setFoodCost("")
    setIngredients([{ ingredientName: "", quantity: "", unit: "EA" }])
    setError("")
    setConfirmDelete(false)
    setMode("edit")
  }

  function handleBackToList() {
    setMode("list")
    setEditingRecipe(null)
    setError("")
    setConfirmDelete(false)
  }

  function addIngredientRow() {
    setIngredients((prev) => [
      ...prev,
      { ingredientName: "", quantity: "", unit: "EA" },
    ])
  }

  function removeIngredientRow(index: number) {
    setIngredients((prev) => prev.filter((_, i) => i !== index))
  }

  function updateIngredientRow(
    index: number,
    field: keyof IngredientRow,
    value: string
  ) {
    setIngredients((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    )
  }

  function handleSave() {
    setError("")

    if (!storeId) {
      setError("Please select a specific store to save recipes.")
      return
    }

    if (ingredients.length === 0) {
      setError("Add at least one ingredient.")
      return
    }

    const parsed: RecipeIngredientInput[] = []
    for (let i = 0; i < ingredients.length; i++) {
      const row = ingredients[i]
      if (!row.ingredientName.trim()) {
        setError(`Ingredient ${i + 1}: name is required.`)
        return
      }
      const qty = parseFloat(row.quantity)
      if (isNaN(qty) || qty <= 0) {
        setError(`Ingredient ${i + 1}: quantity must be greater than 0.`)
        return
      }
      parsed.push({
        ingredientName: row.ingredientName.trim(),
        quantity: qty,
        unit: row.unit,
      })
    }

    startSaveTransition(async () => {
      const parsedCost = parseFloat(foodCost)
      const result = await upsertRecipe(storeId, {
        itemName: editItemName,
        category: editCategory,
        servingSize: parseFloat(servingSize) || 1,
        foodCostOverride: !isNaN(parsedCost) && parsedCost > 0 ? parsedCost : null,
        ingredients: parsed,
      })

      if (!result) {
        setError("Failed to save recipe. Please try again.")
        return
      }

      onRecipeChange()
      const items = await getMenuItemsForRecipeBuilder(storeId)
      setMenuItems(items)
      setMode("list")
      setEditingRecipe(null)
    })
  }

  function handleDelete() {
    if (!editingRecipe) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }

    startDeleteTransition(async () => {
      const success = await deleteRecipe(editingRecipe.id)
      if (!success) {
        setError("Failed to delete recipe. Please try again.")
        return
      }

      onRecipeChange()
      if (storeId) {
        const items = await getMenuItemsForRecipeBuilder(storeId)
        setMenuItems(items)
      }
      setMode("list")
      setEditingRecipe(null)
      setConfirmDelete(false)
    })
  }

  async function handleGenerateAiSuggestions() {
    if (!storeId) return
    setIsGeneratingAi(true)
    setAiError("")
    setAiSuggestions([])

    try {
      const items = unconfiguredItems.slice(0, 10).map((i) => ({
        itemName: i.itemName,
        category: i.category,
      }))
      const res = await fetch("/api/product-usage/suggest-recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, items }),
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error || "Failed to generate suggestions")
      }

      const data = await res.json()
      setAiSuggestions(data.suggestions ?? [])
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI generation failed")
    } finally {
      setIsGeneratingAi(false)
    }
  }

  function handleApplySuggestion(suggestion: AiRecipeSuggestion) {
    setEditingRecipe(null)
    setEditItemName(suggestion.itemName)
    setEditCategory(suggestion.category)
    setServingSize("1")
    setIngredients(
      suggestion.ingredients.map((ing) => ({
        ingredientName: ing.ingredientName,
        quantity: String(ing.quantity),
        unit: ing.unit,
      }))
    )
    setError("")
    setMode("edit")
  }

  const configuredRecipes = recipes
  const unconfiguredItems = menuItems.filter((item) => !item.hasRecipe)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isPhone ? "bottom" : "right"}
        data-mobile-bottom={isPhone ? "true" : undefined}
        className="w-full sm:max-w-lg overflow-y-auto"
        style={{
          background: "var(--paper)",
          borderColor: "var(--hairline-bold)",
        }}
      >
        {mode === "list" ? (
          <>
            <SheetHeader>
              <span className="inv-panel__dept">§ Recipes</span>
              <SheetTitle
                className="font-display italic flex items-center gap-2 mt-0.5"
                style={{ fontSize: 22, color: "var(--ink)" }}
              >
                <ChefHat className="h-5 w-5" style={{ color: "var(--ink-faint)" }} />
                Recipe manager
              </SheetTitle>
              <SheetDescription className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
                Map menu items to ingredients for usage tracking.
              </SheetDescription>
            </SheetHeader>

            <div className="px-4 pb-4 space-y-4">
              <div
                className="flex items-center gap-1 p-0.5"
                style={{ borderBottom: "1px solid var(--hairline-bold)" }}
                role="tablist"
              >
                <TabButton
                  active={tab === "configured"}
                  onClick={() => setTab("configured")}
                >
                  Configured ({configuredRecipes.length})
                </TabButton>
                <TabButton
                  active={tab === "unconfigured"}
                  onClick={() => setTab("unconfigured")}
                >
                  Not configured ({unconfiguredItems.length})
                </TabButton>
              </div>

              {tab === "configured" && (
                <div className="space-y-0">
                  {configuredRecipes.length === 0 ? (
                    <div
                      className="text-center py-8 text-[13px]"
                      style={{ color: "var(--ink-muted)" }}
                    >
                      No recipes configured yet.
                    </div>
                  ) : (
                    configuredRecipes.map((recipe, i) => (
                      <button
                        key={recipe.id}
                        type="button"
                        onClick={() => handleEditRecipe(recipe)}
                        className="editorial-tr w-full text-left flex items-center justify-between gap-3 px-3 py-3"
                        style={{
                          borderTop:
                            i === 0 ? "1px solid var(--hairline-bold)" : "1px solid var(--hairline)",
                          borderBottom:
                            i === configuredRecipes.length - 1
                              ? "1px solid var(--hairline-bold)"
                              : undefined,
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className="text-[13px] font-medium truncate"
                              style={{ color: "var(--ink)" }}
                            >
                              {recipe.itemName}
                            </span>
                            <span
                              className="text-[10px] uppercase tracking-[0.16em]"
                              style={{
                                color: "var(--ink-faint)",
                                fontFamily: "var(--font-jetbrains-mono), monospace",
                              }}
                            >
                              {recipe.category}
                            </span>
                            {recipe.isConfirmed && (
                              <span className="inv-stamp" data-tone="info">
                                <CheckCircle2 className="h-2.5 w-2.5" />
                                Confirmed
                              </span>
                            )}
                            {recipe.isAiGenerated && !recipe.isConfirmed && (
                              <span className="inv-stamp" data-tone="watch">
                                AI draft
                              </span>
                            )}
                          </div>
                          <p
                            className="text-[11px] mt-0.5"
                            style={{ color: "var(--ink-muted)" }}
                          >
                            {recipe.ingredients.length} ingredient
                            {recipe.ingredients.length !== 1 ? "s" : ""}
                            {recipe.foodCostOverride != null && (
                              <span
                                className={`ml-2 font-medium ${NUM_CLASS}`}
                                style={{ color: "var(--ink)" }}
                              >
                                ${recipe.foodCostOverride.toFixed(2)}/serving
                              </span>
                            )}
                          </p>
                        </div>
                        <span
                          className="text-[10px] uppercase tracking-[0.18em] shrink-0"
                          style={{
                            color: "var(--ink-faint)",
                            fontFamily: "var(--font-jetbrains-mono), monospace",
                          }}
                        >
                          Edit →
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}

              {tab === "unconfigured" && (
                <div className="space-y-3">
                  {isLoadingMenuItems ? (
                    <div className="space-y-2">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <div
                          key={i}
                          className="h-14 w-full animate-pulse"
                          style={{ background: "var(--hairline)" }}
                        />
                      ))}
                    </div>
                  ) : unconfiguredItems.length === 0 ? (
                    <div
                      className="text-center py-8 text-[13px]"
                      style={{ color: "var(--ink-muted)" }}
                    >
                      All menu items have recipes configured.
                    </div>
                  ) : (
                    <>
                      {storeId && unconfiguredItems.length > 0 && (
                        <div className="pb-1">
                          <button
                            type="button"
                            onClick={handleGenerateAiSuggestions}
                            disabled={isGeneratingAi}
                            className="toolbar-btn w-full justify-center inline-flex items-center gap-2"
                          >
                            {isGeneratingAi ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="h-3.5 w-3.5" />
                            )}
                            {isGeneratingAi
                              ? "Generating AI suggestions…"
                              : "Generate AI suggestions"}
                          </button>
                          {aiError && (
                            <p
                              className="text-[11px] mt-1.5 text-center"
                              style={{ color: "var(--accent)" }}
                            >
                              {aiError}
                            </p>
                          )}
                        </div>
                      )}

                      {aiSuggestions.length > 0 && (
                        <div className="space-y-2 pb-2">
                          <p
                            className="text-[10px] uppercase tracking-[0.2em] flex items-center gap-1.5"
                            style={{
                              color: "var(--ink-faint)",
                              fontFamily: "var(--font-jetbrains-mono), monospace",
                            }}
                          >
                            <Sparkles className="h-3 w-3" />
                            AI suggestions
                          </p>
                          {aiSuggestions.map((suggestion) => (
                            <div
                              key={`${suggestion.itemName}:::${suggestion.category}`}
                              className="editorial-subpanel editorial-subpanel--bold"
                              style={{ background: "var(--accent-bg)" }}
                            >
                              <div className="flex items-center justify-between mb-1.5 gap-3">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span
                                    className="text-[13px] font-medium truncate"
                                    style={{ color: "var(--ink)" }}
                                  >
                                    {suggestion.itemName}
                                  </span>
                                  <span
                                    className="text-[10px] uppercase tracking-[0.16em]"
                                    style={{
                                      color: "var(--ink-faint)",
                                      fontFamily: "var(--font-jetbrains-mono), monospace",
                                    }}
                                  >
                                    {suggestion.category}
                                  </span>
                                  <span className="inv-stamp" data-tone="watch">
                                    {Math.round(suggestion.confidence * 100)}% confidence
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleApplySuggestion(suggestion)}
                                  className="toolbar-btn shrink-0"
                                >
                                  Use
                                </button>
                              </div>
                              <p
                                className="text-[11px]"
                                style={{ color: "var(--ink-muted)" }}
                              >
                                {suggestion.ingredients
                                  .map(
                                    (i) => `${i.quantity} ${i.unit} ${i.ingredientName}`
                                  )
                                  .join(", ")}
                              </p>
                              {suggestion.reasoning && (
                                <p
                                  className="text-[10px] mt-1 italic"
                                  style={{ color: "var(--ink-faint)" }}
                                >
                                  {suggestion.reasoning}
                                </p>
                              )}
                            </div>
                          ))}
                          <div className="perforation" />
                        </div>
                      )}

                      <div>
                        {unconfiguredItems.map((item, i) => (
                          <button
                            key={`${item.itemName}:::${item.category}`}
                            type="button"
                            onClick={() => handleConfigureItem(item)}
                            disabled={!storeId}
                            className="editorial-tr w-full text-left flex items-center justify-between gap-3 px-3 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{
                              borderTop:
                                i === 0
                                  ? "1px solid var(--hairline-bold)"
                                  : "1px solid var(--hairline)",
                              borderBottom:
                                i === unconfiguredItems.length - 1
                                  ? "1px solid var(--hairline-bold)"
                                  : undefined,
                            }}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className="text-[13px] font-medium truncate"
                                  style={{ color: "var(--ink)" }}
                                >
                                  {item.itemName}
                                </span>
                                <span
                                  className="text-[10px] uppercase tracking-[0.16em]"
                                  style={{
                                    color: "var(--ink-faint)",
                                    fontFamily:
                                      "var(--font-jetbrains-mono), monospace",
                                  }}
                                >
                                  {item.category}
                                </span>
                              </div>
                              <p
                                className={`text-[11px] mt-0.5 ${NUM_CLASS}`}
                                style={{ color: "var(--ink-muted)" }}
                              >
                                {item.totalQuantitySold} sold (last 30d)
                              </p>
                            </div>
                            <span
                              className="text-[10px] uppercase tracking-[0.18em] shrink-0"
                              style={{
                                color: "var(--ink-faint)",
                                fontFamily:
                                  "var(--font-jetbrains-mono), monospace",
                              }}
                            >
                              Configure →
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {!storeId && unconfiguredItems.length > 0 && (
                    <p
                      className="text-[11px] text-center pt-2"
                      style={{ color: "var(--ink-muted)" }}
                    >
                      Select a specific store to configure recipes.
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleBackToList}
                  className="toolbar-btn h-8 w-8 p-0 inline-flex items-center justify-center"
                  aria-label="Back to list"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <SheetTitle
                  className="font-display italic"
                  style={{ fontSize: 20, color: "var(--ink)" }}
                >
                  {editingRecipe ? "Edit recipe" : "New recipe"}
                </SheetTitle>
              </div>
              <SheetDescription className="sr-only">
                {editingRecipe
                  ? `Editing recipe for ${editItemName}`
                  : `Creating recipe for ${editItemName}`}
              </SheetDescription>
            </SheetHeader>

            <div className="px-4 pb-4 space-y-5">
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="text-[14px] font-semibold"
                    style={{ color: "var(--ink)" }}
                  >
                    {editItemName}
                  </span>
                  <span
                    className="text-[10px] uppercase tracking-[0.16em]"
                    style={{
                      color: "var(--ink-faint)",
                      fontFamily: "var(--font-jetbrains-mono), monospace",
                    }}
                  >
                    {editCategory}
                  </span>
                  {editingRecipe?.isConfirmed && (
                    <span className="inv-stamp" data-tone="info">
                      <CheckCircle2 className="h-2.5 w-2.5" />
                      Confirmed
                    </span>
                  )}
                  {editingRecipe?.isAiGenerated && !editingRecipe?.isConfirmed && (
                    <span className="inv-stamp" data-tone="watch">
                      AI generated
                    </span>
                  )}
                </div>
              </div>

              <div className="perforation" />

              <div className="flex gap-4">
                <div className="space-y-2">
                  <Label
                    htmlFor="serving-size"
                    className="text-[10px] uppercase tracking-[0.18em]"
                    style={{
                      color: "var(--ink-faint)",
                      fontFamily: "var(--font-jetbrains-mono), monospace",
                    }}
                  >
                    Serving size
                  </Label>
                  <Input
                    id="serving-size"
                    type="number"
                    min="1"
                    step="1"
                    value={servingSize}
                    onChange={(e) => setServingSize(e.target.value)}
                    className="w-24"
                  />
                </div>
                <div className="space-y-2">
                  <Label
                    htmlFor="food-cost"
                    className="text-[10px] uppercase tracking-[0.18em]"
                    style={{
                      color: "var(--ink-faint)",
                      fontFamily: "var(--font-jetbrains-mono), monospace",
                    }}
                  >
                    Food cost / serving ($)
                  </Label>
                  <Input
                    id="food-cost"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={foodCost}
                    onChange={(e) => setFoodCost(e.target.value)}
                    className="w-32"
                  />
                </div>
              </div>

              <div className="perforation" />

              <div className="space-y-3">
                <Label
                  className="text-[10px] uppercase tracking-[0.18em]"
                  style={{
                    color: "var(--ink-faint)",
                    fontFamily: "var(--font-jetbrains-mono), monospace",
                  }}
                >
                  Ingredients
                </Label>
                {ingredients.length === 0 && (
                  <p className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
                    No ingredients added. Click below to add one.
                  </p>
                )}
                <div className="space-y-2">
                  {ingredients.map((row, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        placeholder="Ingredient name"
                        value={row.ingredientName}
                        onChange={(e) =>
                          updateIngredientRow(index, "ingredientName", e.target.value)
                        }
                        className="flex-1 min-w-0"
                      />
                      <Input
                        type="number"
                        placeholder="Qty"
                        min="0"
                        step="any"
                        value={row.quantity}
                        onChange={(e) =>
                          updateIngredientRow(index, "quantity", e.target.value)
                        }
                        className="w-20"
                      />
                      <Select
                        value={row.unit}
                        onValueChange={(val) =>
                          updateIngredientRow(index, "unit", val)
                        }
                      >
                        <SelectTrigger className="w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {UNITS.map((unit) => (
                            <SelectItem key={unit} value={unit}>
                              {unit}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <button
                        type="button"
                        onClick={() => removeIngredientRow(index)}
                        className="h-8 w-8 inline-flex items-center justify-center"
                        style={{ color: "var(--ink-faint)" }}
                        aria-label={`Remove ingredient ${index + 1}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={addIngredientRow}
                  className="toolbar-btn w-full justify-center inline-flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add ingredient
                </button>
              </div>

              {error && (
                <p className="text-[13px] font-medium" style={{ color: "var(--accent)" }}>
                  {error}
                </p>
              )}

              <div className="perforation" />

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving || isDeleting}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-[12px] uppercase tracking-[0.16em] font-semibold disabled:opacity-50"
                  style={{
                    background: "var(--ink)",
                    color: "var(--paper)",
                    border: "1px solid var(--ink)",
                    fontFamily: "var(--font-jetbrains-mono), monospace",
                  }}
                >
                  <Save className="h-4 w-4" />
                  {isSaving ? "Saving…" : "Save recipe"}
                </button>
                {editingRecipe && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={isSaving || isDeleting}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-[12px] uppercase tracking-[0.16em] font-semibold disabled:opacity-50"
                    style={{
                      background: confirmDelete ? "var(--accent)" : "transparent",
                      color: confirmDelete ? "var(--paper)" : "var(--accent)",
                      border: "1px solid var(--accent)",
                      fontFamily: "var(--font-jetbrains-mono), monospace",
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    {isDeleting
                      ? "Deleting…"
                      : confirmDelete
                        ? "Tap again to confirm"
                        : "Delete recipe"}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="flex-1 px-3 py-2 text-[11px] uppercase tracking-[0.16em] font-semibold relative"
      style={{
        color: active ? "var(--accent)" : "var(--ink-muted)",
        fontFamily: "var(--font-jetbrains-mono), monospace",
        background: active ? "var(--accent-bg)" : "transparent",
      }}
    >
      {children}
    </button>
  )
}
