"use client"

import { useTransition, useState, useCallback, useEffect } from "react"
import { ChefHat } from "lucide-react"
import { getRecipes } from "@/app/actions/product-usage-actions"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EditorialTopbar } from "../../../components/editorial-topbar"
import { DashboardSection } from "@/components/analytics/dashboard-section"
import { RecipeManagerSheet } from "./recipe-manager-sheet"
import type { RecipeWithIngredients } from "@/types/product-usage"

interface RecipesContentProps {
  initialRecipes: RecipeWithIngredients[]
  stores: { id: string; name: string }[]
}

export function RecipesContent({ initialRecipes, stores }: RecipesContentProps) {
  const [recipes, setRecipes] = useState(initialRecipes)
  const [isPending, startTransition] = useTransition()
  const [selectedStore, setSelectedStore] = useState("all")
  const [recipeSheetOpen, setRecipeSheetOpen] = useState(false)

  useEffect(() => {
    setRecipes(initialRecipes)
  }, [initialRecipes])

  const handleStoreChange = useCallback((storeId: string) => {
    setSelectedStore(storeId)
    startTransition(async () => {
      const sid = storeId === "all" ? undefined : storeId
      const fresh = await getRecipes(sid)
      setRecipes(fresh)
    })
  }, [])

  const handleRecipeChange = useCallback(() => {
    const sid = selectedStore === "all" ? undefined : selectedStore
    startTransition(async () => {
      const fresh = await getRecipes(sid)
      setRecipes(fresh)
    })
  }, [selectedStore])

  return (
    <div className="flex flex-col h-full">
      <EditorialTopbar
        section="§ 04"
        title="Recipes"
        stamps={
          <span>
            {recipes.length} recipe{recipes.length !== 1 ? "s" : ""}
          </span>
        }
      >
        {stores.length > 1 && (
          <Select value={selectedStore} onValueChange={handleStoreChange}>
            <SelectTrigger className="h-8 w-[140px] text-sm">
              <SelectValue placeholder="All Stores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stores</SelectItem>
              {stores.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </EditorialTopbar>

      <div className="flex-1 p-4 sm:p-6">
        <DashboardSection title="Recipe Coverage">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {recipes.length} recipes configured
                </p>
                <p className="text-xs text-muted-foreground">
                  Configure recipes to map menu items to their ingredients for
                  usage tracking
                </p>
              </div>
              <Button onClick={() => setRecipeSheetOpen(true)} size="sm">
                <ChefHat className="h-4 w-4 mr-2" />
                Manage Recipes
              </Button>
            </div>

            {recipes.length > 0 ? (
              <div className="space-y-2">
                {recipes.map((recipe) => (
                  <div
                    key={recipe.id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card"
                  >
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="text-sm font-medium">
                          {recipe.itemName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {recipe.ingredients.length} ingredient
                          {recipe.ingredients.length !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{recipe.category}</Badge>
                      {recipe.isConfirmed && (
                        <Badge
                          variant="outline"
                          className="text-emerald-600"
                        >
                          Confirmed
                        </Badge>
                      )}
                      {recipe.isAiGenerated && !recipe.isConfirmed && (
                        <Badge
                          variant="outline"
                          className="text-amber-600"
                        >
                          AI Generated
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No recipes configured yet. Click &quot;Manage Recipes&quot; to
                get started.
              </div>
            )}
          </div>
        </DashboardSection>
      </div>

      <RecipeManagerSheet
        open={recipeSheetOpen}
        onOpenChange={setRecipeSheetOpen}
        recipes={recipes}
        storeId={selectedStore !== "all" ? selectedStore : undefined}
        onRecipeChange={handleRecipeChange}
      />
    </div>
  )
}
