"use client"

import { useState, useEffect, useTransition } from "react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
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
import { cn } from "@/lib/utils"
import {
  upsertRecipe,
  deleteRecipe,
  getMenuItemsForRecipeBuilder,
} from "@/app/actions/product-usage-actions"
import type {
  RecipeWithIngredients,
  RecipeIngredientInput,
  MenuItemForRecipeBuilder,
  AiRecipeSuggestion,
} from "@/types/product-usage"

const UNITS = ["EA", "LB", "OZ", "CS", "GAL", "SLICE", "PUMP", "PORTION"] as const

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

export function RecipeManagerSheet({
  open,
  onOpenChange,
  recipes,
  storeId,
  onRecipeChange,
}: RecipeManagerSheetProps) {
  // ── Mode state ──
  const [mode, setMode] = useState<"list" | "edit">("list")

  // ── List mode state ──
  const [menuItems, setMenuItems] = useState<MenuItemForRecipeBuilder[]>([])
  const [isLoadingMenuItems, startMenuItemsTransition] = useTransition()

  // ── Edit mode state ──
  const [editingRecipe, setEditingRecipe] = useState<RecipeWithIngredients | null>(null)
  const [editItemName, setEditItemName] = useState("")
  const [editCategory, setEditCategory] = useState("")
  const [servingSize, setServingSize] = useState("1")
  const [foodCost, setFoodCost] = useState("")
  const [ingredients, setIngredients] = useState<IngredientRow[]>([])
  const [error, setError] = useState("")
  const [isSaving, startSaveTransition] = useTransition()
  const [isDeleting, startDeleteTransition] = useTransition()

  // ── AI suggestion state ──
  const [aiSuggestions, setAiSuggestions] = useState<AiRecipeSuggestion[]>([])
  const [isGeneratingAi, setIsGeneratingAi] = useState(false)
  const [aiError, setAiError] = useState("")

  // ── Load menu items on open ──
  useEffect(() => {
    if (open) {
      startMenuItemsTransition(async () => {
        const items = await getMenuItemsForRecipeBuilder(storeId)
        setMenuItems(items)
      })
    }
  }, [open, storeId])

  // ── Reset to list mode when sheet closes ──
  useEffect(() => {
    if (!open) {
      setMode("list")
      setEditingRecipe(null)
      setError("")
    }
  }, [open])

  // ── Enter edit mode for an existing recipe ──
  function handleEditRecipe(recipe: RecipeWithIngredients) {
    setEditingRecipe(recipe)
    setEditItemName(recipe.itemName)
    setEditCategory(recipe.category)
    setServingSize(String(recipe.servingSize))
    setFoodCost(recipe.foodCostOverride != null ? String(recipe.foodCostOverride) : "")
    setIngredients(
      recipe.ingredients.map((ing) => ({
        ingredientName: ing.ingredientName,
        quantity: String(ing.quantity),
        unit: ing.unit,
      }))
    )
    setError("")
    setMode("edit")
  }

  // ── Enter edit mode for a new/unconfigured item ──
  function handleConfigureItem(item: MenuItemForRecipeBuilder) {
    // Check if there's already a recipe (could have been created since list loaded)
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
    setMode("edit")
  }

  // ── Back to list ──
  function handleBackToList() {
    setMode("list")
    setEditingRecipe(null)
    setError("")
  }

  // ── Ingredient row management ──
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

  // ── Save recipe ──
  function handleSave() {
    setError("")

    if (!storeId) {
      setError("Please select a specific store to save recipes.")
      return
    }

    // Validate
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
      // Refresh menu items for the list
      const items = await getMenuItemsForRecipeBuilder(storeId)
      setMenuItems(items)
      setMode("list")
      setEditingRecipe(null)
    })
  }

  // ── Delete recipe ──
  function handleDelete() {
    if (!editingRecipe) return

    startDeleteTransition(async () => {
      const success = await deleteRecipe(editingRecipe.id)
      if (!success) {
        setError("Failed to delete recipe. Please try again.")
        return
      }

      onRecipeChange()
      // Refresh menu items for the list
      if (storeId) {
        const items = await getMenuItemsForRecipeBuilder(storeId)
        setMenuItems(items)
      }
      setMode("list")
      setEditingRecipe(null)
    })
  }

  // ── Generate AI suggestions for unconfigured items ──
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

  // ── Apply an AI suggestion to edit mode ──
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

  // ── Derived data ──
  const configuredRecipes = recipes
  const unconfiguredItems = menuItems.filter((item) => !item.hasRecipe)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg overflow-y-auto"
      >
        {mode === "list" ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <ChefHat className="h-5 w-5" />
                Recipe Manager
              </SheetTitle>
              <SheetDescription>
                Configure recipes to map menu items to their ingredients for
                usage tracking.
              </SheetDescription>
            </SheetHeader>

            <div className="px-4 pb-4">
              <Tabs defaultValue="configured" className="space-y-4">
                <TabsList className="w-full">
                  <TabsTrigger value="configured" className="flex-1">
                    Configured ({configuredRecipes.length})
                  </TabsTrigger>
                  <TabsTrigger value="unconfigured" className="flex-1">
                    Not Configured ({unconfiguredItems.length})
                  </TabsTrigger>
                </TabsList>

                {/* Configured tab */}
                <TabsContent value="configured" className="space-y-2">
                  {configuredRecipes.length === 0 ? (
                    <div className="text-center py-8 text-sm text-muted-foreground">
                      No recipes configured yet.
                    </div>
                  ) : (
                    configuredRecipes.map((recipe) => (
                      <div
                        key={recipe.id}
                        className="flex items-center justify-between p-3 rounded-lg border bg-card"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium truncate">
                              {recipe.itemName}
                            </p>
                            <Badge variant="secondary" className="text-xs">
                              {recipe.category}
                            </Badge>
                            {recipe.isConfirmed && (
                              <Badge
                                variant="outline"
                                className="text-emerald-600 text-xs"
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Confirmed
                              </Badge>
                            )}
                            {recipe.isAiGenerated && !recipe.isConfirmed && (
                              <Badge
                                variant="outline"
                                className="text-amber-600 text-xs"
                              >
                                AI
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {recipe.ingredients.length} ingredient
                            {recipe.ingredients.length !== 1 ? "s" : ""}
                            {recipe.foodCostOverride != null && (
                              <span className="ml-2 text-emerald-600 font-medium">
                                ${recipe.foodCostOverride.toFixed(2)}/serving
                              </span>
                            )}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditRecipe(recipe)}
                        >
                          Edit
                        </Button>
                      </div>
                    ))
                  )}
                </TabsContent>

                {/* Not Configured tab */}
                <TabsContent value="unconfigured" className="space-y-2">
                  {isLoadingMenuItems ? (
                    <div className="space-y-2">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-14 w-full rounded-lg" />
                      ))}
                    </div>
                  ) : unconfiguredItems.length === 0 ? (
                    <div className="text-center py-8 text-sm text-muted-foreground">
                      All menu items have recipes configured.
                    </div>
                  ) : (
                    <>
                      {/* AI Suggestion Button */}
                      {storeId && unconfiguredItems.length > 0 && (
                        <div className="pb-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full gap-2"
                            onClick={handleGenerateAiSuggestions}
                            disabled={isGeneratingAi}
                          >
                            {isGeneratingAi ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Sparkles className="h-4 w-4" />
                            )}
                            {isGeneratingAi
                              ? "Generating AI Suggestions..."
                              : "Generate AI Suggestions"}
                          </Button>
                          {aiError && (
                            <p className="text-xs text-destructive mt-1 text-center">
                              {aiError}
                            </p>
                          )}
                        </div>
                      )}

                      {/* AI Suggestions */}
                      {aiSuggestions.length > 0 && (
                        <div className="space-y-2 pb-2">
                          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                            <Sparkles className="h-3 w-3" />
                            AI Suggestions
                          </p>
                          {aiSuggestions.map((suggestion) => (
                            <div
                              key={`${suggestion.itemName}:::${suggestion.category}`}
                              className="p-3 rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20"
                            >
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-medium truncate">
                                    {suggestion.itemName}
                                  </p>
                                  <Badge variant="secondary" className="text-xs">
                                    {suggestion.category}
                                  </Badge>
                                  <Badge variant="outline" className="text-xs text-amber-600">
                                    {Math.round(suggestion.confidence * 100)}% confidence
                                  </Badge>
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="shrink-0"
                                  onClick={() => handleApplySuggestion(suggestion)}
                                >
                                  Use
                                </Button>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {suggestion.ingredients.map(
                                  (i) => `${i.quantity} ${i.unit} ${i.ingredientName}`
                                ).join(", ")}
                              </p>
                              {suggestion.reasoning && (
                                <p className="text-[10px] text-muted-foreground/80 mt-1 italic">
                                  {suggestion.reasoning}
                                </p>
                              )}
                            </div>
                          ))}
                          <Separator />
                        </div>
                      )}

                      {/* Unconfigured items list */}
                      {unconfiguredItems.map((item) => (
                        <div
                          key={`${item.itemName}:::${item.category}`}
                          className="flex items-center justify-between p-3 rounded-lg border bg-card"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium truncate">
                                {item.itemName}
                              </p>
                              <Badge variant="secondary" className="text-xs">
                                {item.category}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {item.totalQuantitySold} sold (last 30d)
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleConfigureItem(item)}
                            disabled={!storeId}
                          >
                            Configure
                          </Button>
                        </div>
                      ))}
                    </>
                  )}
                  {!storeId && unconfiguredItems.length > 0 && (
                    <p className="text-xs text-muted-foreground text-center pt-2">
                      Select a specific store to configure recipes.
                    </p>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </>
        ) : (
          /* ── Edit Mode ── */
          <>
            <SheetHeader>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBackToList}
                  className="h-8 w-8 p-0"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <SheetTitle className="text-base">
                  {editingRecipe ? "Edit Recipe" : "New Recipe"}
                </SheetTitle>
              </div>
              <SheetDescription className="sr-only">
                {editingRecipe
                  ? `Editing recipe for ${editItemName}`
                  : `Creating recipe for ${editItemName}`}
              </SheetDescription>
            </SheetHeader>

            <div className="px-4 pb-4 space-y-6">
              {/* Item info */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold">{editItemName}</span>
                  <Badge variant="secondary">{editCategory}</Badge>
                  {editingRecipe?.isConfirmed && (
                    <Badge
                      variant="outline"
                      className="text-emerald-600"
                    >
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Confirmed
                    </Badge>
                  )}
                  {editingRecipe?.isAiGenerated && !editingRecipe?.isConfirmed && (
                    <Badge variant="outline" className="text-amber-600">
                      AI Generated
                    </Badge>
                  )}
                </div>
              </div>

              <Separator />

              {/* Serving size & food cost */}
              <div className="flex gap-4">
                <div className="space-y-2">
                  <Label htmlFor="serving-size">Serving Size</Label>
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
                  <Label htmlFor="food-cost">Food Cost / Serving ($)</Label>
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

              <Separator />

              {/* Ingredients */}
              <div className="space-y-3">
                <Label>Ingredients</Label>
                {ingredients.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No ingredients added. Click below to add one.
                  </p>
                )}
                <div className="space-y-2">
                  {ingredients.map((row, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2"
                    >
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeIngredientRow(index)}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={addIngredientRow}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Ingredient
                </Button>
              </div>

              {/* Error message */}
              {error && (
                <p className="text-sm text-destructive font-medium">{error}</p>
              )}

              <Separator />

              {/* Action buttons */}
              <div className="flex flex-col gap-2">
                <Button
                  onClick={handleSave}
                  disabled={isSaving || isDeleting}
                >
                  <Save className="h-4 w-4 mr-2" />
                  {isSaving ? "Saving..." : "Save Recipe"}
                </Button>
                {editingRecipe && (
                  <Button
                    variant="destructive"
                    onClick={handleDelete}
                    disabled={isSaving || isDeleting}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {isDeleting ? "Deleting..." : "Delete Recipe"}
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
