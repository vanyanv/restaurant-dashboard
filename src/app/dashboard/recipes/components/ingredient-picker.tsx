"use client"

import { useState } from "react"
import { Check, ChevronsUpDown, Plus } from "lucide-react"
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

export type IngredientPickerValue =
  | { kind: "ingredient"; canonicalIngredientId: string; label: string; defaultUnit: string }
  | { kind: "recipe"; componentRecipeId: string; label: string }
  | null

type Props = {
  value: IngredientPickerValue
  canonicalIngredients: CanonicalIngredientSummary[]
  recipes: RecipeSummary[]
  /** Recipe IDs to hide (e.g. the recipe currently being edited and its cycle risk set). */
  excludeRecipeIds?: string[]
  onChange: (v: IngredientPickerValue) => void
  onCreateIngredient?: () => void
}

export function IngredientPicker({
  value,
  canonicalIngredients,
  recipes,
  excludeRecipeIds = [],
  onChange,
  onCreateIngredient,
}: Props) {
  const [open, setOpen] = useState(false)
  const excluded = new Set(excludeRecipeIds)

  const label =
    value?.kind === "ingredient"
      ? value.label
      : value?.kind === "recipe"
        ? `${value.label} (sub-recipe)`
        : "Pick ingredient or sub-recipe…"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between font-normal",
            !value && "text-muted-foreground"
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search ingredients & recipes…" />
          <CommandList>
            <CommandEmpty>No matches. Try adding a new ingredient.</CommandEmpty>

            <CommandGroup heading="Ingredients">
              {canonicalIngredients.map((ci) => {
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
                        "mr-2 h-4 w-4",
                        isSelected ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex-1 truncate">{ci.name}</div>
                    {ci.latestUnitCost != null && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        ${ci.latestUnitCost.toFixed(2)}/{ci.latestUnit}
                      </span>
                    )}
                  </CommandItem>
                )
              })}
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="Sub-recipes">
              {recipes
                .filter((r) => !excluded.has(r.id))
                .map((r) => {
                  const isSelected =
                    value?.kind === "recipe" && value.componentRecipeId === r.id
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
                          "mr-2 h-4 w-4",
                          isSelected ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <div className="flex-1 truncate">
                        {r.itemName}
                        {!r.isSellable && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            prep
                          </span>
                        )}
                      </div>
                      {r.computedCost != null && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          ${r.computedCost.toFixed(2)}
                          {r.partialCost ? "*" : ""}
                        </span>
                      )}
                    </CommandItem>
                  )
                })}
            </CommandGroup>

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
                    <Plus className="mr-2 h-4 w-4" />
                    Add new ingredient
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
