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
  ArrowRight,
  Check,
  ChevronRight,
  Plus,
  Receipt,
  Search,
  Sparkles,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  bucketFor,
  CATEGORY_BUCKETS,
  categorySwatch,
  prettifyIngredientName,
  type CategoryBucket,
} from "../../recipes/components/ingredient-picker-utils"
import {
  confirmSkuMatch,
  type UnmatchedLineItemGroup,
} from "@/app/actions/ingredient-match-actions"
import type { CanonicalIngredientSummary } from "@/types/recipe"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: UnmatchedLineItemGroup | null
  canonicals: CanonicalIngredientSummary[]
  onMatched: (key: string, newCanonicalId: string) => void
  onCanonicalCreated: (created: CanonicalIngredientSummary) => void
}

const DEFAULT_UNIT_OPTIONS = [
  "lb",
  "oz",
  "g",
  "kg",
  "gal",
  "qt",
  "pt",
  "cup",
  "fl oz",
  "ml",
  "l",
  "each",
  "dz",
  "unit",
]

export function MatchPickerSheet({
  open,
  onOpenChange,
  group,
  canonicals,
  onMatched,
  onCanonicalCreated,
}: Props) {
  const [mounted, setMounted] = useState(false)
  const [query, setQuery] = useState("")
  const [bucket, setBucket] = useState<CategoryBucket | "All">("All")
  const [linking, setLinking] = useState<string | null>(null)
  const [creating, startCreate] = useTransition()
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState("")
  const [newUnit, setNewUnit] = useState("")
  const [newCategory, setNewCategory] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => setMounted(true), [])

  // Reset transient state on open.
  useEffect(() => {
    if (open && group) {
      setQuery("")
      setBucket("All")
      setShowCreate(false)
      setNewName(prettifyIngredientName(group.productName))
      setNewUnit(group.unit ?? "")
      setNewCategory("")
      setError(null)
      setLinking(null)
      const t = setTimeout(() => searchRef.current?.focus(), 80)
      return () => clearTimeout(t)
    }
  }, [open, group])

  // Lock body scroll + escape.
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

  // Smart-suggest: rank canonicals by token overlap with the raw product name.
  const suggestions = useMemo(() => {
    if (!group) return []
    const productTokens = tokenSet(prettifyIngredientName(group.productName))
    if (productTokens.size === 0) return []
    const scored = canonicals
      .map((c) => {
        const nameTokens = tokenSet(c.name)
        if (nameTokens.size === 0) return { c, score: 0 }
        const overlap = [...productTokens].filter((t) =>
          nameTokens.has(t)
        ).length
        const score = overlap / Math.max(productTokens.size, nameTokens.size)
        return { c, score }
      })
      .filter((x) => x.score > 0.25)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
    return scored.map((x) => x.c)
  }, [canonicals, group])

  const suggestionIds = useMemo(
    () => new Set(suggestions.map((c) => c.id)),
    [suggestions]
  )

  const bucketCounts = useMemo(() => {
    const counts = new Map<CategoryBucket, number>()
    canonicals.forEach((c) => {
      const b = bucketFor(c.category)
      counts.set(b, (counts.get(b) ?? 0) + 1)
    })
    return counts
  }, [canonicals])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return canonicals
      .filter((c) => {
        if (bucket !== "All" && bucketFor(c.category) !== bucket) return false
        if (q) {
          const pretty = prettifyIngredientName(c.name).toLowerCase()
          if (!c.name.toLowerCase().includes(q) && !pretty.includes(q)) {
            return false
          }
        }
        // Hide items already shown in suggestions (no search, no filter applied)
        if (
          !q &&
          bucket === "All" &&
          suggestionIds.has(c.id)
        ) {
          return false
        }
        return true
      })
      .slice(0, 400)
  }, [canonicals, query, bucket, suggestionIds])

  if (!open || !mounted || !group) return null

  async function pickExisting(c: CanonicalIngredientSummary) {
    if (!group) return
    setError(null)
    setLinking(c.id)
    try {
      const result = await confirmSkuMatch({
        lineItemId: group.sampleLineItemId,
        canonicalIngredientId: c.id,
      })
      onMatched(group.key, result.canonicalIngredientId)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Match failed")
    } finally {
      setLinking(null)
    }
  }

  function createAndMatch() {
    if (!group) return
    const name = newName.trim() || group.productName
    const unit = newUnit.trim() || group.unit || "unit"
    const category = newCategory.trim() || null
    setError(null)
    startCreate(async () => {
      try {
        const result = await confirmSkuMatch({
          lineItemId: group.sampleLineItemId,
          newCanonical: { name, defaultUnit: unit, category },
        })
        onCanonicalCreated({
          id: result.canonicalIngredientId,
          name,
          defaultUnit: unit,
          category,
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
          trend30d: null,
        })
        onMatched(group.key, result.canonicalIngredientId)
        onOpenChange(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Create failed")
      }
    })
  }

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

  const displayName = prettifyIngredientName(group.productName)

  return createPortal(
    <div
      className="fixed inset-0 z-[100]"
      aria-modal="true"
      role="dialog"
      style={editorialVars}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 bg-[#1a1613]/35 backdrop-blur-[2px] animate-in fade-in duration-200"
      />

      <div
        className="absolute right-0 top-0 flex h-full w-full max-w-[720px] flex-col border-l border-[var(--hairline-bold)] bg-[var(--paper)] shadow-[-12px_0_40px_-20px_rgba(26,22,19,0.35)] animate-in slide-in-from-right duration-300"
        style={{
          backgroundImage:
            "radial-gradient(900px 600px at 100% 0%, #fff9ef 0%, transparent 55%), linear-gradient(180deg, var(--paper), var(--paper-deep))",
        }}
      >
        {/* Header — what we're matching */}
        <header className="border-b border-[var(--hairline-bold)] px-7 pb-5 pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center border border-[var(--accent-dark)]/30 bg-[var(--accent-bg)] text-[var(--accent-dark)]">
                <Receipt className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-dark)]">
                  § match invoice item
                </div>
                <h2
                  className="mt-1 truncate font-display text-[30px] italic leading-[1.05] tracking-[-0.02em] text-[var(--ink)]"
                  title={group.productName}
                >
                  {displayName}
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  <span>{group.vendorName}</span>
                  {group.sku && (
                    <>
                      <span className="text-[var(--ink-faint)]">·</span>
                      <span>SKU {group.sku}</span>
                    </>
                  )}
                  <span className="text-[var(--ink-faint)]">·</span>
                  <span>
                    ${group.totalSpend.toFixed(0)} · {group.occurrences}×
                  </span>
                  {group.derivedCostPreview && (
                    <>
                      <span className="text-[var(--ink-faint)]">·</span>
                      <span>
                        ~$
                        {group.derivedCostPreview.costPerBase.toFixed(2)}/
                        {group.derivedCostPreview.baseUnit}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex h-9 w-9 shrink-0 items-center justify-center border border-[var(--hairline-bold)] bg-[var(--paper)] text-[var(--ink-muted)] transition hover:border-[var(--ink)] hover:text-[var(--ink)]"
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
              placeholder="Search your pantry for a match…"
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
        </header>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Category rail */}
          <nav className="w-[170px] shrink-0 overflow-y-auto border-r border-[var(--hairline)] bg-[var(--paper)]/50 px-3 py-5">
            <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
              Stations
            </div>
            <ul className="mt-3 space-y-0.5">
              <RailItem
                active={bucket === "All"}
                onClick={() => setBucket("All")}
                count={canonicals.length}
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

          {/* Match surface */}
          <div className="flex-1 overflow-y-auto">
            {/* Smart suggestions — only when no search/filter */}
            {suggestions.length > 0 && !query && bucket === "All" && (
              <section className="border-b border-dashed border-[var(--hairline-bold)] px-6 pb-5 pt-5">
                <div className="mb-3 flex items-baseline justify-between">
                  <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                    <Sparkles className="h-3 w-3 text-[var(--accent-dark)]" />
                    Probably one of these
                  </div>
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                    from the name
                  </span>
                </div>
                <ul className="grid grid-cols-1 gap-2">
                  {suggestions.map((c) => (
                    <SuggestionCard
                      key={c.id}
                      ingredient={c}
                      busy={linking === c.id}
                      onPick={() => pickExisting(c)}
                    />
                  ))}
                </ul>
              </section>
            )}

            {/* Main list */}
            <section className="px-6 py-5">
              {filtered.length === 0 && suggestions.length === 0 ? (
                <div className="mx-auto max-w-sm border border-dashed border-[var(--hairline)] px-6 py-12 text-center">
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
                    § nothing here
                  </div>
                  <h3 className="mt-3 font-display text-[22px] italic leading-tight text-[var(--ink)]">
                    {query
                      ? `Nothing matches "${query}".`
                      : "No ingredients yet."}
                  </h3>
                  <p className="mt-3 font-mono text-[10px] leading-relaxed text-[var(--ink-muted)]">
                    Create a new one below — we&apos;ll link this invoice line
                    and remember the (vendor, SKU) for next time.
                  </p>
                </div>
              ) : filtered.length === 0 ? (
                <p className="py-6 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                  Everything matching is up top.
                </p>
              ) : (
                <>
                  {suggestions.length > 0 && !query && bucket === "All" && (
                    <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                      Or pick another
                    </div>
                  )}
                  <ul className="grid grid-cols-1 gap-1.5">
                    {filtered.map((c) => (
                      <RowCard
                        key={c.id}
                        ingredient={c}
                        busy={linking === c.id}
                        onPick={() => pickExisting(c)}
                      />
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>
        </div>

        {/* Create-new footer */}
        <footer className="border-t border-[var(--hairline-bold)] bg-[var(--paper-deep)]">
          {showCreate ? (
            <div className="px-7 py-5">
              <div className="flex items-baseline justify-between">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-dark)]">
                  § new ingredient
                </div>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                >
                  cancel
                </button>
              </div>
              <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-3">
                <label className="flex flex-col">
                  <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                    Name
                  </span>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Mozzarella Cheese"
                    className="mt-1.5 h-10 border-2 border-[var(--ink)] bg-[var(--paper)] px-3 font-display text-[16px] italic text-[var(--ink)] focus:outline-none"
                  />
                </label>
                <label className="flex flex-col">
                  <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                    Default unit
                  </span>
                  <select
                    value={newUnit}
                    onChange={(e) => setNewUnit(e.target.value)}
                    className="mt-1.5 h-10 border-2 border-[var(--ink)] bg-[var(--paper)] px-3 font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--ink)] focus:outline-none"
                  >
                    <option value="">pick unit</option>
                    {DEFAULT_UNIT_OPTIONS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col">
                  <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                    Category
                  </span>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="mt-1.5 h-10 border-2 border-[var(--hairline-bold)] bg-[var(--paper)] px-3 font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--ink)] focus:outline-none"
                  >
                    <option value="">(optional)</option>
                    {CATEGORY_BUCKETS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {error && (
                <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--accent-dark)]">
                  {error}
                </div>
              )}
              <div className="mt-4 flex items-center justify-between gap-4">
                <p className="max-w-sm font-mono text-[10px] leading-relaxed text-[var(--ink-muted)]">
                  Creating links this invoice line now and remembers the (vendor
                  + SKU) so future invoices auto-match.
                </p>
                <button
                  type="button"
                  onClick={createAndMatch}
                  disabled={creating || !newName.trim()}
                  className="inline-flex items-center gap-2 border-2 border-[var(--ink)] bg-[var(--ink)] px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--paper)] transition hover:bg-[var(--accent-dark)] disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {creating ? "Creating…" : "Create & match"}
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4 px-7 py-4">
              <div className="font-mono text-[10px] uppercase leading-snug tracking-[0.12em] text-[var(--ink-muted)]">
                Don&apos;t see it?
                <br />
                <span className="text-[var(--ink-faint)]">
                  Create a new pantry ingredient from this invoice line.
                </span>
              </div>
              {error && !showCreate && (
                <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--accent-dark)]">
                  {error}
                </div>
              )}
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="inline-flex items-center gap-1.5 border-2 border-[var(--ink)] bg-[var(--ink)] px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--paper)] transition hover:bg-[var(--accent-dark)]"
              >
                <Plus className="h-3.5 w-3.5" />
                Create new
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>,
    document.body
  )
}

function SuggestionCard({
  ingredient,
  busy,
  onPick,
}: {
  ingredient: CanonicalIngredientSummary
  busy: boolean
  onPick: () => void
}) {
  const sw = categorySwatch(ingredient.category)
  const cost = ingredient.costPerRecipeUnit ?? ingredient.latestUnitCost
  const unit =
    ingredient.recipeUnit ?? ingredient.latestUnit ?? ingredient.defaultUnit

  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        disabled={busy}
        className="group flex w-full items-center gap-3 border-2 border-[var(--hairline-bold)] bg-[var(--paper)] px-3.5 py-3 text-left transition hover:border-[var(--ink)] hover:shadow-[3px_3px_0_var(--accent)] disabled:opacity-60"
      >
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center font-mono text-[14px] font-bold text-(--paper)"
          style={{ background: sw.bg }}
        >
          {sw.letter}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className="truncate font-display text-[17px] italic leading-tight text-[var(--ink)]"
            title={ingredient.name}
          >
            {prettifyIngredientName(ingredient.name)}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
            <span>{ingredient.category ?? sw.label}</span>
            {ingredient.aliasCount > 0 && (
              <>
                <span>·</span>
                <span>
                  {ingredient.aliasCount} alias
                  {ingredient.aliasCount === 1 ? "" : "es"}
                </span>
              </>
            )}
          </div>
        </div>
        {cost != null && (
          <div className="text-right">
            <div className="font-mono text-[13px] tabular-nums text-[var(--ink)]">
              ${cost.toFixed(2)}
            </div>
            <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
              /{unit}
            </div>
          </div>
        )}
        <ChevronRight className="h-4 w-4 shrink-0 text-[var(--ink-faint)] transition group-hover:translate-x-0.5 group-hover:text-[var(--accent-dark)]" />
      </button>
    </li>
  )
}

function RowCard({
  ingredient,
  busy,
  onPick,
}: {
  ingredient: CanonicalIngredientSummary
  busy: boolean
  onPick: () => void
}) {
  const sw = categorySwatch(ingredient.category)
  const cost = ingredient.costPerRecipeUnit ?? ingredient.latestUnitCost
  const unit =
    ingredient.recipeUnit ?? ingredient.latestUnit ?? ingredient.defaultUnit

  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        disabled={busy}
        className="group flex w-full items-center gap-2.5 border border-[var(--hairline)] bg-[var(--paper)]/80 px-3 py-2 text-left transition hover:border-[var(--ink)] hover:bg-[var(--paper)] disabled:opacity-60"
      >
        <span
          aria-hidden
          className="h-6 w-6 shrink-0 text-center font-mono text-[11px] font-bold leading-6 text-(--paper)"
          style={{ background: sw.bg }}
        >
          {sw.letter}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className="truncate font-display text-[14px] leading-tight text-[var(--ink)]"
            title={ingredient.name}
          >
            {prettifyIngredientName(ingredient.name)}
          </div>
        </div>
        {cost != null && (
          <span className="font-mono text-[11px] tabular-nums text-[var(--ink-muted)]">
            ${cost.toFixed(2)}
            <span className="text-[var(--ink-faint)]">/{unit}</span>
          </span>
        )}
        {busy ? (
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
            linking…
          </span>
        ) : (
          <Check className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100 group-hover:text-[var(--accent-dark)]" />
        )}
      </button>
    </li>
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
            "flex-1 font-mono text-[10px] uppercase tracking-[0.1em]",
            active ? "text-[var(--ink)]" : "text-[var(--ink-muted)]"
          )}
        >
          {children}
        </span>
        <span className="font-mono text-[9px] tabular-nums text-[var(--ink-faint)]">
          {count}
        </span>
      </button>
    </li>
  )
}

function tokenSet(s: string): Set<string> {
  const tokens = s
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
  // Drop common pack/size/noise words so they don't inflate overlap.
  const noise = new Set([
    "bag",
    "box",
    "case",
    "can",
    "ctn",
    "jar",
    "pack",
    "pkt",
    "cnt",
    "count",
    "carton",
    "tray",
    "bunch",
    "each",
    "dozen",
    "the",
    "and",
    "for",
    "with",
    "fresh",
    "frozen",
  ])
  return new Set(tokens.filter((t) => !noise.has(t)))
}
