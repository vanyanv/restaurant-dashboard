"use client"

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react"
import { createPortal } from "react-dom"
import {
  BookOpen,
  Plus,
  Receipt,
  Search,
  Sparkles,
  X,
  Check,
  EyeOff,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  searchUnmatchedLineItems,
  confirmSkuMatch,
  type UnmatchedLineItemHit,
} from "@/app/actions/ingredient-match-actions"
import type {
  CanonicalIngredientSummary,
  RecipeSummary,
} from "@/types/recipe"
import {
  bucketFor,
  CATEGORY_BUCKETS,
  categorySwatch,
  isLikelyNonFood,
  prettifyIngredientName,
  type CategoryBucket,
  type IngredientPickerValue,
} from "./ingredient-picker-utils"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: IngredientPickerValue
  canonicalIngredients: CanonicalIngredientSummary[]
  recipes: RecipeSummary[]
  excludeRecipeIds?: string[]
  onChange: (v: IngredientPickerValue) => void
  onCanonicalCreated?: () => void
  onCreateIngredient?: () => void
  /**
   * Title shown in the drawer header — context for what the user is doing.
   * Default "Pick an ingredient".
   */
  title?: string
}

type Tab = "ingredients" | "recipes" | "invoices"

export function IngredientPickerSheet({
  open,
  onOpenChange,
  value,
  canonicalIngredients,
  recipes,
  excludeRecipeIds = [],
  onChange,
  onCanonicalCreated,
  onCreateIngredient,
  title = "Pick an ingredient",
}: Props) {
  const [query, setQuery] = useState("")
  const [tab, setTab] = useState<Tab>("ingredients")
  const [bucket, setBucket] = useState<CategoryBucket | "All">("All")
  const [rawHits, setRawHits] = useState<UnmatchedLineItemHit[]>([])
  const [isSearching, startSearch] = useTransition()
  const [linking, setLinking] = useState<string | null>(null)
  const [showSupplies, setShowSupplies] = useState(false)
  const [mounted, setMounted] = useState(false)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const closeOnPickRef = useRef(true)

  // Portal target (document.body) — only set after mount to avoid SSR mismatch
  // and to escape the editorial-surface stacking context that traps fixed
  // children behind the dashboard topbar.
  useEffect(() => {
    setMounted(true)
  }, [])

  // Reset state on open / focus search.
  useEffect(() => {
    if (open) {
      setQuery("")
      setBucket("All")
      setRawHits([])
      setTab(value?.kind === "recipe" ? "recipes" : "ingredients")
      // Auto-focus search after the sheet's open animation settles.
      const t = setTimeout(() => searchRef.current?.focus(), 80)
      return () => clearTimeout(t)
    }
  }, [open, value?.kind])

  // Lock body scroll & escape-to-close.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false)
    }
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener("keydown", onKey)
    }
  }, [open, onOpenChange])

  // Debounced raw-invoice search.
  useEffect(() => {
    if (!open || tab !== "invoices" || query.trim().length < 2) {
      setRawHits([])
      return
    }
    const q = query
    const t = setTimeout(() => {
      startSearch(async () => {
        const hits = await searchUnmatchedLineItems(q, 16)
        setRawHits(hits)
      })
    }, 200)
    return () => clearTimeout(t)
  }, [query, open, tab])

  const excluded = useMemo(() => new Set(excludeRecipeIds), [excludeRecipeIds])

  // Pre-compute non-food classification once per ingredient list.
  const nonFoodIds = useMemo(() => {
    const set = new Set<string>()
    canonicalIngredients.forEach((c) => {
      if (isLikelyNonFood(c.name, c.category)) set.add(c.id)
    })
    return set
  }, [canonicalIngredients])

  const hiddenSuppliesCount = nonFoodIds.size

  // Visible pool = everything unless the user has flipped the supplies toggle on.
  const visiblePool = useMemo(() => {
    if (showSupplies) return canonicalIngredients
    return canonicalIngredients.filter((c) => !nonFoodIds.has(c.id))
  }, [canonicalIngredients, nonFoodIds, showSupplies])

  const recents = useMemo(() => {
    return [...visiblePool]
      .filter((c) => c.costUpdatedAt || c.aliasCount > 0)
      .sort((a, b) => {
        const at = a.costUpdatedAt ? new Date(a.costUpdatedAt).getTime() : 0
        const bt = b.costUpdatedAt ? new Date(b.costUpdatedAt).getTime() : 0
        if (bt !== at) return bt - at
        return b.aliasCount - a.aliasCount
      })
      .slice(0, 6)
  }, [visiblePool])

  const ingredientsFiltered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return visiblePool.filter((c) => {
      if (q) {
        const pretty = prettifyIngredientName(c.name).toLowerCase()
        if (!c.name.toLowerCase().includes(q) && !pretty.includes(q))
          return false
      }
      if (bucket !== "All" && bucketFor(c.category) !== bucket) return false
      return true
    })
  }, [visiblePool, query, bucket])

  const bucketCounts = useMemo(() => {
    const counts = new Map<CategoryBucket, number>()
    visiblePool.forEach((c) => {
      const b = bucketFor(c.category)
      counts.set(b, (counts.get(b) ?? 0) + 1)
    })
    return counts
  }, [visiblePool])

  const recipesFiltered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return recipes
      .filter((r) => !excluded.has(r.id))
      .filter((r) => (q ? r.itemName.toLowerCase().includes(q) : true))
  }, [recipes, query, excluded])

  function pickIngredient(c: CanonicalIngredientSummary) {
    onChange({
      kind: "ingredient",
      canonicalIngredientId: c.id,
      label: c.name,
      defaultUnit: c.defaultUnit,
    })
    if (closeOnPickRef.current) onOpenChange(false)
  }

  function pickRecipe(r: RecipeSummary) {
    onChange({
      kind: "recipe",
      componentRecipeId: r.id,
      label: r.itemName,
    })
    if (closeOnPickRef.current) onOpenChange(false)
  }

  async function handleMatchRaw(hit: UnmatchedLineItemHit) {
    setLinking(hit.lineItemId)
    try {
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
      onCanonicalCreated?.()
      if (closeOnPickRef.current) onOpenChange(false)
    } finally {
      setLinking(null)
    }
  }

  if (!open || !mounted) return null

  // Re-declare the editorial design tokens on the portal root — the picker
  // renders into document.body, outside the .editorial-surface scope where
  // these CSS variables are defined, so without this every var(--paper),
  // var(--ink) etc. resolves to empty and the drawer renders transparent.
  const editorialVars = {
    "--ink": "#1a1613",
    "--ink-muted": "#6b625a",
    "--ink-faint": "#a69d92",
    "--paper": "#fbf6ee",
    "--paper-deep": "#f4ecdf",
    "--hairline": "#e8dfd3",
    "--hairline-bold": "#c9beaf",
    "--accent": "#dc2626",
    "--accent-dark": "#7c1515",
    "--accent-bg": "#fcecec",
  } as React.CSSProperties

  return createPortal(
    <div
      className="fixed inset-0 z-[100]"
      aria-modal="true"
      role="dialog"
      style={editorialVars}
    >
      {/* Overlay — paper-tinted scrim, not the default black */}
      <button
        type="button"
        aria-label="Close picker"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 bg-[#1a1613]/35 backdrop-blur-[2px] animate-in fade-in duration-200"
      />

      {/* Drawer */}
      <div
        className="absolute right-0 top-0 flex h-full w-full max-w-[680px] flex-col border-l border-[var(--hairline-bold)] bg-[var(--paper)] shadow-[-12px_0_40px_-20px_rgba(26,22,19,0.35)] animate-in slide-in-from-right duration-300"
        style={{
          backgroundImage:
            "radial-gradient(900px 600px at 100% 0%, #fff9ef 0%, transparent 55%), linear-gradient(180deg, var(--paper), var(--paper-deep))",
        }}
      >
        {/* Header */}
        <header className="border-b border-[var(--hairline-bold)] px-7 pb-5 pt-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
                § pantry
              </div>
              <h2 className="mt-1 font-display text-[34px] italic leading-[1.05] tracking-[-0.02em] text-[var(--ink)]">
                {title}
              </h2>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                {canonicalIngredients.length} ingredient
                {canonicalIngredients.length === 1 ? "" : "s"} · {recipes.length}{" "}
                sub-recipe{recipes.length === 1 ? "" : "s"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex h-9 w-9 items-center justify-center border border-[var(--hairline-bold)] bg-[var(--paper)] text-[var(--ink-muted)] transition hover:border-[var(--ink)] hover:text-[var(--ink)]"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Big search */}
          <div className="mt-5 flex items-center gap-3 border-2 border-[var(--ink)] bg-[var(--paper)] px-4">
            <Search className="h-4 w-4 text-[var(--ink-muted)]" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                tab === "invoices"
                  ? "Search invoice line items… (vendor, SKU, name)"
                  : tab === "recipes"
                    ? "Search sub-recipes…"
                    : "Search ingredients… (e.g. cilantro, mozzarella)"
              }
              className="h-12 flex-1 bg-transparent font-display text-[18px] italic text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)] hover:text-[var(--ink)]"
              >
                clear
              </button>
            )}
          </div>

          {/* Tabs */}
          <div className="mt-4 flex flex-wrap items-end gap-x-0 gap-y-2">
            <TabButton
              active={tab === "ingredients"}
              onClick={() => setTab("ingredients")}
              count={visiblePool.length}
            >
              My ingredients
            </TabButton>
            <TabButton
              active={tab === "recipes"}
              onClick={() => setTab("recipes")}
              count={recipes.filter((r) => !excluded.has(r.id)).length}
              icon={<BookOpen className="h-3 w-3" />}
            >
              Sub-recipes
            </TabButton>
            <TabButton
              active={tab === "invoices"}
              onClick={() => setTab("invoices")}
              icon={<Receipt className="h-3 w-3" />}
            >
              From invoices
            </TabButton>

            <div className="ml-auto flex items-center gap-3">
              {tab === "ingredients" && hiddenSuppliesCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowSupplies((v) => !v)}
                  className={cn(
                    "inline-flex items-center gap-1.5 border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition",
                    showSupplies
                      ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
                      : "border-[var(--hairline-bold)] bg-[var(--paper)] text-[var(--ink-muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
                  )}
                  title={
                    showSupplies
                      ? "Hide cleaning supplies, fees, and equipment"
                      : `Show ${hiddenSuppliesCount} hidden non-recipe item${hiddenSuppliesCount === 1 ? "" : "s"}`
                  }
                >
                  <EyeOff className="h-3 w-3" />
                  {showSupplies ? "Hide supplies" : `Show all (+${hiddenSuppliesCount})`}
                </button>
              )}
              <label className="inline-flex cursor-pointer items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                <input
                  type="checkbox"
                  defaultChecked
                  onChange={(e) => (closeOnPickRef.current = e.target.checked)}
                  className="h-3 w-3 accent-[var(--accent)]"
                />
                Close after pick
              </label>
            </div>
          </div>
        </header>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {tab === "ingredients" && (
            <>
              {/* Category rail */}
              <nav className="w-[180px] shrink-0 border-r border-[var(--hairline)] bg-[var(--paper)]/70 px-4 py-5">
                <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
                  Stations
                </div>
                <ul className="mt-3 space-y-1">
                  <RailItem
                    active={bucket === "All"}
                    onClick={() => setBucket("All")}
                    count={canonicalIngredients.length}
                    swatch={null}
                  >
                    All
                  </RailItem>
                  {CATEGORY_BUCKETS.map((b) => {
                    const count = bucketCounts.get(b) ?? 0
                    if (count === 0) return null
                    const sw = categorySwatch(b)
                    return (
                      <RailItem
                        key={b}
                        active={bucket === b}
                        onClick={() => setBucket(b)}
                        count={count}
                        swatch={sw}
                      >
                        {b}
                      </RailItem>
                    )
                  })}
                </ul>
              </nav>

              {/* Tile grid */}
              <div className="relative flex-1 overflow-y-auto">
                {/* Recents (only when no filter, no query) */}
                {bucket === "All" && !query && recents.length > 0 && (
                  <section className="border-b border-dashed border-[var(--hairline-bold)] px-6 pb-5 pt-5">
                    <div className="mb-3 flex items-baseline justify-between">
                      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                        <Sparkles className="h-3 w-3" />
                        Recently used
                      </div>
                      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                        tap to add
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {recents.map((c) => (
                        <RecentChip
                          key={c.id}
                          ingredient={c}
                          selected={
                            value?.kind === "ingredient" &&
                            value.canonicalIngredientId === c.id
                          }
                          onClick={() => pickIngredient(c)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {/* Main grid */}
                <section className="px-6 py-5">
                  {ingredientsFiltered.length === 0 ? (
                    <EmptyState
                      title="Nothing here yet."
                      hint={
                        query
                          ? `No ingredient matches "${query}". Try the From invoices tab, or create a new one.`
                          : "Seed from invoices to populate this station, or add one by hand."
                      }
                      onCreate={onCreateIngredient}
                    />
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {ingredientsFiltered.map((c) => (
                        <IngredientTile
                          key={c.id}
                          ingredient={c}
                          selected={
                            value?.kind === "ingredient" &&
                            value.canonicalIngredientId === c.id
                          }
                          onClick={() => pickIngredient(c)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </>
          )}

          {tab === "recipes" && (
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {recipesFiltered.length === 0 ? (
                <EmptyState
                  title="No sub-recipes."
                  hint="Build a prep recipe (like 'chimichurri base') and it'll show up here."
                />
              ) : (
                <ul className="grid grid-cols-1 gap-2">
                  {recipesFiltered.map((r) => {
                    const isSelected =
                      value?.kind === "recipe" && value.componentRecipeId === r.id
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => pickRecipe(r)}
                          className={cn(
                            "group flex w-full items-center gap-4 border-2 bg-[var(--paper)] px-4 py-3.5 text-left transition",
                            isSelected
                              ? "border-[var(--ink)] shadow-[3px_3px_0_var(--accent)]"
                              : "border-[var(--hairline-bold)] hover:border-[var(--ink)] hover:shadow-[3px_3px_0_var(--hairline-bold)]"
                          )}
                        >
                          <div
                            className="flex h-11 w-11 shrink-0 items-center justify-center text-base font-bold text-white"
                            style={{
                              background: categorySwatch("sub-recipe").bg,
                            }}
                          >
                            <BookOpen className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-display text-[20px] italic leading-tight text-[var(--ink)]">
                              {r.itemName}
                            </div>
                            <div className="mt-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-muted)]">
                              <span>{r.category}</span>
                              <span className="text-[var(--ink-faint)]">·</span>
                              <span className="tabular-nums">
                                {r.ingredientCount} ingredient
                                {r.ingredientCount === 1 ? "" : "s"}
                              </span>
                              {!r.isSellable && (
                                <>
                                  <span className="text-[var(--ink-faint)]">·</span>
                                  <span>prep</span>
                                </>
                              )}
                            </div>
                          </div>
                          {r.computedCost != null && (
                            <div className="text-right">
                              <div className="font-mono text-[15px] tabular-nums text-[var(--ink)]">
                                ${r.computedCost.toFixed(2)}
                                {r.partialCost && (
                                  <span className="text-[var(--accent)]">*</span>
                                )}
                              </div>
                              <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                                cost
                              </div>
                            </div>
                          )}
                          {isSelected && (
                            <Check className="h-5 w-5 text-[var(--accent)]" />
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}

          {tab === "invoices" && (
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {query.trim().length < 2 ? (
                <EmptyState
                  title="Search your invoices."
                  hint="Type a product name to find unmatched invoice line items. Picking one will create a canonical ingredient and link it back."
                />
              ) : isSearching ? (
                <SearchingState />
              ) : rawHits.length === 0 ? (
                <EmptyState
                  title={`No invoice matches for "${query}".`}
                  hint="If your supplier hasn't billed for it yet, create a manual ingredient instead."
                  onCreate={onCreateIngredient}
                />
              ) : (
                <ul className="grid grid-cols-1 gap-2">
                  {rawHits.map((hit) => (
                    <li key={hit.lineItemId}>
                      <button
                        type="button"
                        onClick={() => handleMatchRaw(hit)}
                        disabled={linking === hit.lineItemId}
                        className="group flex w-full items-center gap-4 border-2 border-dashed border-[var(--hairline-bold)] bg-[var(--paper)] px-4 py-3.5 text-left transition hover:border-[var(--ink)] disabled:opacity-50"
                      >
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center bg-[var(--accent-bg)] text-[var(--accent-dark)]">
                          <Receipt className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div
                            className="truncate font-display text-[18px] leading-tight text-[var(--ink)]"
                            title={hit.productName}
                          >
                            {prettifyIngredientName(hit.productName)}
                          </div>
                          <div className="mt-1 truncate font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-muted)]">
                            {hit.vendorName}
                            {hit.sku && ` · sku ${hit.sku}`}
                            {" · "}
                            seen {hit.occurrences}×
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-[15px] tabular-nums text-[var(--ink)]">
                            ${hit.latestUnitPrice.toFixed(2)}
                          </div>
                          <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                            /{hit.unit ?? "unit"}
                          </div>
                        </div>
                        <Plus className="h-4 w-4 text-[var(--accent)] opacity-60 transition-opacity group-hover:opacity-100" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="border-t border-[var(--hairline-bold)] bg-[var(--paper-deep)] px-7 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="font-mono text-[10px] uppercase leading-snug tracking-[0.12em] text-[var(--ink-muted)]">
              Don&apos;t see it?
              <br />
              <span className="text-[var(--ink-faint)]">
                Create a manual ingredient (e.g. salt, house spice mix).
              </span>
            </div>
            {onCreateIngredient && (
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false)
                  onCreateIngredient()
                }}
                className="inline-flex items-center gap-1.5 border-2 border-[var(--ink)] bg-[var(--ink)] px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--paper)] transition hover:bg-[var(--accent-dark)]"
              >
                <Plus className="h-3.5 w-3.5" />
                New ingredient
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>,
    document.body
  )
}

function TabButton({
  active,
  onClick,
  count,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  count?: number
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative -mb-px flex items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1.5 font-mono text-[11px] uppercase tracking-[0.12em] transition",
        active
          ? "border-[var(--ink)] text-[var(--ink)]"
          : "border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]"
      )}
    >
      {icon}
      {children}
      {count != null && (
        <span
          className={cn(
            "tabular-nums",
            active ? "text-[var(--accent)]" : "text-[var(--ink-faint)]"
          )}
        >
          {count}
        </span>
      )}
    </button>
  )
}

function RailItem({
  active,
  onClick,
  count,
  swatch,
  children,
}: {
  active: boolean
  onClick: () => void
  count: number
  swatch: { bg: string } | null
  children: React.ReactNode
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group relative flex w-full items-center gap-2 border-l-2 py-1.5 pl-2.5 pr-2 text-left transition",
          active
            ? "border-[var(--ink)] bg-[var(--paper-deep)]"
            : "border-transparent hover:border-[var(--hairline-bold)] hover:bg-[var(--paper-deep)]/50"
        )}
      >
        {swatch && (
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: swatch.bg }}
          />
        )}
        <span
          className={cn(
            "flex-1 font-mono text-[11px] uppercase tracking-[0.1em]",
            active ? "text-[var(--ink)]" : "text-[var(--ink-muted)]"
          )}
        >
          {children}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-[var(--ink-faint)]">
          {count}
        </span>
      </button>
    </li>
  )
}

function IngredientTile({
  ingredient,
  selected,
  onClick,
}: {
  ingredient: CanonicalIngredientSummary
  selected: boolean
  onClick: () => void
}) {
  const sw = categorySwatch(ingredient.category)
  const price = ingredient.latestUnitCost ?? ingredient.costPerRecipeUnit
  const priceUnit = ingredient.latestUnit ?? ingredient.recipeUnit ?? ingredient.defaultUnit

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex h-[104px] flex-col items-stretch overflow-hidden border-2 bg-[var(--paper)] text-left transition",
        selected
          ? "border-[var(--ink)] shadow-[3px_3px_0_var(--accent)]"
          : "border-[var(--hairline-bold)] hover:border-[var(--ink)] hover:shadow-[3px_3px_0_var(--hairline-bold)]"
      )}
    >
      <div className="flex items-start gap-2.5 px-3 pt-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center font-mono text-[15px] font-bold text-white"
          style={{ background: sw.bg }}
          title={sw.label}
        >
          {sw.letter}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className="line-clamp-2 font-display text-[15px] leading-[1.15] text-[var(--ink)]"
            title={ingredient.name}
          >
            {prettifyIngredientName(ingredient.name)}
          </div>
          <div className="mt-0.5 truncate font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
            {ingredient.category ?? sw.label}
          </div>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between border-t border-dashed border-[var(--hairline)] bg-[var(--paper-deep)]/50 px-3 py-1.5">
        {price != null ? (
          <span className="font-mono text-[11px] tabular-nums text-[var(--ink)]">
            <span className="text-[var(--ink-muted)]">$</span>
            {price.toFixed(2)}
            <span className="ml-0.5 text-[var(--ink-faint)]">/{priceUnit}</span>
          </span>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
            no price
          </span>
        )}
        {selected ? (
          <span className="inline-flex items-center gap-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--accent)]">
            <Check className="h-3 w-3" />
            on recipe
          </span>
        ) : (
          <span className="inline-flex items-center gap-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-muted)] opacity-0 transition-opacity group-hover:opacity-100">
            <Plus className="h-3 w-3" />
            add
          </span>
        )}
      </div>
    </button>
  )
}

function RecentChip({
  ingredient,
  selected,
  onClick,
}: {
  ingredient: CanonicalIngredientSummary
  selected: boolean
  onClick: () => void
}) {
  const sw = categorySwatch(ingredient.category)
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 border bg-[var(--paper)] px-2.5 py-1.5 text-left transition",
        selected
          ? "border-[var(--ink)] bg-[var(--paper-deep)]"
          : "border-[var(--hairline)] hover:border-[var(--ink)]"
      )}
    >
      <span
        aria-hidden
        className="h-5 w-5 shrink-0 text-center font-mono text-[10px] font-bold leading-5 text-white"
        style={{ background: sw.bg }}
      >
        {sw.letter}
      </span>
      <span
        className="truncate font-display text-[13px] leading-tight text-[var(--ink)]"
        title={ingredient.name}
      >
        {prettifyIngredientName(ingredient.name)}
      </span>
    </button>
  )
}

function EmptyState({
  title,
  hint,
  onCreate,
}: {
  title: string
  hint: string
  onCreate?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
        § empty
      </div>
      <h3 className="mt-2 font-display text-[24px] italic leading-tight text-[var(--ink)]">
        {title}
      </h3>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-[var(--ink-muted)]">
        {hint}
      </p>
      {onCreate && (
        <button
          type="button"
          onClick={onCreate}
          className="mt-5 inline-flex items-center gap-1.5 border border-[var(--ink)] bg-[var(--paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink)] transition hover:bg-[var(--ink)] hover:text-[var(--paper)]"
        >
          <Plus className="h-3.5 w-3.5" />
          New ingredient
        </button>
      )}
    </div>
  )
}

function SearchingState() {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
        searching invoices…
      </div>
      <div className="mt-3 flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-[var(--ink)] opacity-30"
            style={{
              animation: "pulse 1.2s ease-in-out infinite",
              animationDelay: `${i * 160}ms`,
            }}
          />
        ))}
      </div>
    </div>
  )
}
