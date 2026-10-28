import { prisma } from "@/lib/prisma"
import {
  loadStoreInventoryContext,
  runningOnHandFromContext,
} from "@/lib/inventory/store-inventory-context"
import {
  COUNT_AREAS,
  areaLabel,
  WASTE_REASON_IDS,
  fmtQty,
  layersFor,
  showQty,
  unitChoices,
  valuesFit,
  wasteReasonLabel,
  type Layer,
} from "@/lib/counter/count-layers"
import { classify, guardSection, type StreamedSections } from "./types"
import type { SectionData } from "@/lib/counter/section-data"

/**
 * Count & waste — the weekly count walk, the waste log, the report and the
 * setup. Every query is scoped by `accountId`: store-owned rows through
 * `store: { accountId }`, count items and ingredients directly. The shelf
 * arithmetic lives in `count-layers.ts`; the "should have" figure is
 * `runningOnHandFromContext`, the same function the on-hand model calibrates
 * against, so the report and the model read one number.
 */

const DAY_MS = 86_400_000

export type StoreOption = { id: string; name: string }

async function accountStores(accountId: string): Promise<StoreOption[]> {
  return prisma.store.findMany({
    where: { accountId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
}

function pickStore(stores: StoreOption[], requested: string | undefined): StoreOption | null {
  return stores.find((s) => s.id === requested) ?? stores[0] ?? null
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Los_Angeles" })
}

type ItemRow = {
  id: string
  area: string
  layers: unknown
  canonicalIngredientId: string
  canonicalIngredient: { name: string; recipeUnit: string | null; costPerRecipeUnit: number | null }
}

async function countItems(accountId: string): Promise<ItemRow[]> {
  const rows = await prisma.countItem.findMany({
    where: { accountId, active: true, canonicalIngredient: { accountId } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      area: true,
      layers: true,
      canonicalIngredientId: true,
      canonicalIngredient: { select: { name: true, recipeUnit: true, costPerRecipeUnit: true } },
    },
  })
  const areaIdx = (a: string) => {
    const i = COUNT_AREAS.findIndex((x) => x.id === a)
    return i < 0 ? 99 : i
  }
  // Stable sort keeps sortOrder within an area; areas walk in COUNT_AREAS order.
  return rows.sort((a, b) => areaIdx(a.area) - areaIdx(b.area))
}

function weekAgo(): Date {
  return new Date(Date.now() - 7 * DAY_MS)
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

export type WalkItem = {
  id: string
  ingredientId: string
  name: string
  area: string
  areaLabel: string
  unit: string
  cost: number | null
  layers: Layer[]
  /** What was typed for this stop on the open count, or null if not yet. */
  values: number[] | null
}

export type WalkData = {
  stores: StoreOption[]
  store: StoreOption
  count: { id: string; started: string } | null
  lastFinished: string | null
  items: WalkItem[]
  waste: { n: number; dollars: number }
}
export type WalkSections = { walk: SectionData<WalkData | null> }

export function getCountWalkSectionPromises(opts: { accountId: string; storeId?: string }): StreamedSections<WalkSections> {
  return {
    walk: guardSection(
      classify(async (): Promise<WalkData | null> => {
        const stores = await accountStores(opts.accountId)
        const store = pickStore(stores, opts.storeId)
        if (!store) return null
        const cutoff = new Date(Date.now() - 7 * DAY_MS)
        const [items, open, last, waste] = await Promise.all([
          countItems(opts.accountId),
          prisma.stockCount.findFirst({
            where: { storeId: store.id, store: { accountId: opts.accountId }, status: "IN_PROGRESS", startedAt: { gte: cutoff } },
            orderBy: { startedAt: "desc" },
            select: { id: true, startedAt: true, lines: { select: { canonicalIngredientId: true, breakdown: true } } },
          }),
          prisma.stockCount.findFirst({
            where: { storeId: store.id, store: { accountId: opts.accountId }, status: "COMPLETED" },
            orderBy: { countedAt: "desc" },
            select: { countedAt: true },
          }),
          prisma.inventoryAdjustment.findMany({
            where: { storeId: store.id, store: { accountId: opts.accountId }, occurredAt: { gte: weekAgo() }, reason: { in: WASTE_REASON_IDS } },
            select: { qty: true, canonicalIngredient: { select: { costPerRecipeUnit: true } } },
          }),
        ])
        const typed = new Map<string, number[]>()
        for (const line of open?.lines ?? []) {
          const b = line.breakdown
          if (!b || typeof b !== "object" || Array.isArray(b)) continue
          for (const [itemId, vals] of Object.entries(b as Record<string, unknown>)) {
            if (Array.isArray(vals)) typed.set(itemId, vals.map((n) => (typeof n === "number" ? n : 0)))
          }
        }
        return {
          stores,
          store,
          count: open ? { id: open.id, started: open.startedAt.toISOString() } : null,
          lastFinished: last ? dayLabel(last.countedAt) : null,
          items: items.flatMap((it) => {
            const unit = it.canonicalIngredient.recipeUnit
            if (!unit) return []
            const layers = layersFor(it.layers, unit)
            const values = typed.get(it.id)
            return [{
              id: it.id,
              ingredientId: it.canonicalIngredientId,
              name: it.canonicalIngredient.name,
              area: it.area,
              areaLabel: areaLabel(it.area),
              unit,
              cost: it.canonicalIngredient.costPerRecipeUnit,
              layers,
              values: valuesFit(layers, values) ? values : null,
            }]
          }),
          waste: {
            n: waste.length,
            dollars: waste.reduce((t, w) => t + w.qty * (w.canonicalIngredient.costPerRecipeUnit ?? 0), 0),
          },
        }
      }, { retryAction: "count.walk", isEmpty: (d) => d === null, emptyReason: "no_stores" }),
      "count.walk",
    ),
  }
}

// ---------------------------------------------------------------------------
// Waste log
// ---------------------------------------------------------------------------

export type WasteItem = { ingredientId: string; name: string; unit: string; cost: number | null; layers: Layer[] }
export type WasteEntry = { id: string; name: string; amount: string; reason: string; when: string; dollars: number | null; note: string | null }
export type WasteData = {
  stores: StoreOption[]
  store: StoreOption
  items: WasteItem[]
  recent: WasteEntry[]
  weekDollars: number
}
export type WasteSections = { waste: SectionData<WasteData | null> }

export function getCountWasteSectionPromises(opts: { accountId: string; storeId?: string }): StreamedSections<WasteSections> {
  return {
    waste: guardSection(
      classify(async (): Promise<WasteData | null> => {
        const stores = await accountStores(opts.accountId)
        const store = pickStore(stores, opts.storeId)
        if (!store) return null
        const [items, recent] = await Promise.all([
          countItems(opts.accountId),
          prisma.inventoryAdjustment.findMany({
            where: { storeId: store.id, store: { accountId: opts.accountId }, occurredAt: { gte: weekAgo() }, reason: { in: WASTE_REASON_IDS } },
            orderBy: { occurredAt: "desc" },
            select: {
              id: true, qty: true, reason: true, note: true, occurredAt: true,
              canonicalIngredient: { select: { name: true, recipeUnit: true, costPerRecipeUnit: true } },
            },
          }),
        ])
        // One choice per ingredient. Its units are every layer it is counted
        // in anywhere, so beef can be thrown out by the chub or by the lb.
        const byIng = new Map<string, WasteItem>()
        for (const it of items) {
          const unit = it.canonicalIngredient.recipeUnit
          if (!unit) continue
          const cur = byIng.get(it.canonicalIngredientId) ?? {
            ingredientId: it.canonicalIngredientId,
            name: it.canonicalIngredient.name,
            unit,
            cost: it.canonicalIngredient.costPerRecipeUnit,
            layers: [],
          }
          // Two areas can both say "Case" and mean different cases; keep both.
          for (const l of layersFor(it.layers, unit)) {
            if (cur.layers.some((x) => x.label === l.label && x.per === l.per)) continue
            const clash = cur.layers.some((x) => x.label === l.label)
            cur.layers.push(clash ? { ...l, label: `${l.label} (${areaLabel(it.area)})` } : l)
          }
          byIng.set(it.canonicalIngredientId, cur)
        }
        for (const w of byIng.values()) {
          if (!w.layers.some((l) => l.per === 1)) w.layers.push({ label: w.unit, qty: 1, of: w.unit, per: 1, quarters: false })
          // Smallest first: waste is usually a little, not a case.
          w.layers.sort((a, b) => a.per - b.per)
        }
        const entries: WasteEntry[] = recent.map((r) => {
          const cost = r.canonicalIngredient.costPerRecipeUnit
          return {
            id: r.id,
            name: r.canonicalIngredient.name,
            amount: showQty(r.qty, r.canonicalIngredient.recipeUnit ?? "").trim(),
            reason: wasteReasonLabel(r.reason),
            when: r.occurredAt.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }),
            dollars: cost != null ? r.qty * cost : null,
            note: r.note,
          }
        })
        return {
          stores,
          store,
          items: [...byIng.values()],
          recent: entries,
          weekDollars: entries.reduce((t, e) => t + (e.dollars ?? 0), 0),
        }
      }, { retryAction: "count.waste", isEmpty: (d) => d === null, emptyReason: "no_stores" }),
      "count.waste",
    ),
  }
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export type GapRow = {
  name: string
  unit: string
  last: number
  delivered: number
  used: number
  waste: number
  should: number
  counted: number
  /** should − counted. Positive means it went somewhere nobody logged. */
  missing: number
  missingDollars: number | null
  /** Some deliveries could not be turned into this unit (no case size yet). */
  partial: boolean
}

export type OrderRow = {
  name: string
  vendor: string
  orders: number
  usually: string
  amount: string
  last: string
  every: string
}

export type ReportData = {
  stores: StoreOption[]
  store: StoreOption
  counts: Array<{ id: string; label: string }>
  current: { id: string; label: string } | null
  previous: { label: string } | null
  rows: GapRow[]
  missingDollars: number
  wasteDollars: number
  wasteEntries: number
  orders: OrderRow[]
}
export type ReportSections = { report: SectionData<ReportData | null> }

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

async function orderFrequency(accountId: string, storeId: string, ingredientIds: string[]): Promise<OrderRow[]> {
  const since = new Date(Date.now() - 56 * DAY_MS)
  const lines = await prisma.invoiceLineItem.findMany({
    where: {
      canonicalIngredientId: ingredientIds.length ? { in: ingredientIds } : { not: null },
      invoice: { accountId, storeId, invoiceDate: { gte: since } },
    },
    select: {
      canonicalIngredientId: true,
      quantity: true,
      unit: true,
      extendedPrice: true,
      canonicalIngredient: { select: { name: true } },
      invoice: { select: { invoiceDate: true, vendorName: true } },
    },
  })
  type Acc = { name: string; vendors: Map<string, number>; days: Map<string, number>; qty: Map<string, number[]>; spend: number }
  const acc = new Map<string, Acc>()
  for (const l of lines) {
    const id = l.canonicalIngredientId
    const d = l.invoice.invoiceDate
    if (!id || !d || !l.canonicalIngredient) continue
    const a = acc.get(id) ?? { name: l.canonicalIngredient.name, vendors: new Map(), days: new Map(), qty: new Map(), spend: 0 }
    const day = d.toISOString().slice(0, 10)
    a.days.set(day, (a.days.get(day) ?? 0) + l.quantity)
    a.vendors.set(l.invoice.vendorName, (a.vendors.get(l.invoice.vendorName) ?? 0) + 1)
    const u = (l.unit ?? "").trim() || "units"
    a.qty.set(u, [...(a.qty.get(u) ?? []), l.quantity])
    a.spend += l.extendedPrice
    acc.set(id, a)
  }
  const rows = [...acc.values()].sort((x, y) => y.spend - x.spend)
  return rows.slice(0, 25).map((a) => {
    const days = [...a.days.keys()].sort()
    const wd = new Map<number, number>()
    for (const d of days) {
      const w = new Date(d + "T12:00:00Z").getUTCDay()
      wd.set(w, (wd.get(w) ?? 0) + 1)
    }
    const usual = [...wd.entries()].filter(([, n]) => n / days.length >= 0.3).sort((x, y) => x[0] - y[0]).map(([w]) => WEEKDAYS[w])
    const [unit, qtys] = [...a.qty.entries()].sort((x, y) => y[1].length - x[1].length)[0]
    let gap = 0
    for (let i = 1; i < days.length; i++) gap += (Date.parse(days[i]) - Date.parse(days[i - 1])) / DAY_MS
    const avgGap = days.length > 1 ? gap / (days.length - 1) : null
    const vendor = [...a.vendors.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? ""
    return {
      name: a.name,
      vendor,
      orders: days.length,
      usually: usual.length ? usual.join(" + ") : "No set day",
      amount: `${fmtQty(median(qtys))} ${unit}`,
      last: new Date(days[days.length - 1] + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
      every: avgGap == null ? "Once" : avgGap < 1.5 ? "Daily" : `${fmtQty(Math.round(avgGap * 2) / 2)} days`,
    }
  })
}

export function getCountReportSectionPromises(opts: { accountId: string; storeId?: string; countId?: string }): StreamedSections<ReportSections> {
  return {
    report: guardSection(
      classify(async (): Promise<ReportData | null> => {
        const stores = await accountStores(opts.accountId)
        const store = pickStore(stores, opts.storeId)
        if (!store) return null
        const [completed, items] = await Promise.all([
          prisma.stockCount.findMany({
            where: { storeId: store.id, store: { accountId: opts.accountId }, status: "COMPLETED" },
            orderBy: { countedAt: "desc" },
            take: 12,
            select: { id: true, countedAt: true },
          }),
          countItems(opts.accountId),
        ])
        const ingredientIds = [...new Set(items.map((i) => i.canonicalIngredientId))]
        const orders = await orderFrequency(opts.accountId, store.id, ingredientIds)
        const counts = completed.map((c) => ({ id: c.id, label: dayLabel(c.countedAt) }))
        const curIdx = Math.max(0, completed.findIndex((c) => c.id === opts.countId))
        const cur = completed[curIdx] ?? null
        const prev = completed[curIdx + 1] ?? null
        const base: ReportData = {
          stores, store, counts,
          current: cur ? { id: cur.id, label: dayLabel(cur.countedAt) } : null,
          previous: prev ? { label: dayLabel(prev.countedAt) } : null,
          rows: [], missingDollars: 0, wasteDollars: 0, wasteEntries: 0, orders,
        }
        if (!cur || !prev) return base

        // "Should have" at the moment of this count, anchored on the one
        // before it: the context's latest COMPLETED count at or before
        // `asOf` is `prev`, because `asOf` sits just before `cur`.
        const asOf = new Date(cur.countedAt.getTime() - 1)
        const [ctx, lines, ings, waste] = await Promise.all([
          loadStoreInventoryContext({ storeId: store.id, accountId: opts.accountId, asOf }),
          prisma.stockCountLine.findMany({
            where: { stockCountId: cur.id },
            select: { canonicalIngredientId: true, qtyInRecipeUnit: true },
          }),
          prisma.canonicalIngredient.findMany({
            where: { accountId: opts.accountId, stockCountLines: { some: { stockCountId: cur.id } } },
            select: { id: true, name: true, recipeUnit: true, costPerRecipeUnit: true, caseUnit: true, recipeUnitsPerCase: true, innerPackUnit: true, innerPacksPerCase: true },
          }),
          prisma.inventoryAdjustment.findMany({
            where: { storeId: store.id, store: { accountId: opts.accountId }, occurredAt: { gt: prev.countedAt, lte: cur.countedAt }, reason: { in: WASTE_REASON_IDS } },
            select: { qty: true, canonicalIngredient: { select: { costPerRecipeUnit: true } } },
          }),
        ])
        const counted = new Map(lines.map((l) => [l.canonicalIngredientId, l.qtyInRecipeUnit]))
        const rows: GapRow[] = []
        for (const ing of ings) {
          if (!ing.recipeUnit) continue
          const r = runningOnHandFromContext(ctx, ing)
          // Only items counted both times have a starting point.
          if (!r.baseAt || r.baseAt.getTime() !== prev.countedAt.getTime()) continue
          const got = counted.get(ing.id) ?? 0
          const missing = r.onHand - got
          // Shown in lb when the recipes use oz; dollars are worked out first.
          const k = ing.recipeUnit.trim().toLowerCase() === "oz" ? 16 : 1
          rows.push({
            name: ing.name,
            unit: k === 16 ? "lb" : ing.recipeUnit,
            last: r.baseQty / k,
            delivered: r.deliveriesQty / k,
            used: r.depletionQty / k,
            waste: r.adjustmentsQty / k,
            should: r.onHand / k,
            counted: got / k,
            missing: missing / k,
            missingDollars: ing.costPerRecipeUnit != null ? missing * ing.costPerRecipeUnit : null,
            partial: r.partial,
          })
        }
        rows.sort((a, b) => (b.missingDollars ?? 0) - (a.missingDollars ?? 0))
        return {
          ...base,
          rows,
          missingDollars: rows.reduce((t, r) => t + Math.max(0, r.missingDollars ?? 0), 0),
          wasteDollars: waste.reduce((t, w) => t + w.qty * (w.canonicalIngredient.costPerRecipeUnit ?? 0), 0),
          wasteEntries: waste.length,
        }
      }, { retryAction: "count.report", isEmpty: (d) => d === null, emptyReason: "no_stores" }),
      "count.report",
    ),
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export type SetupItem = {
  id: string
  ingredientId: string
  name: string
  area: string
  unit: string
  units: string[]
  cost: number | null
  layers: Layer[]
}
export type SetupData = {
  items: SetupItem[]
  /** Ingredients that can be added, biggest 60-day spend first. */
  options: Array<{ id: string; name: string; unit: string; spend: number }>
}
export type SetupSections = { setup: SectionData<SetupData> }

export function getCountSetupSectionPromises(opts: { accountId: string }): StreamedSections<SetupSections> {
  return {
    setup: guardSection(
      classify(async (): Promise<SetupData> => {
        const since = new Date(Date.now() - 60 * DAY_MS)
        const [items, ings, spend] = await Promise.all([
          countItems(opts.accountId),
          prisma.canonicalIngredient.findMany({
            where: { accountId: opts.accountId, recipeUnit: { not: null } },
            select: { id: true, name: true, recipeUnit: true },
            orderBy: { name: "asc" },
          }),
          prisma.invoiceLineItem.groupBy({
            by: ["canonicalIngredientId"],
            where: { canonicalIngredientId: { not: null }, invoice: { accountId: opts.accountId, invoiceDate: { gte: since } } },
            _sum: { extendedPrice: true },
          }),
        ])
        const spendBy = new Map(spend.map((s) => [s.canonicalIngredientId, s._sum.extendedPrice ?? 0]))
        return {
          items: items.flatMap((it) => {
            const unit = it.canonicalIngredient.recipeUnit
            if (!unit) return []
            return [{
              id: it.id,
              ingredientId: it.canonicalIngredientId,
              name: it.canonicalIngredient.name,
              area: it.area,
              unit,
              units: unitChoices(unit),
              cost: it.canonicalIngredient.costPerRecipeUnit,
              layers: layersFor(it.layers, unit),
            }]
          }),
          options: ings
            .map((i) => ({ id: i.id, name: i.name, unit: i.recipeUnit!, spend: spendBy.get(i.id) ?? 0 }))
            .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name)),
        }
      }, { retryAction: "count.setup" }),
      "count.setup",
    ),
  }
}
