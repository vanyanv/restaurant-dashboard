"use client"

import { useMemo } from "react"
import { Plus, CircleCheck, CircleDashed } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type { MenuItemForCatalog, RecipeSummary } from "@/types/recipe"

type Filter = "unbuilt" | "all" | "prep" | "confirmed"

type Props = {
  menuItems: MenuItemForCatalog[]
  recipes: RecipeSummary[]
  filter: Filter
  onFilterChange: (f: Filter) => void
  selectedMenuItemName: string | null
  selectedRecipeId: string | null
  onSelectMenuItem: (m: MenuItemForCatalog) => void
  onSelectRecipe: (r: RecipeSummary) => void
  onAddPrepRecipe: () => void
}

export function MenuItemList({
  menuItems,
  recipes,
  filter,
  onFilterChange,
  selectedMenuItemName,
  selectedRecipeId,
  onSelectMenuItem,
  onSelectRecipe,
  onAddPrepRecipe,
}: Props) {
  const prepRecipes = useMemo(
    () => recipes.filter((r) => !r.isSellable),
    [recipes]
  )
  const sellableRecipes = useMemo(
    () => recipes.filter((r) => r.isSellable),
    [recipes]
  )
  const unbuilt = useMemo(
    () => menuItems.filter((m) => !m.mappedRecipeId),
    [menuItems]
  )
  const confirmed = useMemo(
    () => sellableRecipes.filter((r) => r.isConfirmed),
    [sellableRecipes]
  )

  return (
    <div className="flex h-full flex-col border-r bg-background">
      <div className="border-b p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Menu & Recipes</h2>
          <Button
            size="sm"
            variant="outline"
            onClick={onAddPrepRecipe}
            className="h-7"
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Prep recipe
          </Button>
        </div>
        <Tabs
          value={filter}
          onValueChange={(v) => onFilterChange(v as Filter)}
        >
          <TabsList className="grid h-8 w-full grid-cols-4">
            <TabsTrigger value="unbuilt" className="text-xs">
              Unbuilt ({unbuilt.length})
            </TabsTrigger>
            <TabsTrigger value="all" className="text-xs">
              Menu ({menuItems.length})
            </TabsTrigger>
            <TabsTrigger value="prep" className="text-xs">
              Prep ({prepRecipes.length})
            </TabsTrigger>
            <TabsTrigger value="confirmed" className="text-xs">
              Done ({confirmed.length})
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <ScrollArea className="flex-1">
        {filter === "prep" ? (
          <RecipeList
            recipes={prepRecipes}
            selectedId={selectedRecipeId}
            onSelect={onSelectRecipe}
            emptyLabel="No prep recipes yet."
          />
        ) : filter === "confirmed" ? (
          <RecipeList
            recipes={confirmed}
            selectedId={selectedRecipeId}
            onSelect={onSelectRecipe}
            emptyLabel="No confirmed recipes yet."
          />
        ) : (
          <MenuItemRows
            items={filter === "unbuilt" ? unbuilt : menuItems}
            selectedItemName={selectedMenuItemName}
            onSelect={onSelectMenuItem}
            emptyLabel={
              filter === "unbuilt"
                ? "Every menu item has a recipe."
                : "No menu items yet — sync Otter first."
            }
          />
        )}
      </ScrollArea>
    </div>
  )
}

function MenuItemRows({
  items,
  selectedItemName,
  onSelect,
  emptyLabel,
}: {
  items: MenuItemForCatalog[]
  selectedItemName: string | null
  onSelect: (m: MenuItemForCatalog) => void
  emptyLabel: string
}) {
  if (items.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    )
  }
  return (
    <ul className="divide-y">
      {items.map((m) => {
        const isSelected = selectedItemName === m.otterItemName
        const hasRecipe = !!m.mappedRecipeId
        return (
          <li key={`${m.otterItemName}::${m.category}`}>
            <button
              type="button"
              onClick={() => onSelect(m)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40",
                isSelected && "bg-muted"
              )}
            >
              {hasRecipe ? (
                <CircleCheck className="h-4 w-4 shrink-0 text-green-600" />
              ) : (
                <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <div className="flex-1 overflow-hidden">
                <div className="truncate text-sm font-medium">
                  {m.otterItemName}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{m.category}</span>
                  <span>·</span>
                  <span>{Math.round(m.totalQtySoldAllTime).toLocaleString()} sold</span>
                </div>
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function RecipeList({
  recipes,
  selectedId,
  onSelect,
  emptyLabel,
}: {
  recipes: RecipeSummary[]
  selectedId: string | null
  onSelect: (r: RecipeSummary) => void
  emptyLabel: string
}) {
  if (recipes.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    )
  }
  return (
    <ul className="divide-y">
      {recipes.map((r) => {
        const isSelected = selectedId === r.id
        return (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onSelect(r)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40",
                isSelected && "bg-muted"
              )}
            >
              <CircleCheck className="h-4 w-4 shrink-0 text-green-600" />
              <div className="flex-1 overflow-hidden">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{r.itemName}</span>
                  {!r.isSellable && (
                    <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                      prep
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{r.category}</span>
                  <span>·</span>
                  <span>{r.ingredientCount} ingredients</span>
                  {r.computedCost != null && (
                    <>
                      <span>·</span>
                      <span>
                        ${r.computedCost.toFixed(2)}
                        {r.partialCost ? "*" : ""}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
