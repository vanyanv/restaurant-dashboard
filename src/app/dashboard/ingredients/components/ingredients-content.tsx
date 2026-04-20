"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { EditorialTopbar } from "../../components/editorial-topbar"
import { CatalogTable } from "./catalog-table"
import { ReviewQueue } from "./review-queue"
import { ModifierMappingTable } from "./modifier-mapping-table"
import type { CanonicalIngredientSummary, RecipeSummary } from "@/types/recipe"
import type { UnmatchedLineItemGroup } from "@/app/actions/ingredient-match-actions"
import type { OtterSubItemForCatalog } from "@/app/actions/menu-item-actions"
import { cn } from "@/lib/utils"

type TabId = "catalog" | "review" | "modifiers"

type Props = {
  initialCanonicals: CanonicalIngredientSummary[]
  initialUnmatched: UnmatchedLineItemGroup[]
  initialSubItems: OtterSubItemForCatalog[]
  initialRecipes: RecipeSummary[]
  initialTab: TabId
}

export function IngredientsContent({
  initialCanonicals,
  initialUnmatched,
  initialSubItems,
  initialRecipes,
  initialTab,
}: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<TabId>(initialTab)
  const [canonicals, setCanonicals] = useState(initialCanonicals)
  const [unmatched, setUnmatched] = useState(initialUnmatched)

  const unmappedMods = initialSubItems.filter((s) => !s.mappedRecipeId).length

  const tabs: Array<{ id: TabId; label: string; count: number }> = [
    { id: "catalog", label: "Canonical catalog", count: canonicals.length },
    { id: "review", label: "Needs review", count: unmatched.length },
    { id: "modifiers", label: "Otter modifiers", count: unmappedMods },
  ]

  return (
    <div className="editorial-surface flex min-h-[calc(100vh-3.5rem)] flex-col">
      <EditorialTopbar
        section="§ 11"
        title="Ingredients"
        stamps={
          <span>
            {canonicals.length} canonical · {unmatched.length} unmatched
          </span>
        }
      />

      <div className="border-b border-[var(--hairline)] bg-[var(--paper)] px-8 py-3">
        <div className="flex gap-2">
          {tabs.map((t) => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "inline-flex items-center gap-2 border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] transition",
                  active
                    ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
                    : "border-[var(--hairline-bold)] text-[var(--ink-muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
                )}
              >
                {t.label}
                <span
                  className={cn(
                    "tabular-nums",
                    active ? "text-[var(--paper)]/70" : "text-[var(--ink-faint)]"
                  )}
                >
                  {t.count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-[var(--paper)] px-8 py-8">
        {tab === "catalog" && <CatalogTable canonicals={canonicals} />}
        {tab === "review" && (
          <ReviewQueue
            groups={unmatched}
            canonicals={canonicals}
            onMatched={(groupKey, _newCanonicalId) => {
              setUnmatched((prev) => prev.filter((g) => g.key !== groupKey))
              router.refresh()
            }}
            onCanonicalCreated={(created) => {
              setCanonicals((prev) =>
                [...prev, created].sort((a, b) =>
                  a.name.localeCompare(b.name)
                )
              )
            }}
          />
        )}
        {tab === "modifiers" && (
          <ModifierMappingTable subItems={initialSubItems} recipes={initialRecipes} />
        )}
      </div>
    </div>
  )
}
