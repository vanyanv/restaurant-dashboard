"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  Clock,
  Loader2,
  Utensils,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { marginBandClass } from "@/lib/menu-margin"
import { ProvenanceChip } from "@/components/recipe/provenance-chip"
import { getRecipeDetail } from "@/app/actions/recipe-actions"
import type { RecipeCostLine, RecipeCostResult } from "@/lib/recipe-cost"

type RecipeMeta = {
  id: string
  itemName: string
  category: string
  isConfirmed: boolean
  isSellable: boolean
  servingSize: number
  notes: string | null
  updatedAt: Date | string
  ingredientCount: number
  computedCost: number | null
  partialCost: boolean
}

type SellInfo = {
  avgPrice: number
  qtySold: number
  sourceOtterName: string
} | null

type Detail = NonNullable<Awaited<ReturnType<typeof getRecipeDetail>>>

type Props = {
  recipe: RecipeMeta
  cost: RecipeCostResult | null
  sell: SellInfo
}

export function MenuItemDetailView({ recipe, cost, sell }: Props) {
  const sellPrice = sell?.avgPrice ?? null
  const foodCost = recipe.computedCost
  const marginPct =
    foodCost != null && sellPrice != null && sellPrice > 0
      ? ((sellPrice - foodCost) / sellPrice) * 100
      : null
  const profitPerUnit =
    foodCost != null && sellPrice != null ? sellPrice - foodCost : null
  const profit30d =
    profitPerUnit != null && sell ? profitPerUnit * sell.qtySold : null

  const updatedLabel = useMemo(() => formatUpdated(recipe.updatedAt), [
    recipe.updatedAt,
  ])

  return (
    <div className="editorial-surface min-h-[calc(100vh-3.5rem)]">
      {/* Top nav rail */}
      <div className="border-b border-[var(--hairline)] bg-[var(--paper)] px-8 py-3">
        <div className="flex items-center justify-between">
          <Link
            href="/dashboard/menu/catalog"
            className="group inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)] transition hover:text-[var(--ink)]"
          >
            <ArrowLeft className="h-3 w-3 transition group-hover:-translate-x-0.5" />
            Back to menu
          </Link>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            § 12 · Menu · Recipe
          </span>
        </div>
      </div>

      {/* Editorial hero */}
      <section className="relative border-b border-[var(--hairline-bold)] bg-[var(--paper)] px-8 pt-10 pb-12">
        <div className="mx-auto max-w-[1180px]">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-faint)]">
                <span className="inline-block h-[3px] w-[3px] rotate-45 bg-[var(--ink-muted)]" />
                <span>§ recipe</span>
                <span className="text-[var(--ink-muted)]">·</span>
                <span className="text-[var(--ink-muted)]">{recipe.category}</span>
              </div>
              <h1 className="mt-3 font-display text-[clamp(36px,6vw,64px)] italic leading-[1.02] tracking-[-0.02em] text-[var(--ink)]">
                {recipe.itemName}
              </h1>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {recipe.computedCost == null ? (
                  <StatusBadge tone="loud" icon={AlertTriangle} label="Missing cost" />
                ) : recipe.partialCost ? (
                  <StatusBadge tone="warn" icon={AlertTriangle} label="Partial recipe" />
                ) : (
                  <StatusBadge tone="calm" icon={CheckCircle2} label="Fully costed" />
                )}
                {recipe.isConfirmed && (
                  <StatusBadge tone="ink" icon={CheckCircle2} label="Confirmed" />
                )}
                {!recipe.isSellable && (
                  <StatusBadge tone="ink" icon={Utensils} label="Not sellable" />
                )}
                {sell?.sourceOtterName && sell.sourceOtterName !== recipe.itemName && (
                  <span
                    title={`Sell price derived from Otter item: ${sell.sourceOtterName}`}
                    className="inline-flex items-center gap-1 border border-[var(--hairline-bold)] bg-[var(--paper-deep)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-muted)]"
                  >
                    via &ldquo;{sell.sourceOtterName}&rdquo;
                  </span>
                )}
              </div>
            </div>
            <div className="hidden shrink-0 flex-col items-end gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)] md:flex">
              <Clock className="h-3 w-3" />
              <span>{updatedLabel}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Stat rail */}
      <section className="border-b border-[var(--hairline-bold)] bg-[var(--paper-deep)]">
        <div className="mx-auto grid max-w-[1180px] grid-cols-2 gap-px bg-[var(--hairline)] md:grid-cols-5">
          <Stat
            eyebrow="Sell price"
            value={sellPrice != null ? formatCurrency(sellPrice) : "—"}
            foot={sell?.qtySold ? `sales-weighted · ${sell.qtySold.toLocaleString()} sold (30d)` : "no Otter price in 30d"}
          />
          <Stat
            eyebrow="Food cost"
            value={foodCost != null ? formatCurrency(foodCost) : "—"}
            foot={
              recipe.partialCost && foodCost != null
                ? "partial — some ingredients unpriced"
                : recipe.computedCost == null
                  ? "no ingredients priced"
                  : "fully resolved"
            }
          />
          <Stat
            eyebrow="Margin"
            value={marginPct != null ? `${marginPct.toFixed(1)}%` : "—"}
            valueTone={marginBandClass(marginPct)}
            foot="of sell price"
          />
          <Stat
            eyebrow="Profit per unit"
            value={profitPerUnit != null ? formatCurrency(profitPerUnit) : "—"}
            foot="sell − cost"
          />
          <Stat
            eyebrow="Profit · 30d"
            value={profit30d != null ? `$${Math.round(profit30d).toLocaleString()}` : "—"}
            foot={sell ? `over ${sell.qtySold.toLocaleString()} units` : "no sales data"}
          />
        </div>
      </section>

      {/* Body */}
      <section className="bg-[var(--paper)] px-8 py-10">
        <div className="mx-auto grid max-w-[1180px] gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
          {/* Left: ingredients */}
          <div>
            <EyebrowRule label="Ingredients" trailing={
              cost ? `total ${formatCurrency(cost.totalCost, 4)}` : null
            } />

            {cost == null ? (
              <div className="mt-6 border border-dashed border-[var(--hairline-bold)] px-6 py-10 text-center font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                This recipe has no ingredients attached yet.
              </div>
            ) : (
              <IngredientTree result={cost} />
            )}
          </div>

          {/* Right: sidebar */}
          <aside className="space-y-8 lg:border-l lg:border-[var(--hairline)] lg:pl-10">
            {recipe.notes && (
              <div>
                <EyebrowRule label="Notes" />
                <p className="mt-3 whitespace-pre-line font-serif text-[15px] leading-relaxed text-[var(--ink)]">
                  {recipe.notes}
                </p>
              </div>
            )}

            <div>
              <EyebrowRule label="At a glance" />
              <dl className="mt-3 divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]">
                <MetaRow
                  k="Category"
                  v={recipe.category}
                />
                <MetaRow
                  k="Ingredients"
                  v={`${recipe.ingredientCount}`}
                />
                <MetaRow
                  k="Serving size"
                  v={`${recipe.servingSize}`}
                />
                <MetaRow
                  k="Units sold (30d)"
                  v={sell ? sell.qtySold.toLocaleString() : "—"}
                />
                <MetaRow
                  k="Updated"
                  v={updatedLabel}
                />
                <MetaRow
                  k="Status"
                  v={recipe.isConfirmed ? "Confirmed" : "Draft"}
                />
              </dl>
            </div>

            <div>
              <EyebrowRule label="Actions" />
              <div className="mt-3 space-y-2">
                <Link
                  href={`/dashboard/recipes?recipe=${recipe.id}`}
                  className="group flex items-center justify-between border border-[var(--ink)] bg-[var(--paper)] px-4 py-3 transition hover:bg-[var(--ink)] hover:text-[var(--paper)]"
                >
                  <span className="font-mono text-[11px] uppercase tracking-[0.14em]">
                    Edit in recipe builder
                  </span>
                  <ArrowUpRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </Link>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </div>
  )
}

// ---- subcomponents ------------------------------------------------------

function EyebrowRule({
  label,
  trailing,
}: {
  label: string
  trailing?: string | null
}) {
  return (
    <div className="flex items-baseline justify-between border-b border-[var(--hairline-bold)] pb-1">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-faint)]">
        {label}
      </h3>
      {trailing && (
        <span className="font-mono text-[11px] tabular-nums text-[var(--ink-muted)]">
          {trailing}
        </span>
      )}
    </div>
  )
}

function StatusBadge({
  tone,
  icon: Icon,
  label,
}: {
  tone: "loud" | "warn" | "calm" | "ink"
  icon: React.ElementType
  label: string
}) {
  const cls =
    tone === "loud"
      ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--paper)]"
      : tone === "warn"
        ? "border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent-dark)]"
        : tone === "calm"
          ? "border-emerald-700/60 bg-emerald-50 text-emerald-900"
          : "border-[var(--hairline-bold)] bg-[var(--paper)] text-[var(--ink-muted)]"
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em]",
        cls
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {label}
    </span>
  )
}

function Stat({
  eyebrow,
  value,
  valueTone,
  foot,
}: {
  eyebrow: string
  value: string
  valueTone?: string
  foot?: string
}) {
  return (
    <div className="flex flex-col gap-1.5 bg-[var(--paper)] px-6 py-5">
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-faint)]">
        {eyebrow}
      </div>
      <div
        className={cn(
          "font-mono text-[26px] leading-none tabular-nums",
          valueTone ?? "text-[var(--ink)]"
        )}
      >
        {value}
      </div>
      {foot && (
        <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
          {foot}
        </div>
      )}
    </div>
  )
}

function MetaRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between py-2">
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
        {k}
      </dt>
      <dd className="font-mono text-[12px] tabular-nums text-[var(--ink)]">{v}</dd>
    </div>
  )
}

// ---- ingredient tree ----------------------------------------------------

// Client-side cache of loaded sub-recipe details so expanding re-renders don't
// refetch.
const subRecipeCache = new Map<string, Detail>()

function IngredientTree({ result }: { result: RecipeCostResult }) {
  const total = Math.max(result.totalCost, 1e-9)
  return (
    <ul className="mt-2 divide-y divide-[var(--hairline)] border-b border-[var(--hairline)]">
      {result.lines.map((ln, i) => (
        <LineRow
          key={`${ln.refId}-${i}`}
          line={ln}
          depth={0}
          parentTotal={total}
        />
      ))}
    </ul>
  )
}

function LineRow({
  line,
  depth,
  parentTotal,
}: {
  line: RecipeCostLine
  depth: number
  parentTotal: number
}) {
  const [expanded, setExpanded] = useState(depth < 1)
  const isComponent = line.kind === "component"
  const indentPx = depth * 14
  const sharePct =
    parentTotal > 0 && !line.missingCost ? (line.lineCost / parentTotal) * 100 : 0

  return (
    <li>
      <div
        className={cn(
          "grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_90px_120px]",
          depth === 0 && "items-start"
        )}
        style={{ paddingLeft: indentPx }}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-1.5">
            {isComponent && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="flex h-4 w-4 items-center justify-center text-[var(--ink-faint)] hover:text-[var(--ink)]"
                aria-label={expanded ? "Collapse component" : "Expand component"}
              >
                <BookOpen className="h-3 w-3" />
              </button>
            )}
            <span
              className={cn(
                "break-words",
                isComponent
                  ? "font-display text-[16px] italic leading-snug text-[var(--ink)]"
                  : "text-[14px] text-[var(--ink)]"
              )}
            >
              {line.name}
            </span>
            {line.missingCost && (
              <span className="inline-flex items-center gap-1 border border-[var(--accent)] bg-[var(--accent-bg)] px-1 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--accent-dark)]">
                no cost
              </span>
            )}
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">
            {formatQty(line.quantity)} {line.unit}
            {!isComponent && line.unitCost != null && line.costUnit && (
              <> · {formatCurrency(line.unitCost, 4)}/{line.costUnit}</>
            )}
          </div>
          {depth === 0 && sharePct > 0 && (
            <div className="mt-2 h-[3px] w-full max-w-[260px] bg-[var(--hairline)]">
              <div
                className="h-full bg-[var(--ink)]"
                style={{ width: `${Math.min(100, sharePct).toFixed(2)}%` }}
              />
            </div>
          )}
        </div>
        <div className="flex items-center font-mono text-[11px] tabular-nums text-[var(--ink)] md:justify-end">
          {line.missingCost ? (
            <span className="text-[var(--ink-faint)]">—</span>
          ) : (
            <span>{formatCurrency(line.lineCost, 4)}</span>
          )}
        </div>
        <div className="flex items-center md:justify-end">
          <ProvenanceChip line={line} />
        </div>
      </div>
      {isComponent && expanded && (
        <SubRecipe
          componentRecipeId={line.refId}
          depth={depth + 1}
          parentTotal={parentTotal}
        />
      )}
    </li>
  )
}

function SubRecipe({
  componentRecipeId,
  depth,
  parentTotal,
}: {
  componentRecipeId: string
  depth: number
  parentTotal: number
}) {
  const [detail, setDetail] = useState<Detail | null>(() =>
    subRecipeCache.get(componentRecipeId) ?? null
  )
  const [loading, setLoading] = useState(!detail)

  useEffect(() => {
    if (detail) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const res = await getRecipeDetail(componentRecipeId)
      if (cancelled || !res) return
      subRecipeCache.set(componentRecipeId, res)
      setDetail(res)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [componentRecipeId, detail])

  if (loading) {
    return (
      <div
        className="flex items-center gap-2 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)]"
        style={{ paddingLeft: depth * 14 + 16 }}
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading…
      </div>
    )
  }
  if (!detail?.cost) return null

  return (
    <ul className="border-t border-[var(--hairline)] bg-[var(--paper-deep)]/40">
      {detail.cost.lines.map((ln, i) => (
        <LineRow
          key={`${ln.refId}-${i}`}
          line={ln}
          depth={depth}
          parentTotal={parentTotal}
        />
      ))}
    </ul>
  )
}

// ---- utils --------------------------------------------------------------

function formatCurrency(n: number, digits = 2): string {
  const prefix = n < 0 ? "-$" : "$"
  return `${prefix}${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`
}

function formatQty(n: number): string {
  if (Number.isInteger(n)) return n.toString()
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  })
}

function formatUpdated(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d
  const diffMs = Date.now() - date.getTime()
  const day = 86400 * 1000
  const days = Math.round(diffMs / day)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 30) return `${days} days ago`
  if (days < 365) return `${Math.round(days / 30)} months ago`
  return `${Math.round(days / 365)} years ago`
}
