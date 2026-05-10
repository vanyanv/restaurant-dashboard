"use client"

import { useCallback, useEffect, useMemo, useState, useTransition, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { ChevronDown, Sparkles } from "lucide-react"
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { EditorialTopbar } from "../../components/editorial-topbar"
import { MenuItemList } from "./menu-item-list"
import type { CanvasInitialValue } from "./recipe-canvas"
import {
  mapOtterItemToRecipe,
  mapOtterItemsBatch,
} from "@/app/actions/menu-item-actions"
import type { RecipeCandidate } from "@/app/actions/forecasts/recipe-suggestion-actions"

// `RecipeCanvas` pulls in @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/modifiers,
// and a chunk of recipe-editor logic. The canvas only renders once the user
// picks an item to edit, so defer the bundle until then.
const RecipeCanvas = dynamic(
  () => import("./recipe-canvas").then((m) => ({ default: m.RecipeCanvas })),
  { ssr: false },
)
import type { IngredientRowData } from "./sortable-ingredient-row"
import { getRecipeDetail } from "@/app/actions/recipe-actions"
import {
  createCanonicalIngredient,
  listCanonicalIngredients,
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
  /**
   * Rendered inside the editorial topbar's stamps/actions area. Used by the
   * Suspense shell to stream the unmatched-line-items count badge independently
   * so the editor UI never waits on that invoice scan.
   */
  unmatchedCountSlot?: ReactNode
  /**
   * Seed value for the menu-list filter chip. The `?filter=unbuilt` deep-link
   * from the P&L unmapped banner lands here; an undefined value falls back to
   * the default ("unbuilt"), so the existing landing behavior is unchanged.
   */
  initialFilter?: Filter
  /**
   * Top-3 F28 candidates per Otter item name (lowercased). Empty/missing
   * entries render as "no close match — build a recipe" on the row.
   */
  suggestionsByItem?: Map<string, RecipeCandidate[]>
}

type Filter = "unbuilt" | "all" | "prep" | "confirmed"

export function RecipesContent({
  initialMenuItems,
  initialRecipes,
  initialCanonicalIngredients,
  unmatchedCountSlot,
  initialFilter,
  suggestionsByItem,
}: Props) {
  const router = useRouter()
  const [filter, setFilter] = useState<Filter>(initialFilter ?? "unbuilt")
  const suggestions = suggestionsByItem ?? new Map<string, RecipeCandidate[]>()
  const [confirmingItem, setConfirmingItem] = useState<string | null>(null)
  const [, startConfirmTransition] = useTransition()
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchPending, startBatchTransition] = useTransition()
  const [batchError, setBatchError] = useState<string | null>(null)

  /**
   * Build the high-confidence batch preview lazily — reads ML's top suggestion
   * for every unbuilt menu item and keeps only those at ≥0.75 similarity.
   * Recompute when either input changes (e.g., after a confirm refreshes the
   * server data).
   */
  const highConfidencePairs = useMemo(() => {
    const pairs: Array<{
      otterItemName: string
      recipeId: string
      recipeName: string
      similarity: number
    }> = []
    for (const m of initialMenuItems) {
      if (m.mappedRecipeId) continue
      const candidates = suggestions.get(m.otterItemName.toLowerCase())
      const top = candidates?.[0]
      if (!top || top.confidence !== "high") continue
      pairs.push({
        otterItemName: m.otterItemName,
        recipeId: top.recipeId,
        recipeName: top.recipeName,
        similarity: top.similarity,
      })
    }
    return pairs
  }, [initialMenuItems, suggestions])

  const confirmMapping = useCallback(
    (otterItemName: string, recipeId: string) => {
      setConfirmingItem(otterItemName)
      startConfirmTransition(async () => {
        try {
          await mapOtterItemToRecipe({ otterItemName, recipeId })
          router.refresh()
        } finally {
          setConfirmingItem(null)
        }
      })
    },
    [router]
  )

  const runBatchConfirm = useCallback(() => {
    setBatchError(null)
    startBatchTransition(async () => {
      try {
        await mapOtterItemsBatch(
          highConfidencePairs.map(({ otterItemName, recipeId }) => ({
            otterItemName,
            recipeId,
          }))
        )
        setBatchOpen(false)
        router.refresh()
      } catch (err) {
        setBatchError(
          err instanceof Error ? err.message : "Batch confirm failed"
        )
      }
    })
  }, [highConfidencePairs, router])
  const [editor, setEditor] = useState<CanvasInitialValue | null>(null)
  const [selectedMenuItemName, setSelectedMenuItemName] = useState<string | null>(
    null
  )
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null)
  const [, setLoadingDetail] = useTransition()
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
  const [isPhone, setIsPhone] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)")
    const sync = () => setIsPhone(mq.matches)
    sync()
    mq.addEventListener("change", sync)
    return () => mq.removeEventListener("change", sync)
  }, [])

  async function refreshCanonicals() {
    const next = await listCanonicalIngredients()
    setCanonicalIngredients(next)
  }

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
      const rows: IngredientRowData[] = recipe.ingredients.map((ing) => ({
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
          `Created ${result.canonicalsCreated} ingredients, ${result.skuMatchesCreated} SKU matches, ${result.aliasesCreated} aliases (${result.skipped} skipped).`
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
              recipeUnit: created.recipeUnit,
              costPerRecipeUnit: created.costPerRecipeUnit,
              costSource: (created.costSource as "manual" | "invoice" | null) ?? null,
              costLocked: created.costLocked,
              costUpdatedAt: created.costUpdatedAt,
              latestUnitCost: null,
              latestUnit: null,
              latestPriceAt: null,
              latestVendor: null,
              latestSku: null,
              trend30d: null,
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
    if (!seedMessage) return
    const t = setTimeout(() => setSeedMessage(null), 6000)
    return () => clearTimeout(t)
  }, [seedMessage])

  return (
    <div className="editorial-surface relative flex min-h-[calc(100vh-3.5rem)] flex-col">
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
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-muted)] lg:inline">
            {seedMessage}
          </span>
        )}
        {unmatchedCountSlot}
        {highConfidencePairs.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setBatchOpen(true)}
            className="h-8 border-[var(--hairline-bold)] bg-[var(--paper)] text-[var(--accent)]"
          >
            <Sparkles className="mr-1 h-3.5 w-3.5" />
            Confirm {highConfidencePairs.length} ML match
            {highConfidencePairs.length === 1 ? "" : "es"}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={handleSeed}
          disabled={seedPending}
          className="h-8 border-[var(--hairline-bold)] bg-[var(--paper)]"
        >
          <Sparkles className="mr-1 h-3.5 w-3.5" />
          {seedPending ? "Seeding…" : "Seed from invoices"}
        </Button>
      </EditorialTopbar>

      <div
        className={cn(
          "h-[calc(100vh-3.5rem)] overflow-hidden",
          isPhone ? "flex flex-col" : "grid grid-cols-[280px_1fr]"
        )}
      >
        {!isPhone && (
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
            suggestionsByItem={suggestions}
            onConfirmMapping={confirmMapping}
            confirmingItem={confirmingItem}
          />
        )}

        {isPhone && (
          <div className="flex items-center justify-between gap-2 border-b border-[var(--hairline)] bg-[var(--paper)] px-3 py-2">
            <Sheet open={pickerOpen} onOpenChange={setPickerOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 flex-1 justify-between border-[var(--hairline-bold)] bg-[var(--paper)] font-mono text-[11px] uppercase tracking-[0.12em]"
                >
                  <span className="truncate text-left">
                    {selectedMenuItemName ??
                      (selectedRecipeId
                        ? initialRecipes.find((r) => r.id === selectedRecipeId)?.itemName ?? "Recipe"
                        : "Pick a recipe")}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-full max-w-[min(420px,100vw)] border-r border-[#c9beaf] bg-[#fbf6ee] p-0"
                style={{
                  ["--ink" as string]: "#1a1613",
                  ["--ink-muted" as string]: "#6b625a",
                  ["--ink-faint" as string]: "#a69d92",
                  ["--paper" as string]: "#fbf6ee",
                  ["--paper-deep" as string]: "#f4ecdf",
                  ["--hairline" as string]: "#e8dfd3",
                  ["--hairline-bold" as string]: "#c9beaf",
                  ["--accent" as string]: "#dc2626",
                }}
              >
                <SheetHeader className="sr-only">
                  <SheetTitle>Recipes &amp; menu items</SheetTitle>
                </SheetHeader>
                <MenuItemList
                  menuItems={initialMenuItems}
                  recipes={initialRecipes}
                  filter={filter}
                  onFilterChange={setFilter}
                  selectedMenuItemName={selectedMenuItemName}
                  selectedRecipeId={selectedRecipeId}
                  onSelectMenuItem={(m) => {
                    openForMenuItem(m)
                    setPickerOpen(false)
                  }}
                  onSelectRecipe={(r) => {
                    openForRecipe(r)
                    setPickerOpen(false)
                  }}
                  onAddPrepRecipe={() => {
                    startNewPrepRecipe()
                    setPickerOpen(false)
                  }}
                  suggestionsByItem={suggestions}
                  onConfirmMapping={confirmMapping}
                  confirmingItem={confirmingItem}
                />
              </SheetContent>
            </Sheet>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          {editor ? (
            <RecipeCanvas
              key={editor.recipeId ?? editor.itemName + (editor.mapOtterItemName ?? "")}
              initial={editor}
              canonicalIngredients={canonicalIngredients}
              recipes={initialRecipes}
              onSaved={handleSaved}
              onCancel={handleCancel}
              onRequestCreateIngredient={() => setCreateDialogOpen(true)}
              onCanonicalCreated={refreshCanonicals}
            />
          ) : (
            <EmptyState isPhone={isPhone} />
          )}
        </div>
      </div>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="border-[var(--hairline-bold)] bg-[var(--paper)]">
          <DialogHeader>
            <DialogTitle className="font-display text-[22px] italic">
              Add an ingredient
            </DialogTitle>
            <DialogDescription className="text-[var(--ink-muted)]">
              Creates a canonical ingredient that isn&apos;t on any invoice yet
              (e.g. salt, house spice mix). You can link it to invoice line
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
              className="bg-[var(--ink)] text-[var(--paper)] hover:bg-[var(--accent-dark)]"
            >
              {createPending ? "Adding…" : "Add ingredient"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent className="max-w-lg border-[var(--hairline-bold)] bg-[var(--paper)]">
          <DialogHeader>
            <DialogTitle className="font-display text-[22px] italic">
              Confirm {highConfidencePairs.length} ML match
              {highConfidencePairs.length === 1 ? "" : "es"}
            </DialogTitle>
            <DialogDescription className="text-[var(--ink-muted)]">
              These POS items will be linked to the proposed recipes. Audit the
              full list before confirming — at least one of these is probably
              wrong if recipes share words.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-[320px] overflow-y-auto border-y border-[var(--hairline)]">
            {highConfidencePairs.map((p) => (
              <li
                key={p.otterItemName}
                className="flex items-baseline justify-between gap-3 border-b border-[var(--hairline)] px-1 py-2 last:border-b-0"
              >
                <span className="truncate font-display text-[14px] text-[var(--ink)]">
                  {p.otterItemName}
                </span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--ink-muted)]">
                  →
                </span>
                <span className="flex-1 truncate font-display text-[14px] italic text-[var(--ink)]">
                  {p.recipeName}
                </span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--accent)]">
                  {Math.round(p.similarity * 100)}%
                </span>
              </li>
            ))}
          </ul>
          {batchError && (
            <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--accent)]">
              {batchError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setBatchOpen(false)}
              disabled={batchPending}
            >
              Cancel
            </Button>
            <Button
              onClick={runBatchConfirm}
              disabled={batchPending || highConfidencePairs.length === 0}
              className="bg-[var(--ink)] text-[var(--paper)] hover:bg-[var(--accent-dark)]"
            >
              {batchPending
                ? "Confirming…"
                : `Confirm ${highConfidencePairs.length}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function EmptyState({ isPhone = false }: { isPhone?: boolean }) {
  return (
    <div className="flex h-full items-center justify-center bg-[var(--paper)]">
      <div className="mx-10 max-w-md text-center">
        <div className="editorial-section-label">§ canvas</div>
        <h2 className="mt-2 font-display text-[34px] italic leading-tight text-[var(--ink)]">
          Pick a dish
          <br />
          to begin.
        </h2>
        <p className="mt-4 font-mono text-[11px] uppercase leading-relaxed tracking-[0.12em] text-[var(--ink-muted)]">
          {isPhone
            ? "Tap “Pick a recipe” above."
            : "Select a menu item or recipe on the left."}
          <br />
          Or start a new prep component.
        </p>
      </div>
    </div>
  )
}
