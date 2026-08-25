"use client"

import { useMemo, useState } from "react"
import { ChevronDown, Sparkles } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { cn } from "@/lib/utils"
import type { RecipeSummary } from "@/types/recipe"
import type { RecipeCandidate } from "@/app/actions/forecasts/recipe-suggestion-actions"

type Props = {
  otterItemName: string
  candidates: RecipeCandidate[]
  recipes: RecipeSummary[]
  onPick: (recipeId: string) => void
  onBuildNew: () => void
}

/**
 * Per-row popover surfacing the top-3 F28 candidates plus a typeahead over
 * every sellable recipe — the secondary path when ML's top guess is wrong or
 * the operator wants to pick a specific existing recipe without authoring a
 * new one. "Build a new recipe" stays as the explicit fallback.
 */
export function LinkRecipePopover({
  otterItemName,
  candidates,
  recipes,
  onPick,
  onBuildNew,
}: Props) {
  const [open, setOpen] = useState(false)
  const sellable = useMemo(
    () => recipes.filter((r) => r.isSellable),
    [recipes]
  )

  function handlePick(recipeId: string) {
    setOpen(false)
    onPick(recipeId)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Open mapping options for ${otterItemName}`}
          onClick={(e) => {
            e.stopPropagation()
          }}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center border border-[var(--hairline-bold)] bg-[var(--paper)] text-[var(--ink-muted)] transition hover:border-[var(--ink)] hover:text-[var(--ink)]"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[280px] border border-[var(--hairline-bold)] bg-[var(--paper)] p-0 shadow-none"
        onClick={(e) => e.stopPropagation()}
      >
        {candidates.length > 0 && (
          <div className="border-b border-[var(--hairline)]">
            <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
              <Sparkles className="h-3 w-3" />
              ML proposals
            </div>
            <ul className="pb-1">
              {candidates.map((c) => (
                <li key={c.recipeId}>
                  <button
                    type="button"
                    onClick={() => handlePick(c.recipeId)}
                    className="flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left transition hover:bg-[var(--paper-deep)]"
                  >
                    <span className="truncate font-display text-[13px] italic text-[var(--ink)]">
                      {c.recipeName}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-mono text-[10px] tabular-nums tracking-[0.04em]",
                        c.confidence === "high"
                          ? "text-[var(--accent)]"
                          : c.confidence === "medium"
                            ? "text-[var(--ink)]"
                            : "text-[var(--ink-muted)]"
                      )}
                    >
                      {Math.round(c.similarity * 100)}%
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Command className="bg-[var(--paper)]">
          <CommandInput
            placeholder="Find an existing recipe…"
            className="h-9 border-0 font-mono text-[11px] uppercase tracking-[0.08em]"
          />
          <CommandList className="max-h-[220px]">
            <CommandEmpty className="px-3 py-3 font-mono text-[10px] italic text-[var(--ink-faint)]">
              No matches.
            </CommandEmpty>
            <CommandGroup>
              {sellable.map((r) => (
                <CommandItem
                  key={r.id}
                  value={`${r.itemName} ${r.category}`}
                  onSelect={() => handlePick(r.id)}
                  className="cursor-pointer"
                >
                  <span className="truncate font-display text-[13px] italic text-[var(--ink)]">
                    {r.itemName}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">
                    {r.category}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            onBuildNew()
          }}
          className="block w-full border-t border-[var(--hairline)] px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-muted)] transition hover:bg-[var(--paper-deep)] hover:text-[var(--ink)]"
        >
          None of these — build new →
        </button>
      </PopoverContent>
    </Popover>
  )
}
