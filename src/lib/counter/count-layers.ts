import { convertQty } from "@/lib/inventory/usage-math"
import { unitsCompatibleWith } from "@/lib/unit-conversion"
import { WASTE_LOG_REASONS, reasonLabel } from "@/lib/counter/waste-reasons"

/**
 * The weekly count's arithmetic, in one place. A CountItem is counted in
 * layers, biggest first — "how it comes" (cases), then what is inside
 * (chubs, packs, heads), then loose or opened (lb on the scale, ¼ of a tub).
 * Each layer says what one of it holds, in a lower layer or in a unit, and
 * `resolveLayers` turns that into `per`: recipe units in one. Everything that
 * adds a shelf up goes through `shelfTotal`, so the phone, the report and the
 * saved StockCountLine cannot disagree about what "2 cases + 3 chubs" means.
 */

/**
 * The sections of the count, in the owner's walk order: the same six as the
 * owner's Inventory sheet, so the phone and the sheet read alike.
 */
export const COUNT_AREAS = [
  { id: "frozen", label: "Frozen" },
  { id: "fridge", label: "Refrigeration" },
  { id: "dry", label: "Dry storage" },
  { id: "drinks", label: "Drinks" },
  { id: "packaging", label: "Packaging" },
  { id: "cleaning", label: "Cleaning & paper" },
] as const
export type CountArea = (typeof COUNT_AREAS)[number]["id"]

/** The first four sections the count shipped with, and where each now lives. */
const LEGACY_AREAS: Record<string, CountArea> = { freezer: "frozen", walk_in: "fridge", line: "fridge" }

/** A stored area id as one of today's sections (old rows say "walk_in"). */
export function normalizeArea(id: string): string {
  return LEGACY_AREAS[id] ?? id
}

/** Every stored area id that shows as this section, old ids included. */
export function storedAreasFor(id: string): string[] {
  const n = normalizeArea(id)
  return [n, ...Object.keys(LEGACY_AREAS).filter((k) => LEGACY_AREAS[k] === n)]
}

export function areaLabel(id: string): string {
  const n = normalizeArea(id)
  return COUNT_AREAS.find((a) => a.id === n)?.label ?? id
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
  /**
   * Counted the way the owner's sheet counts it (a tray, a chub, a bucket),
   * but how much one holds isn't known yet. It is typed and kept as typed,
   * and left out of the converted total until a size is set — never guessed.
   */
  unsized?: boolean
}

export interface Layer extends LayerInput {
  /** Recipe units in one of this layer. 0 while it is unsized. */
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
    const lowerIdx = input.findIndex((o, j) => j > i && o.label.trim().toLowerCase() === l.of.trim().toLowerCase())
    if (l.unsized || (lowerIdx > i && out[lowerIdx].unsized)) {
      out[i] = { label, qty: 0, of: l.of.trim(), quarters: Boolean(l.quarters), unsized: true, per: 0 }
      continue
    }
    if (!(l.qty > 0) || !Number.isFinite(l.qty)) return { ok: false, error: `"${label}" needs a number above 0` }
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
    const unsized = o.unsized === true
    if (typeof o.label !== "string" || typeof o.per !== "number" || !(unsized ? o.per === 0 : o.per > 0)) return []
    return [{
      label: o.label,
      qty: unsized ? 0 : typeof o.qty === "number" ? o.qty : 1,
      of: typeof o.of === "string" ? o.of : "",
      quarters: o.quarters === true,
      ...(unsized ? { unsized: true } : {}),
      per: o.per,
    }]
  })
}

/**
 * The layers to count with, read fresh: `per` is worked out again from each
 * layer's `qty` and `of`, so an ingredient whose recipe unit changed since
 * setup (lb → oz) is not counted off by that factor. Falls back to what was
 * stored if it no longer resolves, and to the default when nothing is set.
 */
export function layersFor(raw: unknown, recipeUnit: string): Layer[] {
  const stored = parseLayers(raw)
  if (stored.length === 0) return defaultLayers(recipeUnit)
  const r = resolveLayers(stored, recipeUnit)
  return r.ok ? r.layers : stored
}

/**
 * Saved values belong to the layers they were typed against. Once a layer
 * is added or removed in setup, the old numbers would land on the wrong
 * layer ("3 lb" read as "3 cases"), so they no longer count.
 */
export function valuesFit(layers: Layer[], values: ReadonlyArray<number> | null | undefined): values is number[] {
  return Array.isArray(values) && values.length === layers.length
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

/** Layers with a number typed but no size to convert it: "3 Trays". */
export function unconverted(layers: Layer[], values: ReadonlyArray<number | null | undefined>): string | null {
  const parts = layers.flatMap((l, i) => {
    const v = values[i]
    return l.unsized && typeof v === "number" && Number.isFinite(v) && v > 0 ? [`${fmtQty(v)} ${l.label}`] : []
  })
  return parts.length ? parts.join(" + ") : null
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
/**
 * A new item's boxes, from how its invoices say it ships: "CS 6 × 4.5 LB"
 * is Cases of 6 Bags plus Bags of 4.5 lb, the way the count sheet counts
 * fries. No case size on file: the recipe unit alone, as before.
 */
export function packLayers(ing: {
  recipeUnit: string
  recipeUnitsPerCase: number | null
  innerPacksPerCase: number | null
}): Layer[] {
  const perCase = ing.recipeUnitsPerCase
  if (!(perCase != null && perCase > 0)) return defaultLayers(ing.recipeUnit)
  const unit = ing.recipeUnit.trim()
  const inner = ing.innerPacksPerCase
  if (inner != null && inner > 1) {
    const perPack = perCase / inner
    const r = resolveLayers(
      [
        { label: "Cases", qty: inner, of: "Packs" },
        { label: "Packs", qty: perPack, of: unit },
      ],
      unit,
    )
    if (r.ok) return r.layers
  }
  const r = resolveLayers([{ label: "Cases", qty: perCase, of: unit }, ...defaultLayers(unit)], unit)
  return r.ok ? r.layers : defaultLayers(unit)
}

export function defaultLayers(recipeUnit: string): Layer[] {
  if (recipeUnit.trim().toLowerCase() === "oz") {
    return [{ label: "Loose (lb)", qty: 1, of: "lb", quarters: false, per: 16 }]
  }
  return [{ label: `Loose (${recipeUnit})`, qty: 1, of: recipeUnit, quarters: false, per: 1 }]
}

/** Section a new item lands in, from its supplier category. */
export function guessArea(category: string | null): CountArea {
  const c = (category ?? "").toLowerCase()
  if (/frozen|freez/.test(c)) return "frozen"
  if (/chemical|clean|janitor/.test(c)) return "cleaning"
  if (/paper|disposable|packag|suppl/.test(c)) return "packaging"
  if (/bev|drink|soda/.test(c)) return "drinks"
  if (/dry|grocery|canned/.test(c)) return "dry"
  return "fridge"
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

/**
 * The waste log's reasons. The labels and the class each one is counted
 * under live in `@/lib/counter/waste-reasons` — the one taxonomy Inventory's
 * "Adjust on hand" form reads too, so EXPIRY is "Went bad" on both.
 */
export const WASTE_REASONS = WASTE_LOG_REASONS
export type WasteReason = (typeof WASTE_REASONS)[number]["id"]
/** The reasons the waste log's form offers and writes. What the Waste tab LISTS is wider: `isThrownOut` in `waste-reasons.ts`. */
export const WASTE_REASON_IDS: WasteReason[] = WASTE_REASONS.map((r) => r.id)

export function wasteReasonLabel(id: string): string {
  return reasonLabel(id)
}
