"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { EditorialTopbar } from "../../components/editorial-topbar"
import { MenuItemList } from "./menu-item-list"
import {
  RecipeEditor,
  type EditorInitialValue,
  type EditorIngredientRow,
} from "./recipe-editor"
import { getRecipeDetail } from "@/app/actions/recipe-actions"
import {
  createCanonicalIngredient,
  runCanonicalIngredientSeed,
} from "@/app/actions/canonical-ingredient-actions"
import type {
  MenuItemForCatalog,
  RecipeSummary,
  CanonicalIngredientSummary,
} from "@/types/recipe"

type Props = {
  initialMenuItems: MenuItemForCatalog[]
  initialRecipes: RecipeSummary[]
  initialCanonicalIngredients: CanonicalIngredientSummary[]
}

type Filter = "unbuilt" | "all" | "prep" | "confirmed"

export function RecipesContent({
  initialMenuItems,
  initialRecipes,
  initialCanonicalIngredients,
}: Props) {
  const router = useRouter()
  const [filter, setFilter] = useState<Filter>("unbuilt")
  const [editor, setEditor] = useState<EditorInitialValue | null>(null)
  const [selectedMenuItemName, setSelectedMenuItemName] = useState<string | null>(
    null
  )
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null)
  const [loadingDetail, setLoadingDetail] = useTransition()
  const [seedPending, startSeedTransition] = useTransition()
  const [seedMessage, setSeedMessage] = useState<string | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newIngName, setNewIngName] = useState("")
  const [newIngUnit, setNewIngUnit] = useState("")
  const [newIngCategory, setNewIngCategory] = useState("")
  const [createPending, startCreateTransition] = useTransition()
  const [canonicalIngredients, setCanonicalIngredients] = useState(
    initialCanonicalIngredients
  )

  const openForMenuItem = useCallback(
    (m: MenuItemForCatalog) => {
      setSelectedMenuItemName(m.otterItemName)
      setSelectedRecipeId(null)
      if (m.mappedRecipeId) {
        loadExistingRecipe(m.mappedRecipeId, m.otterItemName)
      } else {
        setEditor({
          itemName: m.otterItemName,
          category: m.category,
          servingSize: 1,
          isSellable: true,
          notes: "",
          foodCostOverride: "",
          isConfirmed: false,
          mapOtterItemName: m.otterItemName,
          ingredients: [],
        })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const openForRecipe = useCallback((r: RecipeSummary) => {
    setSelectedMenuItemName(null)
    setSelectedRecipeId(r.id)
    loadExistingRecipe(r.id, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function loadExistingRecipe(
    recipeId: string,
    mapOtterItemName: string | null
  ) {
    setLoadingDetail(async () => {
      const detail = await getRecipeDetail(recipeId)
      if (!detail) return
      const { recipe } = detail
      const rows: EditorIngredientRow[] = recipe.ingredients.map((ing) => ({
        id: ing.id,
        picker: ing.componentRecipeId
          ? {
              kind: "recipe",
              componentRecipeId: ing.componentRecipeId,
              label: ing.componentRecipe?.itemName ?? ing.ingredientName ?? "",
            }
          : ing.canonicalIngredientId
            ? {
                kind: "ingredient",
                canonicalIngredientId: ing.canonicalIngredientId,
                label: ing.canonicalIngredient?.name ?? ing.ingredientName ?? "",
                defaultUnit: ing.canonicalIngredient?.defaultUnit ?? ing.unit,
              }
            : null,
        quantity: String(ing.quantity),
        unit: ing.unit,
        notes: ing.notes ?? "",
      }))
      setEditor({
        recipeId: recipe.id,
        itemName: recipe.itemName,
        category: recipe.category,
        servingSize: recipe.servingSize,
        isSellable: recipe.isSellable,
        notes: recipe.notes ?? "",
        foodCostOverride:
          recipe.foodCostOverride != null ? String(recipe.foodCostOverride) : "",
        isConfirmed: recipe.isConfirmed,
        mapOtterItemName: mapOtterItemName ?? undefined,
        ingredients: rows,
      })
    })
  }

  function startNewPrepRecipe() {
    setSelectedMenuItemName(null)
    setSelectedRecipeId(null)
    setEditor({
      itemName: "",
      category: "Prep",
      servingSize: 1,
      isSellable: false,
      notes: "",
      foodCostOverride: "",
      isConfirmed: false,
      ingredients: [],
    })
  }

  function handleSaved() {
    setEditor(null)
    setSelectedMenuItemName(null)
    setSelectedRecipeId(null)
    router.refresh()
  }

  function handleCancel() {
    setEditor(null)
  }

  function handleSeed() {
    setSeedMessage(null)
    startSeedTransition(async () => {
      try {
        const result = await runCanonicalIngredientSeed()
        setSeedMessage(
          `Created ${result.canonicalsCreated} ingredients, ${result.aliasesCreated} aliases (${result.skipped} already mapped).`
        )
        router.refresh()
      } catch (err) {
        setSeedMessage(err instanceof Error ? err.message : "Seed failed")
      }
    })
  }

  function handleCreateIngredient() {
    if (!newIngName.trim() || !newIngUnit.trim()) return
    startCreateTransition(async () => {
      try {
        const created = await createCanonicalIngredient({
          name: newIngName.trim(),
          defaultUnit: newIngUnit.trim(),
          category: newIngCategory.trim() || null,
        })
        setCanonicalIngredients((prev) =>
          [
            ...prev,
            {
              id: created.id,
              name: created.name,
              defaultUnit: created.defaultUnit,
              category: created.category,
              aliasCount: 0,
              latestUnitCost: null,
              latestUnit: null,
              latestPriceAt: null,
            },
          ].sort((a, b) => a.name.localeCompare(b.name))
        )
        setNewIngName("")
        setNewIngUnit("")
        setNewIngCategory("")
        setCreateDialogOpen(false)
      } catch {
        // Silently swallow; dialog stays open so user can retry or fix the name.
      }
    })
  }

  useEffect(() => {
    // Reset seed message after 6s
    if (!seedMessage) return
    const t = setTimeout(() => setSeedMessage(null), 6000)
    return () => clearTimeout(t)
  }, [seedMessage])

  return (
    <>
      <EditorialTopbar
        section="§ 10"
        title="Recipes"
        stamps={
          <span>
            {initialRecipes.length} recipe{initialRecipes.length !== 1 ? "s" : ""}
          </span>
        }
      >
        {seedMessage && (
          <span className="text-xs text-muted-foreground">{seedMessage}</span>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={handleSeed}
          disabled={seedPending}
          className="h-8"
        >
          <Sparkles className="mr-1 h-3.5 w-3.5" />
          {seedPending ? "Seeding…" : "Seed from invoices"}
        </Button>
      </EditorialTopbar>

      <div className="grid h-[calc(100vh-3.5rem)] grid-cols-[340px_1fr] overflow-hidden">
        <MenuItemList
          menuItems={initialMenuItems}
          recipes={initialRecipes}
          filter={filter}
          onFilterChange={setFilter}
          selectedMenuItemName={selectedMenuItemName}
          selectedRecipeId={selectedRecipeId}
          onSelectMenuItem={openForMenuItem}
          onSelectRecipe={openForRecipe}
          onAddPrepRecipe={startNewPrepRecipe}
        />
        {editor ? (
          <RecipeEditor
            key={editor.recipeId ?? editor.itemName + editor.mapOtterItemName}
            initial={editor}
            canonicalIngredients={canonicalIngredients}
            recipes={initialRecipes}
            onSaved={handleSaved}
            onCancel={handleCancel}
            onRequestCreateIngredient={() => setCreateDialogOpen(true)}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-muted/20 text-sm text-muted-foreground">
            {loadingDetail
              ? "Loading…"
              : "Pick a menu item on the left to start a recipe."}
          </div>
        )}
      </div>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add an ingredient</DialogTitle>
            <DialogDescription>
              Creates a canonical ingredient that isn&apos;t on any invoice yet
              (e.g. salt, house spice mix). You can attach it to invoice line
              items later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="newName">Name</Label>
              <Input
                id="newName"
                value={newIngName}
                onChange={(e) => setNewIngName(e.target.value)}
                placeholder="kosher salt"
              />
            </div>
            <div>
              <Label htmlFor="newUnit">Default unit</Label>
              <Input
                id="newUnit"
                value={newIngUnit}
                onChange={(e) => setNewIngUnit(e.target.value)}
                placeholder="oz"
              />
            </div>
            <div>
              <Label htmlFor="newCategory">Category (optional)</Label>
              <Input
                id="newCategory"
                value={newIngCategory}
                onChange={(e) => setNewIngCategory(e.target.value)}
                placeholder="spice"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCreateDialogOpen(false)}
              disabled={createPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateIngredient}
              disabled={
                createPending || !newIngName.trim() || !newIngUnit.trim()
              }
            >
              {createPending ? "Adding…" : "Add ingredient"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
