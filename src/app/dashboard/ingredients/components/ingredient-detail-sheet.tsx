"use client"

import {
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  Lock,
  LockOpen,
  Merge,
  Search,
  Tag,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  getIngredientPriceHistory,
  mergeCanonicalIngredients,
  updateCanonicalCost,
} from "@/app/actions/canonical-ingredient-actions"
import {
  categorySwatch,
  prettifyIngredientName,
} from "../../recipes/components/ingredient-picker-utils"
import type {
  CanonicalIngredientSummary,
  IngredientTrend,
} from "@/types/recipe"
import type { IngredientPricePoint } from "@/types/invoice"

const RECIPE_UNIT_OPTIONS = [
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
]

type Props = {
  ingredient: CanonicalIngredientSummary | null
  allIngredients: CanonicalIngredientSummary[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function IngredientDetailSheet({
  ingredient,
  allIngredients,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [unit, setUnit] = useState("")
  const [cost, setCost] = useState("")
  const [locked, setLocked] = useState(false)
  const [saving, startSave] = useTransition()
  const [merging, startMerge] = useTransition()
  const [mergeQuery, setMergeQuery] = useState("")
  const [mergePickerOpen, setMergePickerOpen] = useState(false)
  const [history, setHistory] = useState<IngredientPricePoint[] | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => setMounted(true), [])

  // Fetch price history whenever a different ingredient is opened.
  useEffect(() => {
    if (!ingredient || !open) {
      setHistory(null)
      return
    }
    let cancelled = false
    setHistoryLoading(true)
    getIngredientPriceHistory(ingredient.id, { periodDays: 180 })
      .then((result) => {
        if (!cancelled) setHistory(result.points)
      })
      .catch(() => {
        if (!cancelled) setHistory([])
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [ingredient, open])

  // Re-sync local state whenever a new ingredient is opened.
  useEffect(() => {
    if (ingredient) {
      setUnit(ingredient.recipeUnit ?? "")
      setCost(
        ingredient.costPerRecipeUnit != null
          ? ingredient.costPerRecipeUnit.toString()
          : ""
      )
      setLocked(ingredient.costLocked)
      setMergeQuery("")
      setMergePickerOpen(false)
    }
  }, [ingredient])

  // Lock body scroll + escape to close.
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

  const mergeCandidates = useMemo(() => {
    if (!ingredient) return []
    const q = mergeQuery.trim().toLowerCase()
    const base = allIngredients.filter((c) => c.id !== ingredient.id)
    if (!q) return base.slice(0, 80)
    return base.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 80)
  }, [allIngredients, ingredient, mergeQuery])

  if (!open || !mounted || !ingredient) return null

  const sw = categorySwatch(ingredient.category)
  const hasCost = ingredient.costPerRecipeUnit != null
  const hasInvoice = ingredient.latestUnitCost != null

  function save(next: {
    recipeUnit?: string | null
    costPerRecipeUnit?: number | null
    costLocked?: boolean
  }) {
    if (!ingredient) return
    startSave(async () => {
      try {
        await updateCanonicalCost({
          canonicalIngredientId: ingredient.id,
          ...next,
        })
        toast.success("Saved")
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed")
      }
    })
  }

  function commitCost() {
    if (!ingredient) return
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

  function pickMergeTarget(target: CanonicalIngredientSummary) {
    if (!ingredient) return
    const ok = window.confirm(
      `Merge "${ingredient.name}" into "${target.name}"?\n\n` +
        `All invoice history, aliases, SKU matches, and recipe uses will be re-pointed to "${target.name}". This cannot be undone.`
    )
    if (!ok) return
    setMergePickerOpen(false)
    startMerge(async () => {
      try {
        const result = await mergeCanonicalIngredients({
          sourceId: ingredient.id,
          targetId: target.id,
        })
        toast.success(
          `Merged into "${target.name}" — ${result.lineItems} line item${result.lineItems === 1 ? "" : "s"}, ${result.aliases} alias${result.aliases === 1 ? "" : "es"} moved`
        )
        onOpenChange(false)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Merge failed")
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
        className="absolute right-0 top-0 flex h-full w-full max-w-[640px] flex-col border-l border-[var(--hairline-bold)] bg-[var(--paper)] shadow-[-12px_0_40px_-20px_rgba(26,22,19,0.35)] animate-in slide-in-from-right duration-300"
        style={{
          backgroundImage:
            "radial-gradient(900px 600px at 100% 0%, #fff9ef 0%, transparent 55%), linear-gradient(180deg, var(--paper), var(--paper-deep))",
        }}
      >
        {/* Header */}
        <header className="border-b border-[var(--hairline-bold)] px-7 pb-6 pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center font-mono text-[18px] font-bold text-white"
                style={{ background: sw.bg }}
              >
                {sw.letter}
              </span>
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
                  § ingredient · {sw.label}
                </div>
                <h2 className="mt-1 font-display text-[32px] italic leading-[1.05] tracking-[-0.02em] text-[var(--ink)]">
                  {prettifyIngredientName(ingredient.name)}
                </h2>
                {ingredient.category && (
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                    {ingredient.category}
                  </p>
                )}
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
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* Pricing section */}
          <section className="border-b border-dashed border-[var(--hairline-bold)] px-7 py-6">
            <div className="flex items-baseline justify-between">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
                § pricing
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                {saving
                  ? "saving…"
                  : hasCost
                    ? ingredient.costSource === "manual"
                      ? "set manually"
                      : "from latest invoice"
                    : "not yet priced"}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-[1fr_auto] gap-4">
              <div>
                <label className="block font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                  Cost per recipe unit
                </label>
                <div className="mt-2 flex items-stretch border-2 border-[var(--ink)] bg-[var(--paper)]">
                  <span className="flex items-center px-3 font-mono text-[14px] text-[var(--ink-muted)]">
                    $
                  </span>
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    inputMode="decimal"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    onBlur={commitCost}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur()
                    }}
                    placeholder="0.00"
                    disabled={saving}
                    className="h-11 min-w-0 flex-1 bg-transparent font-display text-[22px] tabular-nums text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none"
                  />
                  <span className="flex items-center px-2 font-mono text-[14px] text-[var(--ink-faint)]">
                    /
                  </span>
                  <select
                    value={unit}
                    onChange={(e) => {
                      const next = e.target.value
                      setUnit(next)
                      const parsedCost =
                        cost.trim() === "" ? null : Number(cost)
                      save({
                        recipeUnit: next.trim() === "" ? null : next.trim(),
                        costPerRecipeUnit:
                          parsedCost != null &&
                          Number.isFinite(parsedCost) &&
                          parsedCost >= 0
                            ? parsedCost
                            : ingredient.costPerRecipeUnit,
                      })
                    }}
                    disabled={saving}
                    className="h-11 border-l border-[var(--hairline)] bg-transparent px-3 font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--ink)] focus:outline-none"
                  >
                    <option value="">pick unit</option>
                    {RECIPE_UNIT_OPTIONS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex flex-col">
                <label className="block font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                  Lock
                </label>
                <button
                  type="button"
                  onClick={toggleLock}
                  disabled={saving}
                  title={
                    locked
                      ? "Locked — invoice matches won't overwrite"
                      : "Unlocked — invoice matches can overwrite this price"
                  }
                  className={cn(
                    "mt-2 flex h-11 w-11 items-center justify-center border-2 transition",
                    locked
                      ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
                      : "border-[var(--hairline-bold)] bg-[var(--paper)] text-[var(--ink-muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
                  )}
                >
                  {locked ? (
                    <Lock className="h-4 w-4" />
                  ) : (
                    <LockOpen className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <p className="mt-3 max-w-md font-mono text-[10px] leading-relaxed text-[var(--ink-muted)]">
              {locked
                ? "Locked: future invoice matches won't change this price. Unlock to let invoice data refresh it automatically."
                : "Unlocked: price will auto-update whenever a matching invoice line arrives. Lock it if a supplier quote should override invoices."}
            </p>
          </section>

          {/* Price history — chart + recent purchases */}
          {hasInvoice && (
            <section className="border-b border-dashed border-[var(--hairline-bold)] px-7 py-6">
              <div className="flex items-baseline justify-between">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
                  § price history
                </div>
                <div className="flex items-center gap-3">
                  {ingredient.trend30d && (
                    <TrendStamp trend={ingredient.trend30d} />
                  )}
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                    last 180 days
                  </div>
                </div>
              </div>

              <div className="mt-5">
                <PriceHistoryChart
                  points={history ?? []}
                  loading={historyLoading}
                />
              </div>

              <div className="mt-6">
                <PriceHistoryReceipts points={history ?? []} />
              </div>
            </section>
          )}

          {/* Aliases */}
          <section className="border-b border-dashed border-[var(--hairline-bold)] px-7 py-6">
            <div className="flex items-baseline justify-between">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
                § how suppliers spell it
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                {ingredient.aliasCount} alias
                {ingredient.aliasCount === 1 ? "" : "es"}
              </div>
            </div>
            <p className="mt-3 flex items-start gap-2 font-mono text-[10px] leading-relaxed text-[var(--ink-muted)]">
              <Tag className="mt-0.5 h-3 w-3 shrink-0 text-[var(--ink-faint)]" />
              <span>
                {ingredient.aliasCount > 0
                  ? `This ingredient answers to ${ingredient.aliasCount} name${ingredient.aliasCount === 1 ? "" : "s"} across your vendors (e.g. "${ingredient.name}").`
                  : "As invoices arrive and match to this ingredient, their product names become searchable aliases."}
              </span>
            </p>
          </section>

          {/* Danger zone */}
          <section className="px-7 py-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-dark)]">
              § merge
            </div>
            <p className="mt-2 max-w-md font-mono text-[10px] leading-relaxed text-[var(--ink-muted)]">
              If this is a duplicate of another ingredient, merge it in — all
              invoice history, aliases, and recipe uses re-point to the target.
              This can&apos;t be undone.
            </p>

            {!mergePickerOpen ? (
              <button
                type="button"
                onClick={() => setMergePickerOpen(true)}
                disabled={merging}
                className="mt-4 inline-flex items-center gap-2 border-2 border-[var(--accent-dark)] bg-[var(--paper)] px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--accent-dark)] transition hover:bg-[var(--accent-dark)] hover:text-[var(--paper)]"
              >
                <Merge className="h-3.5 w-3.5" />
                {merging ? "Merging…" : "Merge into another ingredient"}
              </button>
            ) : (
              <div className="mt-4 border-2 border-[var(--accent-dark)] bg-[var(--paper)]">
                <div className="flex items-center gap-2 border-b border-[var(--accent-dark)]/30 bg-[var(--accent-bg)] px-3 py-2">
                  <Search className="h-3.5 w-3.5 text-[var(--accent-dark)]" />
                  <input
                    value={mergeQuery}
                    onChange={(e) => setMergeQuery(e.target.value)}
                    placeholder="Absorb this ingredient into…"
                    autoFocus
                    className="flex-1 bg-transparent font-display text-[15px] italic text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setMergePickerOpen(false)}
                    className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-muted)] hover:text-[var(--ink)]"
                  >
                    cancel
                  </button>
                </div>
                <ul className="max-h-[260px] overflow-y-auto">
                  {mergeCandidates.length === 0 ? (
                    <li className="px-3 py-4 text-center font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">
                      No matches.
                    </li>
                  ) : (
                    mergeCandidates.map((c) => (
                      <li
                        key={c.id}
                        className="border-b border-[var(--hairline)] last:border-b-0"
                      >
                        <button
                          type="button"
                          onClick={() => pickMergeTarget(c)}
                          className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-[var(--paper-deep)]"
                        >
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--ink-faint)] transition group-hover:text-[var(--accent-dark)]" />
                          <div className="flex-1 truncate">
                            <div className="truncate font-display text-[14px] text-[var(--ink)]">
                              {prettifyIngredientName(c.name)}
                            </div>
                            <div className="truncate font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                              {c.category ?? "other"}
                            </div>
                          </div>
                          {c.latestUnitCost != null && (
                            <span className="font-mono text-[11px] tabular-nums text-[var(--ink-muted)]">
                              ${c.latestUnitCost.toFixed(2)}/{c.latestUnit}
                            </span>
                          )}
                          <Check className="h-3.5 w-3.5 opacity-0" />
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body
  )
}

function TrendStamp({ trend }: { trend: IngredientTrend }) {
  const up = trend.pctChange > 0
  const pct = Math.abs(trend.pctChange)
  return (
    <span
      className={cn(
        "trend-stamp",
        up ? "trend-stamp--up" : "trend-stamp--down"
      )}
      title={`${trend.vendor} · $${trend.baselinePrice.toFixed(2)} → $${trend.latestPrice.toFixed(2)} since ${trend.baselineDate}`}
    >
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {up ? "+" : "−"}
      {pct.toFixed(pct >= 10 ? 0 : 1)}% · 30d
    </span>
  )
}

function PriceHistoryChart({
  points,
  loading,
}: {
  points: IngredientPricePoint[]
  loading: boolean
}) {
  if (loading && points.length === 0) {
    return (
      <div className="price-chart">
        <div className="price-chart__empty">loading receipts…</div>
      </div>
    )
  }
  if (points.length === 0) {
    return (
      <div className="price-chart">
        <div className="price-chart__empty">
          no invoice lines in window
        </div>
      </div>
    )
  }

  // SVG bounds
  const W = 620
  const H = 140
  const padL = 40
  const padR = 12
  const padT = 10
  const padB = 22

  const times = points.map((p) => new Date(p.date).getTime())
  const prices = points.map((p) => p.unitPrice)
  const tMin = Math.min(...times)
  const tMax = Math.max(...times)
  const pMin = Math.min(...prices)
  const pMax = Math.max(...prices)
  // Pad the y-axis 8% on each side so the line doesn't touch the frame.
  const yPad = Math.max((pMax - pMin) * 0.08, pMax * 0.02, 0.01)
  const yLo = Math.max(0, pMin - yPad)
  const yHi = pMax + yPad

  const innerW = W - padL - padR
  const innerH = H - padT - padB

  function x(t: number) {
    if (tMax === tMin) return padL + innerW / 2
    return padL + ((t - tMin) / (tMax - tMin)) * innerW
  }
  function y(p: number) {
    if (yHi === yLo) return padT + innerH / 2
    return padT + (1 - (p - yLo) / (yHi - yLo)) * innerH
  }

  // Group points by vendor so each supplier is its own series.
  const byVendor = new Map<string, IngredientPricePoint[]>()
  for (const pt of points) {
    const arr = byVendor.get(pt.vendor) ?? []
    arr.push(pt)
    byVendor.set(pt.vendor, arr)
  }

  const vendors = Array.from(byVendor.keys())
  const mainVendor = vendors[0]

  // Y-axis ticks (3 labels)
  const yTicks = [yLo, (yLo + yHi) / 2, yHi]
  // X-axis ticks (first + last date)
  const xTicks =
    tMax === tMin
      ? [tMin]
      : [tMin, tMin + (tMax - tMin) / 2, tMax]

  function fmtDate(ms: number) {
    return new Date(ms).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })
  }

  return (
    <div className="price-chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <g className="price-chart__grid">
          {yTicks.map((v, i) => (
            <line key={i} x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} />
          ))}
        </g>
        <g className="price-chart__axis">
          {yTicks.map((v, i) => (
            <text
              key={i}
              x={padL - 6}
              y={y(v) + 3}
              textAnchor="end"
            >
              ${v.toFixed(v >= 10 ? 0 : 2)}
            </text>
          ))}
          {xTicks.map((t, i) => (
            <text
              key={i}
              x={x(t)}
              y={H - 6}
              textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
            >
              {fmtDate(t)}
            </text>
          ))}
        </g>
        {vendors.map((v, idx) => {
          const pts = byVendor.get(v)!
          pts.sort(
            (a, b) =>
              new Date(a.date).getTime() - new Date(b.date).getTime()
          )
          const isAlt = v !== mainVendor && idx > 0
          const d = pts
            .map((pt, i) => {
              const xx = x(new Date(pt.date).getTime())
              const yy = y(pt.unitPrice)
              return `${i === 0 ? "M" : "L"}${xx.toFixed(1)} ${yy.toFixed(1)}`
            })
            .join(" ")
          return (
            <g key={v}>
              <path
                d={d}
                className={cn(
                  "price-chart__line",
                  isAlt && "price-chart__line--alt"
                )}
              />
              {pts.map((pt, i) => (
                <circle
                  key={i}
                  cx={x(new Date(pt.date).getTime())}
                  cy={y(pt.unitPrice)}
                  r={2.75}
                  className={cn(
                    "price-chart__dot",
                    isAlt && "price-chart__dot--alt"
                  )}
                >
                  <title>{`${pt.vendor} · ${pt.date} · $${pt.unitPrice.toFixed(2)}${pt.unit ? `/${pt.unit}` : ""}`}</title>
                </circle>
              ))}
            </g>
          )
        })}
      </svg>
      {vendors.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">
          {vendors.map((v, i) => (
            <span key={v} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-[2px] w-4"
                style={{
                  background: i === 0 ? "var(--ink)" : "var(--accent)",
                  borderTop:
                    i === 0 ? undefined : "1px dashed var(--accent)",
                }}
              />
              {v}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function PriceHistoryReceipts({
  points,
}: {
  points: IngredientPricePoint[]
}) {
  const rows = useMemo(() => {
    // Show most recent first, with Δ vs the prior point from the same vendor
    // (the only fair comparison — a different vendor quote is a different line).
    const sorted = [...points].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    )
    const priorByVendor = new Map<string, number>()
    // Walk oldest→newest to build "previous price by vendor" lookups.
    for (const p of [...sorted].reverse()) {
      const prior = priorByVendor.get(p.vendor)
      ;(p as IngredientPricePoint & { _delta?: number | null })._delta =
        prior != null && prior > 0
          ? ((p.unitPrice - prior) / prior) * 100
          : null
      priorByVendor.set(p.vendor, p.unitPrice)
    }
    return sorted.slice(0, 8) as (IngredientPricePoint & {
      _delta?: number | null
    })[]
  }, [points])

  if (rows.length === 0) return null

  return (
    <div>
      <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
        receipts · last {rows.length}
      </div>
      <div>
        {rows.map((p) => {
          const d = p._delta
          const deltaClass =
            d == null
              ? "ph-row__delta--flat"
              : Math.abs(d) < 0.5
                ? "ph-row__delta--flat"
                : d > 0
                  ? "ph-row__delta--up"
                  : "ph-row__delta--down"
          return (
            <div key={p.invoiceId + p.date + p.unitPrice} className="ph-row">
              <span className="ph-row__date">
                {new Date(p.date).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </span>
              <span className="ph-row__vendor" title={p.vendor}>
                {p.vendor}
                {p.sku ? (
                  <span className="ml-1 text-[var(--ink-faint)]">
                    · {p.sku}
                  </span>
                ) : null}
              </span>
              <span className="ph-row__price">
                ${p.unitPrice.toFixed(2)}
                {p.unit ? (
                  <span className="ml-0.5 text-[var(--ink-faint)]">
                    /{p.unit.toLowerCase()}
                  </span>
                ) : null}
              </span>
              <span className={cn("ph-row__delta", deltaClass)}>
                {d == null
                  ? "—"
                  : `${d > 0 ? "+" : ""}${d.toFixed(d >= 10 || d <= -10 ? 0 : 1)}%`}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
