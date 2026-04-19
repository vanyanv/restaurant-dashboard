"use client"

import { useEffect, useState, useTransition } from "react"
import { Check, ChevronsUpDown, Plus, Package, BookOpen, Receipt } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { CanonicalIngredientSummary, RecipeSummary } from "@/types/recipe"
import {
  searchUnmatchedLineItems,
  confirmSkuMatch,
  type UnmatchedLineItemHit,
} from "@/app/actions/ingredient-match-actions"

export type IngredientPickerValue =
  | {
      kind: "ingredient"
      canonicalIngredientId: string
      label: string
      defaultUnit: string
    }
  | { kind: "recipe"; componentRecipeId: string; label: string }
  | null

type Props = {
  value: IngredientPickerValue
  canonicalIngredients: CanonicalIngredientSummary[]
  recipes: RecipeSummary[]
  excludeRecipeIds?: string[]
  onChange: (v: IngredientPickerValue) => void
  /**
   * Called after a raw invoice line is matched in-flow, so the parent can
   * refresh the canonical ingredients list to include the new entry.
   */
  onCanonicalCreated?: () => void
  onCreateIngredient?: () => void
}

export function IngredientCommand({
  value,
  canonicalIngredients,
  recipes,
  excludeRecipeIds = [],
  onChange,
  onCanonicalCreated,
  onCreateIngredient,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [rawHits, setRawHits] = useState<UnmatchedLineItemHit[]>([])
  const [isSearching, startSearch] = useTransition()
  const [linking, setLinking] = useState<string | null>(null)

  const excluded = new Set(excludeRecipeIds)

  const label =
    value?.kind === "ingredient"
      ? value.label
      : value?.kind === "recipe"
        ? value.label
        : "Pick ingredient or sub-recipe…"

  const pickerIcon =
    value?.kind === "ingredient" ? (
      <Package className="mr-2 h-3.5 w-3.5 text-[var(--ink-faint)]" />
    ) : value?.kind === "recipe" ? (
      <BookOpen className="mr-2 h-3.5 w-3.5 italic text-[var(--accent)]" />
    ) : null

  // Debounce raw-invoice search.
  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setRawHits([])
      return
    }
    const q = query
    const t = setTimeout(() => {
      startSearch(async () => {
        const hits = await searchUnmatchedLineItems(q, 8)
        setRawHits(hits)
      })
    }, 180)
    return () => clearTimeout(t)
  }, [query, open])

  async function handleMatchRaw(hit: UnmatchedLineItemHit) {
    setLinking(hit.lineItemId)
    try {
      // If there's an exact-name canonical already, link to it; otherwise create new.
      const existing = canonicalIngredients.find(
        (c) => c.name.toLowerCase() === hit.productName.toLowerCase()
      )
      const result = await confirmSkuMatch(
        existing
          ? {
              lineItemId: hit.lineItemId,
              canonicalIngredientId: existing.id,
            }
          : {
              lineItemId: hit.lineItemId,
              newCanonical: {
                name: hit.productName,
                defaultUnit: hit.unit ?? "unit",
              },
            }
      )
      onChange({
        kind: "ingredient",
        canonicalIngredientId: result.canonicalIngredientId,
        label: existing?.name ?? hit.productName,
        defaultUnit: hit.unit ?? "unit",
      })
      setOpen(false)
      setQuery("")
      onCanonicalCreated?.()
    } finally {
      setLinking(null)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-9 w-full justify-between border-[var(--hairline-bold)] bg-transparent font-normal hover:bg-[var(--paper-deep)]",
            !value && "text-[var(--ink-faint)]"
          )}
        >
          <span className="flex min-w-0 items-center">
            {pickerIcon}
            <span className="truncate">{label}</span>
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[420px] border-[var(--hairline-bold)] bg-[var(--paper)] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search ingredients, recipes, or invoice lines…"
          />
          <CommandList className="max-h-[360px]">
            <CommandEmpty>
              {isSearching ? "Searching…" : "No matches."}
            </CommandEmpty>

            <CommandGroup
              heading={
                <GroupHeading
                  icon={<Package className="h-3 w-3" />}
                  label="My ingredients"
                />
              }
            >
              {filterList(canonicalIngredients, query, (c) => c.name).map((ci) => {
                const isSelected =
                  value?.kind === "ingredient" &&
                  value.canonicalIngredientId === ci.id
                return (
                  <CommandItem
                    key={`ing-${ci.id}`}
                    value={`ingredient ${ci.name}`}
                    onSelect={() => {
                      onChange({
                        kind: "ingredient",
                        canonicalIngredientId: ci.id,
                        label: ci.name,
                        defaultUnit: ci.defaultUnit,
                      })
                      setOpen(false)
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-3.5 w-3.5",
                        isSelected ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex-1 truncate">{ci.name}</div>
                    {ci.latestUnitCost != null && (
                      <span className="ml-2 font-mono text-[10px] tabular-nums text-[var(--ink-muted)]">
                        ${ci.latestUnitCost.toFixed(2)}/{ci.latestUnit}
                      </span>
                    )}
                  </CommandItem>
                )
              })}
            </CommandGroup>

            {recipes.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup
                  heading={
                    <GroupHeading
                      icon={<BookOpen className="h-3 w-3" />}
                      label="Sub-recipes"
                    />
                  }
                >
                  {filterList(
                    recipes.filter((r) => !excluded.has(r.id)),
                    query,
                    (r) => r.itemName
                  ).map((r) => {
                    const isSelected =
                      value?.kind === "recipe" &&
                      value.componentRecipeId === r.id
                    return (
                      <CommandItem
                        key={`rec-${r.id}`}
                        value={`recipe ${r.itemName}`}
                        onSelect={() => {
                          onChange({
                            kind: "recipe",
                            componentRecipeId: r.id,
                            label: r.itemName,
                          })
                          setOpen(false)
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-3.5 w-3.5",
                            isSelected ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <span className="flex-1 truncate italic">
                          {r.itemName}
                          {!r.isSellable && (
                            <span className="ml-1 not-italic text-[var(--ink-faint)]">
                              · prep
                            </span>
                          )}
                        </span>
                        {r.computedCost != null && (
                          <span className="ml-2 font-mono text-[10px] tabular-nums text-[var(--ink-muted)]">
                            ${r.computedCost.toFixed(2)}
                            {r.partialCost ? "*" : ""}
                          </span>
                        )}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              </>
            )}

            {rawHits.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup
                  heading={
                    <GroupHeading
                      icon={<Receipt className="h-3 w-3" />}
                      label="From invoices · unmatched"
                    />
                  }
                >
                  {rawHits.map((hit) => (
                    <CommandItem
                      key={`raw-${hit.lineItemId}`}
                      value={`raw ${hit.productName} ${hit.vendorName}`}
                      onSelect={() => handleMatchRaw(hit)}
                      disabled={linking === hit.lineItemId}
                    >
                      <Plus className="mr-2 h-3.5 w-3.5 text-[var(--accent)]" />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{hit.productName}</span>
                        <span className="truncate font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--ink-faint)]">
                          {hit.vendorName}
                          {hit.sku ? ` · SKU ${hit.sku}` : ""}
                          {" · "}
                          {hit.occurrences}×
                        </span>
                      </div>
                      <span className="ml-2 font-mono text-[10px] tabular-nums text-[var(--ink-muted)]">
                        ${hit.latestUnitPrice.toFixed(2)}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {onCreateIngredient && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value="__create-ingredient"
                    onSelect={() => {
                      setOpen(false)
                      onCreateIngredient()
                    }}
                  >
                    <Plus className="mr-2 h-3.5 w-3.5" />
                    Add a new canonical ingredient
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function GroupHeading({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
      {icon}
      {label}
    </span>
  )
}

function filterList<T>(items: T[], query: string, key: (t: T) => string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((i) => key(i).toLowerCase().includes(q))
}
