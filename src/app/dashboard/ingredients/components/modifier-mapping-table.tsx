"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, ChevronsUpDown, Search, X, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  mapOtterSubItemToRecipe,
  unmapOtterSubItem,
  type OtterSubItemForCatalog,
} from "@/app/actions/menu-item-actions"
import type { RecipeSummary } from "@/types/recipe"

type Props = {
  subItems: OtterSubItemForCatalog[]
  recipes: RecipeSummary[]
}

export function ModifierMappingTable({ subItems, recipes }: Props) {
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<"all" | "unmapped" | "mapped">("unmapped")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return subItems.filter((s) => {
      if (filter === "unmapped" && s.mappedRecipeId) return false
      if (filter === "mapped" && !s.mappedRecipeId) return false
      if (!q) return true
      return (
        s.name.toLowerCase().includes(q) ||
        (s.subHeader ?? "").toLowerCase().includes(q) ||
        (s.mappedRecipeName ?? "").toLowerCase().includes(q)
      )
    })
  }, [subItems, query, filter])

  const unmappedCount = subItems.filter((s) => !s.mappedRecipeId).length
  const mappedCount = subItems.length - unmappedCount

  if (subItems.length === 0) {
    return (
      <div className="border border-dashed border-[var(--hairline-bold)] px-8 py-16 text-center">
        <div className="editorial-section-label">§ empty</div>
        <h2 className="mt-2 font-display text-[26px] italic text-[var(--ink)]">
          No Otter sub-items yet.
        </h2>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">
          Modifiers appear here after Otter orders with add-ons sync.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-[var(--hairline-bold)] pb-3">
        <Search className="h-3.5 w-3.5 text-[var(--ink-faint)]" />
        <Input
          placeholder="Search modifiers…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 max-w-sm border-0 bg-transparent px-0 text-sm focus-visible:ring-0"
        />
        <div className="ml-auto flex gap-1 font-mono text-[10px] uppercase tracking-[0.12em]">
          {(
            [
              ["unmapped", `Unmapped (${unmappedCount})`],
              ["mapped", `Mapped (${mappedCount})`],
              ["all", `All (${subItems.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={
                "border px-2 py-1 transition " +
                (filter === id
                  ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
                  : "border-[var(--hairline-bold)] text-[var(--ink-muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-4 max-w-xl font-mono text-[10px] uppercase leading-relaxed tracking-[0.08em] text-[var(--ink-muted)]">
        Map each modifier to a tiny recipe that captures its ingredients (e.g.{" "}
        <em className="not-italic text-[var(--ink)]">Mod: Add Grilled Onion</em> = 0.03 lb onion + a bit of
        butter). Cost of ordered modifiers folds into each day's COGS.
      </p>

      <ul className="border-t border-[var(--hairline)]">
        {filtered.map((s) => (
          <Row key={s.skuId} row={s} recipes={recipes} />
        ))}
      </ul>
    </div>
  )
}

function Row({
  row,
  recipes,
}: {
  row: OtterSubItemForCatalog
  recipes: RecipeSummary[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState("")
  const [pending, startTransition] = useTransition()

  const matches = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    if (!q) return recipes.slice(0, 80)
    return recipes.filter((r) => r.itemName.toLowerCase().includes(q)).slice(0, 80)
  }, [recipes, pickerQuery])

  function map(recipe: RecipeSummary) {
    setOpen(false)
    startTransition(async () => {
      try {
        await mapOtterSubItemToRecipe({
          skuId: row.skuId,
          otterSubItemName: row.name,
          recipeId: recipe.id,
        })
        toast.success(`“${row.name}” → ${recipe.itemName}`)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Map failed")
      }
    })
  }

  function unmap() {
    if (!row.mappedRecipeId) return
    startTransition(async () => {
      try {
        await unmapOtterSubItem(row.skuId)
        toast.success(`Unmapped “${row.name}”`)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Unmap failed")
      }
    })
  }

  const lastSeen = row.lastSeen
    ? new Date(row.lastSeen).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "2-digit",
      })
    : null

  return (
    <li className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 border-b border-[var(--hairline)] py-3">
      <div className="flex h-9 w-9 items-center justify-center border border-[var(--hairline-bold)] text-[var(--ink-faint)]">
        <Sparkles className="h-4 w-4" />
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-display text-[16px] italic text-[var(--ink)]">
            {row.name}
          </span>
          {row.subHeader && (
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">
              {row.subHeader}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">
          <span>SKU {row.skuId.slice(0, 12)}…</span>
          {lastSeen && (
            <>
              <span>·</span>
              <span>last {lastSeen}</span>
            </>
          )}
          {row.mappedRecipeName && (
            <>
              <span>·</span>
              <span className="text-[var(--ink)]">→ {row.mappedRecipeName}</span>
            </>
          )}
        </div>
      </div>

      <div className="text-right">
        <div className="font-mono text-[15px] tabular-nums text-[var(--ink)]">
          {row.occurrences}
        </div>
        <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">
          uses
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              disabled={pending}
              className="h-8 border border-[var(--ink)] bg-transparent font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink)] hover:bg-[var(--ink)] hover:text-[var(--paper)]"
            >
              {pending ? "…" : row.mappedRecipeId ? "Remap" : "Map"}
              <ChevronsUpDown className="ml-1 h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[360px] border-[var(--hairline-bold)] bg-[var(--paper)] p-0"
            align="end"
          >
            <Command shouldFilter={false}>
              <CommandInput
                value={pickerQuery}
                onValueChange={setPickerQuery}
                placeholder="Find modifier recipe…"
              />
              <CommandList>
                <CommandEmpty>
                  <div className="px-3 py-4 text-center font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">
                    No match.
                  </div>
                </CommandEmpty>
                <CommandGroup
                  heading={
                    <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                      Map to recipe
                    </span>
                  }
                >
                  {matches.map((r) => (
                    <CommandItem
                      key={r.id}
                      value={`recipe ${r.itemName}`}
                      onSelect={() => map(r)}
                    >
                      <Check
                        className={
                          "mr-2 h-3.5 w-3.5 " +
                          (r.id === row.mappedRecipeId ? "opacity-100" : "opacity-0")
                        }
                      />
                      <div className="flex-1 truncate">{r.itemName}</div>
                      {r.computedCost != null && (
                        <span className="ml-2 font-mono text-[10px] tabular-nums text-[var(--ink-muted)]">
                          ${r.computedCost.toFixed(2)}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {row.mappedRecipeId && (
          <button
            type="button"
            onClick={unmap}
            disabled={pending}
            title="Unmap"
            className="flex h-8 w-8 items-center justify-center border border-[var(--hairline-bold)] text-[var(--ink-muted)] hover:border-[var(--accent)] hover:text-[var(--accent-dark)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </li>
  )
}
