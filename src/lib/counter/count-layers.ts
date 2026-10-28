import { convertQty } from "@/lib/inventory/usage-math"
import { unitsCompatibleWith } from "@/lib/unit-conversion"

/**
 * The weekly count's arithmetic, in one place. A CountItem is counted in
 * layers, biggest first — "how it comes" (cases), then what is inside
 * (chubs, packs, heads), then loose or opened (lb on the scale, ¼ of a tub).
 * Each layer says what one of it holds, in a lower layer or in a unit, and
 * `resolveLayers` turns that into `per`: recipe units in one. Everything that
 * adds a shelf up goes through `shelfTotal`, so the phone, the report and the
 * saved StockCountLine cannot disagree about what "2 cases + 3 chubs" means.
 */

export const COUNT_AREAS = [
  { id: "walk_in", label: "Walk-in" },
  { id: "freezer", label: "Freezer" },
  { id: "dry", label: "Dry storage" },
  { id: "line", label: "Line" },
] as const
export type CountArea = (typeof COUNT_AREAS)[number]["id"]

export function areaLabel(id: string): string {
  return COUNT_AREAS.find((a) => a.id === id)?.label ?? id
}

export function isCountArea(id: string): id is CountArea {
  return COUNT_AREAS.some((a) => a.id === id)
}

/** What the owner types in setup: one `label` holds `qty` of `of`. */
export interface LayerInput {
  label: string
  qty: number
  /** A lower layer's label, or a unit ("lb", "oz", "each"). */
  of: string
  /** − / + step by ¼ — an open tub, pail or case judged by how full it is. */
  quarters?: boolean
}

export interface Layer extends LayerInput {
  /** Recipe units in one of this layer. */
  per: number
}

export type ResolveResult = { ok: true; layers: Layer[] } | { ok: false; error: string }

/**
 * Works out `per` for every layer, from the bottom up, so "Case holds 4
 * Chubs" can lean on "Chub holds 10 lb" below it. A layer may only point
 * DOWN the list, which is what rules out a loop.
 */
export function resolveLayers(input: LayerInput[], recipeUnit: string): ResolveResult {
  if (input.length === 0) return { ok: false, error: "Add at least one way to count it" }
  if (input.length > 4) return { ok: false, error: "Four layers at most" }
  const out: Layer[] = new Array(input.length)
  for (let i = input.length - 1; i >= 0; i--) {
    const l = input[i]
    const label = l.label.trim()
    if (!label) return { ok: false, error: "Every layer needs a name" }
    if (!(l.qty > 0) || !Number.isFinite(l.qty)) return { ok: false, error: `"${label}" needs a number above 0` }
    const lowerIdx = input.findIndex((o, j) => j > i && o.label.trim().toLowerCase() === l.of.trim().toLowerCase())
    let per: number | null
    if (lowerIdx > i) {
      per = l.qty * out[lowerIdx].per
    } else if (input.some((o, j) => j <= i && o.label.trim().toLowerCase() === l.of.trim().toLowerCase())) {
      return { ok: false, error: `"${label}" can only hold a layer below it` }
    } else {
      const one = convertQty(1, l.of, recipeUnit)
      per = one == null ? null : l.qty * one
    }
    if (per == null || !(per > 0)) {
      return { ok: false, error: `"${label}": can't turn ${l.of} into ${recipeUnit}` }
    }
    out[i] = { label, qty: l.qty, of: l.of.trim(), quarters: Boolean(l.quarters), per }
  }
  return { ok: true, layers: out }
}

/** Reads a stored `layers` column, dropping anything malformed. */
export function parseLayers(raw: unknown): Layer[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((l) => {
    if (!l || typeof l !== "object") return []
    const o = l as Record<string, unknown>
    if (typeof o.label !== "string" || typeof o.per !== "number" || !(o.per > 0)) return []
    return [{
      label: o.label,
      qty: typeof o.qty === "number" ? o.qty : 1,
      of: typeof o.of === "string" ? o.of : "",
      quarters: o.quarters === true,
      per: o.per,
    }]
  })
}

/** One number per layer, as typed. Missing or bad entries count as 0. */
export function shelfTotal(layers: Layer[], values: ReadonlyArray<number | null | undefined>): number {
  let t = 0
  layers.forEach((l, i) => {
    const v = values[i]
    if (typeof v === "number" && Number.isFinite(v) && v > 0) t += v * l.per
  })
  return t
}

export function hasAnyValue(values: ReadonlyArray<number | null | undefined>): boolean {
  return values.some((v) => typeof v === "number" && Number.isFinite(v) && v > 0)
}

/** Units the bottom layer can be in for this ingredient, recipe unit first. */
export function unitChoices(recipeUnit: string): string[] {
  const compat = unitsCompatibleWith(recipeUnit).map(String)
  const all = [recipeUnit, ...compat.filter((u) => u !== recipeUnit)]
  return all.length ? all : [recipeUnit]
}

/**
 * The single layer an item starts with: loose, in the recipe unit — except
 * ounces of a solid, which nobody weighs a shelf in, so those start in lb.
 */
export function defaultLayers(recipeUnit: string): Layer[] {
  if (recipeUnit.trim().toLowerCase() === "oz") {
    return [{ label: "Loose (lb)", qty: 1, of: "lb", quarters: false, per: 16 }]
  }
  return [{ label: `Loose (${recipeUnit})`, qty: 1, of: recipeUnit, quarters: false, per: 1 }]
}

/** Area a new item lands in, from its supplier category. */
export function guessArea(category: string | null): CountArea {
  const c = (category ?? "").toLowerCase()
  if (/frozen|freez/.test(c)) return "freezer"
  if (/paper|suppl|dry|bev|disposable|packag|chemical|clean/.test(c)) return "dry"
  return "walk_in"
}

export function fmtQty(n: number): string {
  const r = Math.round(n * 100) / 100
  return r.toLocaleString("en-US", { maximumFractionDigits: 2 })
}

/** Ounces of a solid read better as pounds on a shelf: 1,512 oz is 94.5 lb. */
export function showQty(qty: number, unit: string): string {
  if (unit.trim().toLowerCase() === "oz" && Math.abs(qty) >= 16) return `${fmtQty(qty / 16)} lb`
  return `${fmtQty(qty)} ${unit}`
}

/** "2 Cases + 3 Loose chubs" — what was typed, for the count record. */
export function describeShelf(layers: Layer[], values: ReadonlyArray<number | null | undefined>): string {
  const parts = layers.flatMap((l, i) => {
    const v = values[i]
    return typeof v === "number" && v > 0 ? [`${fmtQty(v)} ${l.label}`] : []
  })
  return parts.length ? parts.join(" + ") : "0"
}

export const WASTE_REASONS = [
  { id: "DROPPED", label: "Dropped" },
  { id: "EXPIRY", label: "Went bad" },
  { id: "BURNT", label: "Burnt" },
  { id: "REMAKE", label: "Remake" },
  { id: "OTHER", label: "Other" },
] as const
export type WasteReason = (typeof WASTE_REASONS)[number]["id"]

export function wasteReasonLabel(id: string): string {
  return WASTE_REASONS.find((r) => r.id === id)?.label ?? id.charAt(0) + id.slice(1).toLowerCase().replace(/_/g, " ")
}
