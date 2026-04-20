"use client"

import { useState, useTransition } from "react"
import { Check, ChevronsUpDown, Plus, Receipt, ArrowRight } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import type { CanonicalIngredientSummary } from "@/types/recipe"
import type { UnmatchedLineItemGroup } from "@/app/actions/ingredient-match-actions"
import { confirmSkuMatch } from "@/app/actions/ingredient-match-actions"

type Props = {
  groups: UnmatchedLineItemGroup[]
  canonicals: CanonicalIngredientSummary[]
  onMatched: (groupKey: string, newCanonicalId: string) => void
  onCanonicalCreated: (created: CanonicalIngredientSummary) => void
}

export function ReviewQueue({
  groups,
  canonicals,
  onMatched,
  onCanonicalCreated,
}: Props) {
  if (groups.length === 0) {
    return (
      <div className="border border-dashed border-[var(--hairline-bold)] px-8 py-16 text-center">
        <div className="editorial-section-label">§ clear</div>
        <h2 className="mt-2 font-display text-[26px] italic text-[var(--ink)]">
          Every invoice line is matched.
        </h2>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">
          New invoices will auto-link by SKU as they arrive.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-5 flex items-baseline justify-between border-b border-[var(--hairline-bold)] pb-3">
        <p className="max-w-xl font-mono text-[11px] leading-relaxed text-[var(--ink-muted)]">
          Sorted by spend. Matching once teaches the system — the same{" "}
          <em className="not-italic text-[var(--ink)]">(vendor, SKU)</em> will auto-link on every future invoice,
          and all past line items with that key will be back-filled.
        </p>
      </div>

      <ul className="border-t border-[var(--hairline)]">
        {groups.map((g) => (
          <GroupRow
            key={g.key}
            group={g}
            canonicals={canonicals}
            onMatched={onMatched}
            onCanonicalCreated={onCanonicalCreated}
          />
        ))}
      </ul>
    </div>
  )
}

function GroupRow({
  group,
  canonicals,
  onMatched,
  onCanonicalCreated,
}: {
  group: UnmatchedLineItemGroup
  canonicals: CanonicalIngredientSummary[]
  onMatched: (groupKey: string, newCanonicalId: string) => void
  onCanonicalCreated: (created: CanonicalIngredientSummary) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [newUnit, setNewUnit] = useState(group.unit ?? "")

  function pickExisting(c: CanonicalIngredientSummary) {
    setError(null)
    startTransition(async () => {
      try {
        const result = await confirmSkuMatch({
          lineItemId: group.sampleLineItemId,
          canonicalIngredientId: c.id,
        })
        onMatched(group.key, result.canonicalIngredientId)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Match failed")
      }
    })
  }

  function createAndMatch() {
    const name = query.trim() || group.productName
    const unit = newUnit.trim() || group.unit || "unit"
    setError(null)
    startTransition(async () => {
      try {
        const result = await confirmSkuMatch({
          lineItemId: group.sampleLineItemId,
          newCanonical: { name, defaultUnit: unit },
        })
        onCanonicalCreated({
          id: result.canonicalIngredientId,
          name,
          defaultUnit: unit,
          category: null,
          aliasCount: 0,
          recipeUnit: null,
          costPerRecipeUnit: null,
          costSource: null,
          costLocked: false,
          costUpdatedAt: null,
          latestUnitCost: null,
          latestUnit: null,
          latestPriceAt: null,
          latestVendor: null,
          latestSku: null,
        })
        onMatched(group.key, result.canonicalIngredientId)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Match failed")
      }
    })
  }

  return (
    <li className="group grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 border-b border-[var(--hairline)] py-4">
      <div className="flex h-9 w-9 items-center justify-center border border-[var(--hairline-bold)] text-[var(--ink-faint)]">
        <Receipt className="h-4 w-4" />
      </div>

      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[17px] italic text-[var(--ink)]">
            {group.productName}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">
          <span className="text-[var(--ink-muted)]">{group.vendorName}</span>
          {group.sku && (
            <>
              <span>·</span>
              <span>SKU {group.sku}</span>
            </>
          )}
          {group.unit && (
            <>
              <span>·</span>
              <span>{group.unit}</span>
            </>
          )}
          {group.derivedCostPreview && (
            <>
              <span>·</span>
              <span className="text-[var(--ink-muted)]">
                📄 ${group.derivedCostPreview.costPerBase.toFixed(4)}/{group.derivedCostPreview.baseUnit}
              </span>
            </>
          )}
        </div>
        {error && (
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--accent-dark)]">
            {error}
          </div>
        )}
      </div>

      <div className="text-right">
        <div className="font-mono text-[15px] tabular-nums text-[var(--ink)]">
          ${group.totalSpend.toFixed(2)}
        </div>
        <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">
          {group.occurrences} order{group.occurrences === 1 ? "" : "s"}
        </div>
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            disabled={pending}
            className="h-8 border border-[var(--ink)] bg-transparent font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink)] hover:bg-[var(--ink)] hover:text-[var(--paper)]"
          >
            {pending ? "Linking…" : "Match"}
            <ChevronsUpDown className="ml-1 h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[380px] border-[var(--hairline-bold)] bg-[var(--paper)] p-0"
          align="end"
        >
          <Command shouldFilter={false}>
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Find canonical or type new name…"
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
                    Link to existing
                  </span>
                }
              >
                {filterList(canonicals, query, (c) => c.name).map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`canonical ${c.name}`}
                    onSelect={() => pickExisting(c)}
                  >
                    <Check className="mr-2 h-3.5 w-3.5 opacity-0" />
                    <div className="flex-1 truncate">{c.name}</div>
                    {c.latestUnitCost != null && (
                      <span className="ml-2 font-mono text-[10px] tabular-nums text-[var(--ink-muted)]">
                        ${c.latestUnitCost.toFixed(2)}/{c.latestUnit}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>

              <CommandSeparator />

              <CommandGroup
                heading={
                  <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                    Create new canonical
                  </span>
                }
              >
                <div className="space-y-2 px-2 py-2">
                  <div className="text-[11px] text-[var(--ink-muted)]">
                    Create &ldquo;{query.trim() || group.productName}&rdquo;
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="default unit"
                      value={newUnit}
                      onChange={(e) => setNewUnit(e.target.value)}
                      className="h-8 flex-1 border-[var(--hairline-bold)] bg-transparent font-mono text-[11px]"
                    />
                    <Button
                      size="sm"
                      onClick={createAndMatch}
                      disabled={pending}
                      className="h-8 bg-[var(--ink)] text-[var(--paper)] hover:bg-[var(--accent-dark)]"
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      Create & match
                      <ArrowRight className="ml-1 h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </li>
  )
}

function filterList<T>(items: T[], query: string, key: (t: T) => string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((i) => key(i).toLowerCase().includes(q)).slice(0, 50)
}
