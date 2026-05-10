"use client"

import { useMemo, useRef, type RefObject } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Plus, CircleCheck, CircleDashed, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import type { MenuItemForCatalog, RecipeSummary } from "@/types/recipe"
import type { RecipeCandidate } from "@/app/actions/forecasts/recipe-suggestion-actions"
import { LinkRecipePopover } from "./link-recipe-popover"

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
  /**
   * Top-3 ML candidates per Otter item name (lowercased). When a row has at
   * least one high/medium-confidence candidate, the row gains an inline
   * `Confirm` pill that calls `onConfirmMapping` directly — no canvas
   * detour. Missing/low candidates render as "build a recipe" instead.
   */
  suggestionsByItem?: Map<string, RecipeCandidate[]>
  onConfirmMapping?: (otterItemName: string, recipeId: string) => void
  /**
   * Item name currently being confirmed (single-shot or popover-pick).
   * Used to disable the row's actions and signal the in-flight write.
   */
  confirmingItem?: string | null
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
  suggestionsByItem,
  onConfirmMapping,
  confirmingItem,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
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

  const chips: Array<{ id: Filter; label: string; count: number }> = [
    { id: "unbuilt", label: "Unbuilt", count: unbuilt.length },
    { id: "all", label: "All", count: menuItems.length },
    { id: "prep", label: "Prep", count: prepRecipes.length },
    { id: "confirmed", label: "Done", count: confirmed.length },
  ]

  return (
    <div className="flex h-full flex-col overflow-hidden border-r border-[var(--hairline)] bg-[var(--paper)]">
      <div className="border-b border-[var(--hairline)] px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="editorial-section-label">§ menu</div>
          <button
            type="button"
            onClick={onAddPrepRecipe}
            className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-muted)] hover:text-[var(--accent)]"
          >
            <Plus className="h-3 w-3" />
            Prep
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          {chips.map((c) => {
            const active = filter === c.id
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onFilterChange(c.id)}
                className={cn(
                  "border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] transition",
                  active
                    ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
                    : "border-[var(--hairline-bold)] text-[var(--ink-muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
                )}
              >
                {c.label}
                <span
                  className={cn(
                    "ml-1.5 tabular-nums",
                    active ? "text-[var(--paper)]/70" : "text-[var(--ink-faint)]"
                  )}
                >
                  {c.count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div ref={scrollRef} data-perf-scroll className="flex-1 overflow-y-auto">
        {filter === "prep" ? (
          <RecipeList
            recipes={prepRecipes}
            scrollRef={scrollRef}
            selectedId={selectedRecipeId}
            onSelect={onSelectRecipe}
            emptyLabel="No prep recipes yet."
          />
        ) : filter === "confirmed" ? (
          <RecipeList
            recipes={confirmed}
            scrollRef={scrollRef}
            selectedId={selectedRecipeId}
            onSelect={onSelectRecipe}
            emptyLabel="No confirmed recipes yet."
          />
        ) : (
          <MenuItemRows
            items={filter === "unbuilt" ? unbuilt : menuItems}
            scrollRef={scrollRef}
            selectedItemName={selectedMenuItemName}
            onSelect={onSelectMenuItem}
            recipes={sellableRecipes}
            suggestionsByItem={suggestionsByItem}
            onConfirmMapping={onConfirmMapping}
            confirmingItem={confirmingItem}
            emptyLabel={
              filter === "unbuilt"
                ? "Every menu item has a recipe."
                : "No menu items yet. Sync Otter first."
            }
          />
        )}
      </div>
    </div>
  )
}

function MenuItemRows({
  items,
  scrollRef,
  selectedItemName,
  onSelect,
  recipes,
  suggestionsByItem,
  onConfirmMapping,
  confirmingItem,
  emptyLabel,
}: {
  items: MenuItemForCatalog[]
  scrollRef: RefObject<HTMLDivElement | null>
  selectedItemName: string | null
  onSelect: (m: MenuItemForCatalog) => void
  recipes: RecipeSummary[]
  suggestionsByItem?: Map<string, RecipeCandidate[]>
  onConfirmMapping?: (otterItemName: string, recipeId: string) => void
  confirmingItem?: string | null
  emptyLabel: string
}) {
  // Unbuilt rows grow taller (extra ML caption line + actions row), so we
  // bump the virtualizer estimate when the suggestion pipeline is wired in.
  // Falls back to the stock 58px when the parent didn't pass suggestions.
  const estimate = suggestionsByItem ? 78 : 58
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimate,
    overscan: 10,
  })

  if (items.length === 0) {
    return (
      <div className="px-4 py-10 text-center font-mono text-[11px] italic text-[var(--ink-faint)]">
        {emptyLabel}
      </div>
    )
  }
  return (
    <ul className="relative" style={{ height: rowVirtualizer.getTotalSize() }}>
      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
        const m = items[virtualRow.index]
        const isSelected = selectedItemName === m.otterItemName
        const hasRecipe = !!m.mappedRecipeId
        const candidates =
          suggestionsByItem?.get(m.otterItemName.toLowerCase()) ?? []
        const top = candidates[0]
        const isConfirming = confirmingItem === m.otterItemName
        const showSuggestionRow =
          !hasRecipe && (suggestionsByItem !== undefined || candidates.length > 0)
        const canConfirm =
          !hasRecipe &&
          !!top &&
          (top.confidence === "high" || top.confidence === "medium") &&
          !!onConfirmMapping
        return (
          <li
            key={`${m.otterItemName}::${m.category}`}
            ref={rowVirtualizer.measureElement}
            data-index={virtualRow.index}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            <div
              className={cn(
                "group relative flex w-full items-start gap-2.5 border-b border-[var(--hairline)] px-4 py-2.5 text-left transition",
                isSelected
                  ? "bg-[var(--paper-deep)]"
                  : "hover:bg-[var(--paper-deep)]/60"
              )}
            >
              {isSelected && (
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-[2px] bg-[var(--accent)]"
                />
              )}
              <button
                type="button"
                onClick={() => onSelect(m)}
                className="absolute inset-0"
                aria-label={
                  hasRecipe
                    ? `Open recipe for ${m.otterItemName}`
                    : `Build recipe for ${m.otterItemName}`
                }
              />
              <div className="pointer-events-none relative mt-1 shrink-0">
                {hasRecipe ? (
                  <CircleCheck className="h-3.5 w-3.5 text-[var(--accent)]" />
                ) : (
                  <CircleDashed className="h-3.5 w-3.5 text-[var(--ink-faint)]" />
                )}
              </div>
              <div className="pointer-events-none relative flex-1 overflow-hidden">
                <div className="truncate font-display text-[14px] leading-snug text-[var(--ink)]">
                  {m.otterItemName}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--ink-faint)]">
                  <span>{m.category}</span>
                  <span>·</span>
                  <span className="tabular-nums">
                    {Math.round(m.totalQtySoldAllTime).toLocaleString()} sold
                  </span>
                </div>
                {showSuggestionRow && (
                  <SuggestionCaption candidate={top} />
                )}
              </div>
              {!hasRecipe && (
                <div className="relative flex shrink-0 items-center gap-1">
                  {canConfirm && top && (
                    <button
                      type="button"
                      disabled={isConfirming}
                      onClick={(e) => {
                        e.stopPropagation()
                        onConfirmMapping?.(m.otterItemName, top.recipeId)
                      }}
                      className={cn(
                        "inline-flex h-7 items-center gap-1 border px-2 font-mono text-[10px] uppercase tracking-[0.1em] transition",
                        top.confidence === "high"
                          ? "border-[var(--accent)] bg-[var(--paper)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-[var(--paper)]"
                          : "border-[var(--ink)] bg-[var(--paper)] text-[var(--ink)] hover:bg-[var(--ink)] hover:text-[var(--paper)]",
                        isConfirming && "opacity-50"
                      )}
                    >
                      {isConfirming ? "…" : "Confirm"}
                    </button>
                  )}
                  {onConfirmMapping && (
                    <LinkRecipePopover
                      otterItemName={m.otterItemName}
                      candidates={candidates}
                      recipes={recipes}
                      onPick={(recipeId) =>
                        onConfirmMapping(m.otterItemName, recipeId)
                      }
                      onBuildNew={() => onSelect(m)}
                    />
                  )}
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function SuggestionCaption({
  candidate,
}: {
  candidate: RecipeCandidate | undefined
}) {
  if (!candidate) {
    return (
      <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--ink-faint)]">
        No close match — build a recipe
      </div>
    )
  }
  const { confidence, recipeName, similarity } = candidate
  const tone =
    confidence === "high"
      ? "text-[var(--accent)]"
      : confidence === "medium"
        ? "text-[var(--ink)]"
        : "text-[var(--ink-muted)]"
  const label =
    confidence === "low" ? "Best guess" : "ML proposes"
  return (
    <div
      className={cn(
        "mt-1 flex items-center gap-1 truncate font-mono text-[10px] uppercase tracking-[0.08em]",
        tone
      )}
    >
      <Sparkles className="h-3 w-3 shrink-0" />
      <span className="truncate">
        {label}: <span className="italic">{recipeName}</span> ·{" "}
        <span className="tabular-nums">
          {Math.round(similarity * 100)}%
        </span>
      </span>
    </div>
  )
}

function RecipeList({
  recipes,
  scrollRef,
  selectedId,
  onSelect,
  emptyLabel,
}: {
  recipes: RecipeSummary[]
  scrollRef: RefObject<HTMLDivElement | null>
  selectedId: string | null
  onSelect: (r: RecipeSummary) => void
  emptyLabel: string
}) {
  const rowVirtualizer = useVirtualizer({
    count: recipes.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 58,
    overscan: 10,
  })

  if (recipes.length === 0) {
    return (
      <div className="px-4 py-10 text-center font-mono text-[11px] italic text-[var(--ink-faint)]">
        {emptyLabel}
      </div>
    )
  }
  return (
    <ul className="relative" style={{ height: rowVirtualizer.getTotalSize() }}>
      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
        const r = recipes[virtualRow.index]
        const isSelected = selectedId === r.id
        return (
          <li
            key={r.id}
            ref={rowVirtualizer.measureElement}
            data-index={virtualRow.index}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            <button
              type="button"
              onClick={() => onSelect(r)}
              className={cn(
                "group relative flex w-full items-start gap-2.5 border-b border-[var(--hairline)] px-4 py-2.5 text-left transition",
                isSelected
                  ? "bg-[var(--paper-deep)]"
                  : "hover:bg-[var(--paper-deep)]/60"
              )}
            >
              {isSelected && (
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-[2px] bg-[var(--accent)]"
                />
              )}
              <div className="mt-1 shrink-0">
                <CircleCheck className="h-3.5 w-3.5 text-[var(--accent)]" />
              </div>
              <div className="flex-1 overflow-hidden">
                <div className="flex items-baseline gap-1.5">
                  <span className="truncate font-display text-[14px] italic leading-snug text-[var(--ink)]">
                    {r.itemName}
                  </span>
                  {!r.isSellable && (
                    <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
                      prep
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--ink-faint)]">
                  <span>{r.category}</span>
                  <span>·</span>
                  <span className="tabular-nums">
                    {r.ingredientCount} ing
                  </span>
                  {r.computedCost != null && (
                    <>
                      <span>·</span>
                      <span className="tabular-nums">
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
