"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, ChevronsUpDown, Lock, LockOpen, Package, Search } from "lucide-react"
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
  mergeCanonicalIngredients,
  updateCanonicalCost,
} from "@/app/actions/canonical-ingredient-actions"
import type { CanonicalIngredientSummary } from "@/types/recipe"

const RECIPE_UNIT_OPTIONS = [
  "lb", "oz", "g", "kg",
  "gal", "qt", "pt", "cup", "fl oz", "ml", "l",
  "each", "dz",
]

type Props = {
  canonicals: CanonicalIngredientSummary[]
}

export function CatalogTable({ canonicals }: Props) {
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return canonicals
    return canonicals.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      (c.category ?? "").toLowerCase().includes(q)
    )
  }, [canonicals, query])

  if (canonicals.length === 0) {
    return (
      <div className="border border-dashed border-[var(--hairline-bold)] px-8 py-16 text-center">
        <div className="editorial-section-label">§ empty</div>
        <h2 className="mt-2 font-display text-[26px] italic text-[var(--ink)]">
          No canonical ingredients yet.
        </h2>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">
          Run <em className="not-italic text-[var(--ink)]">Seed from invoices</em> on the recipes page,
          <br />
          or map unmatched line items in the Review tab.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-5 flex items-center gap-2 border-b border-[var(--hairline-bold)] pb-3">
        <Search className="h-3.5 w-3.5 text-[var(--ink-faint)]" />
        <Input
          placeholder="Search ingredients…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 max-w-sm border-0 bg-transparent px-0 text-sm focus-visible:ring-0"
        />
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
          {filtered.length} of {canonicals.length}
        </span>
      </div>

      <ul className="border-t border-[var(--hairline)]">
        {filtered.map((c) => (
          <Row key={c.id} row={c} canonicals={canonicals} />
        ))}
      </ul>
    </div>
  )
}

function Row({
  row,
  canonicals,
}: {
  row: CanonicalIngredientSummary
  canonicals: CanonicalIngredientSummary[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [pending, startTransition] = useTransition()

  const others = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = canonicals.filter((c) => c.id !== row.id)
    if (!q) return base.slice(0, 50)
    return base.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 50)
  }, [canonicals, row.id, query])

  function pickTarget(target: CanonicalIngredientSummary) {
    const ok = window.confirm(
      `Merge “${row.name}” into “${target.name}”?\n\n` +
        `All invoice history, aliases, SKU matches, and recipe uses will be re-pointed to “${target.name}”. This cannot be undone.`
    )
    if (!ok) return
    setOpen(false)
    startTransition(async () => {
      try {
        const result = await mergeCanonicalIngredients({
          sourceId: row.id,
          targetId: target.id,
        })
        toast.success(
          `Merged into “${target.name}” — ${result.lineItems} line item${result.lineItems === 1 ? "" : "s"}, ${result.aliases} alias${result.aliases === 1 ? "" : "es"} moved`
        )
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Merge failed")
      }
    })
  }

  const asOf = row.latestPriceAt
    ? new Date(row.latestPriceAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "2-digit",
      })
    : null

  return (
    <li className="group grid grid-cols-[auto_1fr_auto_auto] items-start gap-4 border-b border-[var(--hairline)] py-4">
      <div className="mt-0.5 flex h-9 w-9 items-center justify-center border border-[var(--hairline-bold)] text-[var(--ink-faint)]">
        <Package className="h-4 w-4" />
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-display text-[17px] italic uppercase text-[var(--ink)]">
            {row.name}
          </span>
          {row.category && (
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
              {row.category}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">
          {row.latestVendor ? (
            <>
              <span className="text-[var(--ink-muted)]">{row.latestVendor}</span>
              {row.latestSku && (
                <>
                  <span>·</span>
                  <span>SKU {row.latestSku}</span>
                </>
              )}
              {row.latestUnitCost != null && (
                <>
                  <span>·</span>
                  <span>
                    📄 ${row.latestUnitCost.toFixed(2)}/{row.latestUnit}
                    {asOf ? ` ${asOf}` : ""}
                  </span>
                </>
              )}
            </>
          ) : (
            <>
              <span>no invoices yet</span>
              <span>·</span>
              <span>default {row.defaultUnit}</span>
            </>
          )}
          <span>·</span>
          <span>
            {row.aliasCount} alias{row.aliasCount === 1 ? "" : "es"}
          </span>
        </div>
      </div>

      <CostEditor row={row} />

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            disabled={pending}
            className="h-8 border border-[var(--ink)] bg-transparent font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink)] hover:bg-[var(--ink)] hover:text-[var(--paper)]"
          >
            {pending ? "Merging…" : "Merge"}
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
              placeholder="Merge into…"
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
                    Absorb into
                  </span>
                }
              >
                {others.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`canonical ${c.name}`}
                    onSelect={() => pickTarget(c)}
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
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </li>
  )
}

/**
 * Editable "recipe unit + cost per unit" block. Saves on blur / unit change.
 * Cost source is surfaced with 📄 (invoice) / ✏️ (manual) badges. Lock toggle
 * blocks future invoice-derived overrides.
 */
function CostEditor({ row }: { row: CanonicalIngredientSummary }) {
  const router = useRouter()
  const [unit, setUnit] = useState(row.recipeUnit ?? "")
  const [cost, setCost] = useState<string>(
    row.costPerRecipeUnit != null ? row.costPerRecipeUnit.toString() : ""
  )
  const [locked, setLocked] = useState(row.costLocked)
  const [pending, startTransition] = useTransition()

  const hasChanges =
    unit !== (row.recipeUnit ?? "") ||
    cost !== (row.costPerRecipeUnit != null ? row.costPerRecipeUnit.toString() : "")

  function save(next: {
    recipeUnit?: string | null
    costPerRecipeUnit?: number | null
    costLocked?: boolean
  }) {
    startTransition(async () => {
      try {
        await updateCanonicalCost({
          canonicalIngredientId: row.id,
          ...next,
        })
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed")
      }
    })
  }

  function commit() {
    if (!hasChanges) return
    const trimmedUnit = unit.trim()
    const parsedCost = cost.trim() === "" ? null : Number(cost)
    if (parsedCost != null && (!Number.isFinite(parsedCost) || parsedCost < 0)) {
      toast.error("Cost must be a non-negative number")
      return
    }
    save({
      recipeUnit: trimmedUnit === "" ? null : trimmedUnit,
      costPerRecipeUnit: parsedCost,
    })
  }

  function toggleLock() {
    const next = !locked
    setLocked(next)
    save({ costLocked: next })
  }

  const sourceBadge =
    row.costPerRecipeUnit != null
      ? row.costSource === "invoice"
        ? "📄 invoice"
        : "✏️ manual"
      : "—"

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">
          $
        </span>
        <Input
          type="number"
          step="0.0001"
          min="0"
          inputMode="decimal"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur()
            }
          }}
          disabled={pending}
          placeholder="cost"
          className="h-7 w-24 border-[var(--hairline-bold)] bg-transparent px-2 text-right font-mono text-[13px] tabular-nums focus-visible:ring-0"
        />
        <span className="font-mono text-[10px] text-[var(--ink-muted)]">/</span>
        <select
          value={unit}
          onChange={(e) => {
            setUnit(e.target.value)
            // Commit immediately on unit change (use the new value, not stale state).
            const parsedCost = cost.trim() === "" ? null : Number(cost)
            const next = e.target.value.trim()
            save({
              recipeUnit: next === "" ? null : next,
              costPerRecipeUnit:
                parsedCost != null && Number.isFinite(parsedCost) && parsedCost >= 0
                  ? parsedCost
                  : row.costPerRecipeUnit,
            })
          }}
          disabled={pending}
          className="h-7 border border-[var(--hairline-bold)] bg-transparent px-2 font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ink)] focus:outline-none"
        >
          <option value="">unit</option>
          {RECIPE_UNIT_OPTIONS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={toggleLock}
          disabled={pending}
          title={locked ? "Locked — invoice matches won't overwrite" : "Unlocked — invoice matches can overwrite"}
          className="flex h-7 w-7 items-center justify-center border border-[var(--hairline-bold)] text-[var(--ink-muted)] hover:text-[var(--ink)] disabled:opacity-50"
        >
          {locked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
        </button>
      </div>
      <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">
        {pending ? "saving…" : sourceBadge}
      </div>
    </div>
  )
}
