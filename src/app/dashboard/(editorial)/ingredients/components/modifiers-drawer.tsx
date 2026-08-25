"use client"

import { useState } from "react"
import { ChevronDown, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { ModifierMappingTable } from "./modifier-mapping-table"
import type { OtterSubItemForCatalog } from "@/app/actions/menu-item-actions"
import type { RecipeSummary } from "@/types/recipe"

type Props = {
  subItems: OtterSubItemForCatalog[]
  recipes: RecipeSummary[]
  unmappedCount: number
}

export function ModifiersDrawer({ subItems, recipes, unmappedCount }: Props) {
  const [open, setOpen] = useState(false)

  if (subItems.length === 0) return null

  return (
    <section className="border-t border-[var(--hairline-bold)] bg-[var(--paper-deep)]/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-3 px-8 py-4 text-left transition hover:bg-[var(--paper-deep)]"
      >
        <div className="flex h-8 w-8 items-center justify-center border border-[var(--hairline-bold)] bg-[var(--paper)] text-[var(--ink-muted)] transition group-hover:border-[var(--ink)] group-hover:text-[var(--ink)]">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
            § advanced
          </div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="font-display text-[18px] italic text-[var(--ink)]">
              Otter modifier mapping
            </span>
            {unmappedCount > 0 && (
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--accent-dark)]">
                {unmappedCount} unmapped
              </span>
            )}
          </div>
          <p className="mt-0.5 font-mono text-[10px] leading-relaxed text-[var(--ink-muted)]">
            Link Otter order modifiers (like &ldquo;Add grilled onion&rdquo;) to
            a tiny recipe so their cost rolls into daily COGS.
          </p>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-[var(--ink-muted)] transition",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="border-t border-[var(--hairline)] bg-[var(--paper)] px-8 pb-8 pt-6">
          <ModifierMappingTable subItems={subItems} recipes={recipes} />
        </div>
      )}
    </section>
  )
}
