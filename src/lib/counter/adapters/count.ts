import { cache } from "react"
import { prisma } from "@/lib/prisma"
import { anchorLineWhere } from "@/lib/inventory/anchor-line"
import {
  loadStoreInventoryContext,
  runningOnHandFromContext,
} from "@/lib/inventory/store-inventory-context"
import {
  COUNT_AREAS,
  areaLabel,
  normalizeArea,
  fmtQty,
  layersFor,
  shelfTotal,
  showQty,
  unitChoices,
  valuesFit,
  wasteReasonLabel,
  type Layer,
} from "@/lib/counter/count-layers"
import { plainName } from "@/lib/counter/plain-names"
import { REASON_CLASS_LABEL, isThrownOut, reasonClass, sumAdjustments, type ValuedAdjustment } from "@/lib/counter/waste-reasons"
import { summarizeWaste, type WasteReasonBar, type WasteSummary } from "@/lib/counter/waste-picture"
import { gapChange, gapCoverage, gapHeadline, type GapChange, type GapCoverage, type GapHeadline } from "@/lib/counter/gap-picture"
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

export async function accountStores(accountId: string): Promise<StoreOption[]> {
  return prisma.store.findMany({
    where: { accountId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
}

function pickStore(stores: StoreOption[], requested: string | undefined): StoreOption | null {
  return stores.find((s) => s.id === requested) ?? stores[0] ?? null
}

export function dayLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Los_Angeles" })
}

export type ItemRow = {
  id: string
  area: string
  layers: unknown
  canonicalIngredientId: string
  canonicalIngredient: { name: string; recipeUnit: string | null; costPerRecipeUnit: number | null }
}

export async function countItems(accountId: string): Promise<ItemRow[]> {
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
  // Rows saved under the first four sections ("walk_in") read as today's six.
  const named = rows.map((r) => ({ ...r, area: normalizeArea(r.area) }))
  // Stable sort keeps sortOrder within an area; areas walk in COUNT_AREAS order.
  return named.sort((a, b) => areaIdx(a.area) - areaIdx(b.area))
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

export type WalkItem = {
  id: string
  ingredientId: string
  /** What the owner calls it ("Fries"). */
  name: string
  /** The invoice text it was named from, shown small under the name. */
  fullName: string
  area: string
  areaLabel: string
  unit: string
  cost: number | null
  layers: Layer[]
  /** What was typed for this stop on the open count, or null if not yet. */
  values: number[] | null
  /** The last finished count of this ingredient at this store. */
  last: { qty: number; day: string; values: number[] | null } | null
}

/** One card on "Which store are you counting?". */
export type StoreCard = {
  id: string
  name: string
  /** Items saved on this store's open count, or null when none is open. */
  inProgress: number | null
  lastFinished: string | null
}

export type WalkData = {
  stores: StoreOption[]
  /** True when the page was opened for a store; false shows the store pick first. */
  picked: boolean
  storeCards: StoreCard[]
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
        const [items, open, last, waste, lastLines, openAll, lastAll] = await Promise.all([
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
          loadWeekWaste(opts.accountId, store.id),
          // The last finished count of each item, newest first: shown above the
          // boxes so a slip (100 bags for 20) stands out while typing.
          prisma.stockCountLine.findMany({
            where: { stockCount: { storeId: store.id, store: { accountId: opts.accountId }, status: "COMPLETED", countedAt: { gte: new Date(Date.now() - 90 * DAY_MS) } } },
            orderBy: { stockCount: { countedAt: "desc" } },
            select: { canonicalIngredientId: true, qtyInRecipeUnit: true, breakdown: true, stockCount: { select: { countedAt: true } } },
          }),
          // For the store pick: each store's open count and last finished one.
          prisma.stockCount.findMany({
            where: { store: { accountId: opts.accountId }, status: "IN_PROGRESS", startedAt: { gte: cutoff } },
            orderBy: { startedAt: "desc" },
            select: { storeId: true, _count: { select: { lines: true } } },
          }),
          prisma.stockCount.groupBy({
            by: ["storeId"],
            where: { store: { accountId: opts.accountId }, status: "COMPLETED" },
            _max: { countedAt: true },
          }),
        ])
        const openBy = new Map<string, number>()
        for (const o of openAll) if (!openBy.has(o.storeId)) openBy.set(o.storeId, o._count.lines)
        const lastAllBy = new Map(lastAll.map((r) => [r.storeId, r._max.countedAt]))
        const lastBy = new Map<string, (typeof lastLines)[number]>()
        for (const l of lastLines) if (!lastBy.has(l.canonicalIngredientId)) lastBy.set(l.canonicalIngredientId, l)
        const typed = new Map<string, number[]>()
        for (const line of open?.lines ?? []) {
          const b = line.breakdown
          if (!b || typeof b !== "object" || Array.isArray(b)) continue
          for (const [itemId, vals] of Object.entries(b as Record<string, unknown>)) {
            if (Array.isArray(vals)) typed.set(itemId, vals.map((n) => (typeof n === "number" ? n : 0)))
          }
        }
        // An ingredient counted at two stops has one line holding both; this
        // stop's own last count is its own breakdown, never the combined line.
        const stops = new Map<string, number>()
        for (const it of items) stops.set(it.canonicalIngredientId, (stops.get(it.canonicalIngredientId) ?? 0) + 1)
        return {
          stores,
          picked: stores.some((s) => s.id === opts.storeId) || stores.length === 1,
          storeCards: stores.map((s) => {
            const at = lastAllBy.get(s.id)
            return { id: s.id, name: s.name, inProgress: openBy.get(s.id) ?? null, lastFinished: at ? dayLabel(at) : null }
          }),
          store,
          count: open ? { id: open.id, started: open.startedAt.toISOString() } : null,
          lastFinished: last ? dayLabel(last.countedAt) : null,
          items: items.flatMap((it) => {
            const unit = it.canonicalIngredient.recipeUnit
            if (!unit) return []
            const layers = layersFor(it.layers, unit)
            const values = typed.get(it.id)
            const prev = lastBy.get(it.canonicalIngredientId)
            const prevB = prev?.breakdown && typeof prev.breakdown === "object" && !Array.isArray(prev.breakdown)
              ? (prev.breakdown as Record<string, unknown>)[it.id]
              : undefined
            const prevVals = Array.isArray(prevB) ? prevB.map((n) => (typeof n === "number" ? n : 0)) : null
            return [{
              id: it.id,
              ingredientId: it.canonicalIngredientId,
              name: plainName(it.canonicalIngredient.name),
              fullName: it.canonicalIngredient.name,
              area: it.area,
              areaLabel: areaLabel(it.area),
              unit,
              cost: it.canonicalIngredient.costPerRecipeUnit,
              layers,
              values: valuesFit(layers, values) ? values : null,
              last: (() => {
                if (!prev) return null
                const fits = valuesFit(layers, prevVals)
                const day = dayLabel(prev.stockCount.countedAt)
                if (fits && prevVals) return { qty: shelfTotal(layers, prevVals), day, values: prevVals }
                if ((stops.get(it.canonicalIngredientId) ?? 0) > 1) return null
                return { qty: prev.qtyInRecipeUnit, day, values: null }
              })(),
            }]
          }),
          // The Waste tab's own figure: the priced entries of the last 7 days.
          waste: { n: waste.entries, dollars: waste.dollars ?? 0 },
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
export type WasteEntry = {
  id: string
  name: string
  amount: string
  /** The reason in words ("Went bad"). */
  reason: string
  when: string
  /** Null when the item has no price on file: listed, never added in as $0. */
  dollars: number | null
  note: string | null
}
export type WasteData = {
  stores: StoreOption[]
  store: StoreOption
  items: WasteItem[]
  recent: WasteEntry[]
  /** The last 7 days added up: what the total is, and how many entries it is the value of. */
  week: WasteSummary
}
export type WasteSections = { waste: SectionData<WasteData | null> }

/** A store's waste log for the last 7 days: the entries, and what they add up to. */
export type WeekWaste = WasteSummary & { list: WasteEntry[] }

/** A reason kept apart from waste: theft, sent back. */
export type ApartFigure = Pick<WasteReasonBar, "id" | "label" | "entries" | "unpriced" | "dollars">

export type StoreWaste = {
  /** Thrown out, last 7 days. */
  week: WeekWaste
  /** The 7 days before those, for "more or less than". */
  before: Pick<WasteSummary, "entries" | "valued" | "unpriced" | "dollars">
  /** Logged in the last 7 days under a reason that is not thrown out (theft, sent back). Never in `week`. */
  apart: ApartFigure[]
  /**
   * Every entry of the last 7 days, newest first: thrown out AND kept apart,
   * for the Waste tab's "What was logged" list, so a theft or a send-back
   * logged by mistake can be undone. `week.list` stays thrown-out only and
   * adds up to the headline.
   */
  logged: WasteEntry[]
}

const WASTE_WINDOW_DAYS = 7

/**
 * Every adjustment logged in the account over the last two windows, once per
 * request: this week's waste, the week before it and the reasons kept apart
 * are all cut from it, for one store or for all of them.
 */
const loadAdjustmentLog = cache((accountId: string) =>
  prisma.inventoryAdjustment.findMany({
    where: { store: { accountId }, occurredAt: { gte: new Date(Date.now() - 2 * WASTE_WINDOW_DAYS * DAY_MS) } },
    orderBy: { occurredAt: "desc" },
    select: {
      id: true, storeId: true, qty: true, reason: true, note: true, occurredAt: true,
      canonicalIngredient: { select: { name: true, recipeUnit: true, costPerRecipeUnit: true } },
    },
  }),
)

/**
 * The one read of "thrown out". The Waste tab's headline, bars and log, its
 * by-store comparison and the Inventory overview's tile are all this.
 *
 * WHAT COUNTS. `isThrownOut` (`waste-reasons.ts`), the set the Report's
 * "Waste you logged" and the one-item page read too, over a rolling 7 days:
 * everything the waste log writes, plus "damaged" from Stock on hand. Theft
 * and "sent back" are never waste; they are returned under `apart`.
 *
 * Once per request and store, so the headline, the log, the comparison and
 * the by-store bars all cut their 7 days at the same instant.
 */
export const loadStoreWaste = cache(async (accountId: string, storeId: string): Promise<StoreWaste> => {
  const log = (await loadAdjustmentLog(accountId)).filter((r) => r.storeId === storeId)
  const now = Date.now()
  const weekStart = now - WASTE_WINDOW_DAYS * DAY_MS
  const dollarsOf = (r: (typeof log)[number]) => {
    const cost = r.canonicalIngredient.costPerRecipeUnit
    return cost != null ? r.qty * cost : null
  }
  const thisWeek = log.filter((r) => r.occurredAt.getTime() >= weekStart)
  const wasted = thisWeek.filter((r) => isThrownOut(r.reason))
  const before = summarizeWaste(
    log.filter((r) => r.occurredAt.getTime() < weekStart && isThrownOut(r.reason)).map((r) => ({ reason: r.reason, dollars: dollarsOf(r) })),
  )
  const entry = (r: (typeof log)[number]): WasteEntry => ({
    id: r.id,
    name: plainName(r.canonicalIngredient.name),
    amount: showQty(r.qty, r.canonicalIngredient.recipeUnit ?? "").trim(),
    reason: wasteReasonLabel(r.reason),
    when: r.occurredAt.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }),
    dollars: dollarsOf(r),
    note: r.note,
  })
  const list = wasted.map(entry)
  return {
    week: { ...summarizeWaste(wasted.map((r) => ({ reason: r.reason, dollars: dollarsOf(r) }))), list },
    before: { entries: before.entries, valued: before.valued, unpriced: before.unpriced, dollars: before.dollars },
    apart: summarizeWaste(thisWeek.filter((r) => !isThrownOut(r.reason)).map((r) => ({ reason: r.reason, dollars: dollarsOf(r) }))).reasons,
    logged: thisWeek.map(entry),
  }
})

/** Thrown out at one store, last 7 days. */
export async function loadWeekWaste(accountId: string, storeId: string): Promise<WeekWaste> {
  return (await loadStoreWaste(accountId, storeId)).week
}

/** The waste form's data for one store (what can be thrown out, in which units) and its last 7 days. */
export async function loadWasteData(accountId: string, stores: StoreOption[], store: StoreOption): Promise<WasteData> {
  const [items, week] = await Promise.all([countItems(accountId), loadWeekWaste(accountId, store.id)])
  // One choice per ingredient. Its units are every layer it is counted
  // in anywhere, so beef can be thrown out by the chub or by the lb.
  const byIng = new Map<string, WasteItem>()
  for (const it of items) {
    const unit = it.canonicalIngredient.recipeUnit
    if (!unit) continue
    const cur = byIng.get(it.canonicalIngredientId) ?? {
      ingredientId: it.canonicalIngredientId,
      name: plainName(it.canonicalIngredient.name),
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
  return {
    stores,
    store,
    items: [...byIng.values()],
    recent: week.list,
    week: { entries: week.entries, valued: week.valued, unpriced: week.unpriced, dollars: week.dollars, reasons: week.reasons },
  }
}

export function getCountWasteSectionPromises(opts: { accountId: string; storeId?: string }): StreamedSections<WasteSections> {
  return {
    waste: guardSection(
      classify(async (): Promise<WasteData | null> => {
        const stores = await accountStores(opts.accountId)
        const store = pickStore(stores, opts.storeId)
        if (!store) return null
        return loadWasteData(opts.accountId, stores, store)
      }, { retryAction: "count.waste", isEmpty: (d) => d === null, emptyReason: "no_stores" }),
      "count.waste",
    ),
  }
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export type GapRow = {
  ingredientId: string
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
  /** Signed: positive is a shortage, negative an overage. */
  missingDollars: number | null
  /**
   * Thrown out and logged, in the row's display unit: `isThrownOut`, the Waste
   * tab's own set (the waste class plus "other"). With `theft` and `returned`
   * it is everything logged, so the row adds across.
   */
  thrown: number
  thrownDollars: number
  /** Logged out by reason class, in the row's display unit (`waste` is the waste class only). */
  theft: number
  returned: number
  other: number
  /** The same entries, valued — the totals are the sum of these. */
  wasteDollars: number
  theftDollars: number
  returnDollars: number
  otherDollars: number
  /** Some deliveries could not be turned into this unit (no case size yet). */
  partial: boolean
}

export type OrderRow = {
  ingredientId: string
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
  /** Σ shortages only. */
  missingDollars: number
  /** Σ overages, as a positive figure — shown beside the shortages, never netted into them. */
  extraDollars: number
  /** Rows counted over what the numbers say on an item with no price: an overage `extraDollars` cannot hold. */
  extraUnpriced: number
  /** Σ of the rows' class dollars; rows add up to these exactly. */
  wasteDollars: number
  theftDollars: number
  returnDollars: number
  otherDollars: number
  wasteEntries: number
  /**
   * "Waste you logged" as the Report tab prints it: `isThrownOut`, the set the
   * Waste tab totals. Σ of the rows' `thrownDollars`; `thrownUnpriced` of the
   * `thrownEntries` are on an item with no price and are not in the dollars.
   */
  thrownDollars: number
  thrownEntries: number
  thrownUnpriced: number
  /** Theft and sent back on the rows, each with its own entries, so one with no price is never $0. */
  apart: GapApart[]
  /** Entries in the window on items not counted both times — not on any row. */
  offReportEntries: number
  /** Σ of the priced ones; `offReportUnpriced` of the entries have no price and are not in it. */
  offReportDollars: number
  offReportUnpriced: number
  orders: OrderRow[]
  /**
   * The picture the Report tab leads with. All three are null unless the
   * report was loaded with `picture` and there are two counts to compare.
   */
  /** "Went missing" as a figure that can be unknown: null when nothing compared has a price. */
  headline: GapHeadline | null
  /** "N of M lines compared", and why the rest were not. */
  coverage: GapCoverage | null
  /**
   * The pair of counts before this one, where there is one. `change` compares
   * the two only over the items both pairs compared (`gapChange`).
   */
  before: { from: string; to: string; headline: GapHeadline; change: GapChange } | null
}

/** One class kept apart from waste on the Report: what was logged and what of it can be valued. */
export type GapApart = {
  id: "shrink" | "return"
  /** "Theft", "Sent back". */
  label: string
  entries: number
  unpriced: number
  /** Σ of the priced entries. Null when none has a price: an unknown, never $0. */
  dollars: number | null
}
export type ReportSections = { report: SectionData<ReportData | null> }

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** How often each item is ordered at a store, from 8 weeks of invoices: biggest spend first, 25 at most. */
export async function orderFrequency(accountId: string, storeId: string, ingredientIds: string[]): Promise<OrderRow[]> {
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
  type Acc = { id: string; name: string; vendors: Map<string, number>; days: Map<string, number>; qty: Map<string, number[]>; spend: number }
  const acc = new Map<string, Acc>()
  for (const l of lines) {
    const id = l.canonicalIngredientId
    const d = l.invoice.invoiceDate
    if (!id || !d || !l.canonicalIngredient) continue
    const a = acc.get(id) ?? { id, name: plainName(l.canonicalIngredient.name), vendors: new Map(), days: new Map(), qty: new Map(), spend: 0 }
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
      ingredientId: a.id,
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

/**
 * One store's report: the gap between a finished count and the one before it,
 * and how often things are ordered. `picture` adds what the Report tab leads
 * with (coverage, and the pair of counts before, for "more or less than"),
 * which costs a second walk of the store's history; the chat tool reads the
 * rows and totals only and leaves it off.
 */
export async function loadReport(opts: {
  accountId: string
  stores: StoreOption[]
  store: StoreOption
  countId?: string
  picture?: boolean
}): Promise<ReportData> {
  const { accountId, stores, store } = opts
  const [completed, items] = await Promise.all([
    prisma.stockCount.findMany({
      where: { storeId: store.id, store: { accountId }, status: "COMPLETED" },
      orderBy: { countedAt: "desc" },
      take: 12,
      select: { id: true, countedAt: true },
    }),
    countItems(accountId),
  ])
  const ingredientIds = [...new Set(items.map((i) => i.canonicalIngredientId))]
  const orders = await orderFrequency(accountId, store.id, ingredientIds)
  const counts = completed.map((c) => ({ id: c.id, label: dayLabel(c.countedAt) }))
  const curIdx = Math.max(0, completed.findIndex((c) => c.id === opts.countId))
  const cur = completed[curIdx] ?? null
  const prev = completed[curIdx + 1] ?? null
  const older = completed[curIdx + 2] ?? null
  const base: ReportData = {
    stores, store, counts,
    current: cur ? { id: cur.id, label: dayLabel(cur.countedAt) } : null,
    previous: prev ? { label: dayLabel(prev.countedAt) } : null,
    rows: [], missingDollars: 0, extraDollars: 0, extraUnpriced: 0, wasteDollars: 0, theftDollars: 0,
    returnDollars: 0, otherDollars: 0, wasteEntries: 0, thrownDollars: 0, thrownEntries: 0, thrownUnpriced: 0, apart: [], offReportEntries: 0,
    offReportDollars: 0, offReportUnpriced: 0, orders, headline: null, coverage: null, before: null,
  }
  if (!cur || !prev) return base
  if (!opts.picture) return { ...base, ...(await loadGap(accountId, store.id, cur, prev)) }

  const [gap, countLines, beforeGap] = await Promise.all([
    loadGap(accountId, store.id, cur, prev),
    // Every line on this count, the ones with an unsized box included: the
    // coverage line says how many lines that kept out of the comparison.
    prisma.stockCountLine.findMany({
      where: { stockCountId: cur.id, stockCount: { storeId: store.id, store: { accountId } } },
      select: { canonicalIngredientId: true, nativeUnit: true },
    }),
    older ? loadGap(accountId, store.id, prev, older) : null,
  ])
  return {
    ...base,
    ...gap,
    headline: gapHeadline(gap.rows),
    coverage: gapCoverage({
      // The walk leaves out an item with no recipe unit, so it is not a line here either.
      lineItems: items.filter((i) => i.canonicalIngredient.recipeUnit).map((i) => i.canonicalIngredientId),
      countLines,
      compared: gap.rows.map((r) => r.ingredientId),
    }),
    before: beforeGap && older
      ? { from: dayLabel(older.countedAt), to: dayLabel(prev.countedAt), headline: gapHeadline(beforeGap.rows), change: gapChange(gap.rows, beforeGap.rows) }
      : null,
  }
}

export function getCountReportSectionPromises(opts: { accountId: string; storeId?: string; countId?: string }): StreamedSections<ReportSections> {
  return {
    report: guardSection(
      classify(async (): Promise<ReportData | null> => {
        const stores = await accountStores(opts.accountId)
        const store = pickStore(stores, opts.storeId)
        if (!store) return null
        return loadReport({ accountId: opts.accountId, stores, store, countId: opts.countId })
      }, { retryAction: "count.report", isEmpty: (d) => d === null, emptyReason: "no_stores" }),
      "count.report",
    ),
  }
}

type GapPart = Pick<
  ReportData,
  | "rows" | "missingDollars" | "extraDollars" | "extraUnpriced" | "wasteDollars" | "theftDollars" | "returnDollars" | "otherDollars"
  | "wasteEntries" | "thrownDollars" | "thrownEntries" | "thrownUnpriced" | "apart" | "offReportEntries" | "offReportDollars" | "offReportUnpriced"
>

/**
 * The gap between two finished counts of one store: a row per item counted
 * both times, and the totals those rows add up to. The Report tab and the
 * Inventory overview's "Went missing" both read this, so they print one figure.
 */
export async function loadGap(
  accountId: string,
  storeId: string,
  cur: { id: string; countedAt: Date },
  prev: { countedAt: Date },
): Promise<GapPart> {
    // "Should have" at the moment of this count, anchored on the one
    // before it: the context's latest COMPLETED count at or before
    // `asOf` is `prev`, because `asOf` sits just before `cur`.
    const asOf = new Date(cur.countedAt.getTime() - 1)
    const [ctx, lines, ings, waste] = await Promise.all([
      loadStoreInventoryContext({ storeId: storeId, accountId: accountId, asOf }),
      // Only lines that are the whole shelf. A line saved with a box that has
      // no size (`partial`) holds just the part that could be converted: read
      // as the count, the unsized boxes would be reported as missing.
      prisma.stockCountLine.findMany({
        where: { stockCountId: cur.id, stockCount: { storeId, store: { accountId } }, ...anchorLineWhere },
        select: { canonicalIngredientId: true, qtyInRecipeUnit: true },
      }),
      prisma.canonicalIngredient.findMany({
        where: { accountId: accountId, stockCountLines: { some: { stockCountId: cur.id, ...anchorLineWhere } } },
        select: { id: true, name: true, recipeUnit: true, costPerRecipeUnit: true, caseUnit: true, recipeUnitsPerCase: true, innerPackUnit: true, innerPacksPerCase: true },
      }),
      // EVERY reason, over the window the "should have" walk subtracts —
      // after the previous count, up to `asOf`. The rows and the totals
      // are both `sumAdjustments` over these, so they add up.
      prisma.inventoryAdjustment.findMany({
        where: { storeId: storeId, store: { accountId: accountId }, occurredAt: { gt: prev.countedAt, lte: asOf } },
        select: { canonicalIngredientId: true, reason: true, qty: true, canonicalIngredient: { select: { costPerRecipeUnit: true } } },
      }),
    ])
    const adjBy = new Map<string, ValuedAdjustment[]>()
    for (const a of waste) {
      const list = adjBy.get(a.canonicalIngredientId) ?? []
      list.push({ reason: a.reason, qty: a.qty, cost: a.canonicalIngredient.costPerRecipeUnit })
      adjBy.set(a.canonicalIngredientId, list)
    }
    const onRows = new Set<string>()
    const counted = new Map(lines.map((l) => [l.canonicalIngredientId, l.qtyInRecipeUnit]))
    const rows: GapRow[] = []
    for (const ing of ings) {
      if (!ing.recipeUnit) continue
      const r = runningOnHandFromContext(ctx, ing)
      // Only items counted both times have a starting point.
      if (!r.baseAt || r.baseAt.getTime() !== prev.countedAt.getTime()) continue
      // No whole line on this count (a box with no size): nothing to compare.
      const got = counted.get(ing.id)
      if (got === undefined) continue
      onRows.add(ing.id)
      const missing = r.onHand - got
      const logged = adjBy.get(ing.id) ?? []
      const adj = sumAdjustments(logged)
      const thrown = logged.filter((e) => isThrownOut(e.reason))
      // Shown in lb when the recipes use oz; dollars are worked out first.
      const k = ing.recipeUnit.trim().toLowerCase() === "oz" ? 16 : 1
      rows.push({
        ingredientId: ing.id,
        name: plainName(ing.name),
        unit: k === 16 ? "lb" : ing.recipeUnit,
        last: r.baseQty / k,
        delivered: r.deliveriesQty / k,
        used: r.depletionQty / k,
        waste: adj.qty.waste / k,
        thrown: thrown.reduce((t, e) => t + e.qty, 0) / k,
        thrownDollars: thrown.reduce((t, e) => t + e.qty * (e.cost ?? 0), 0),
        theft: adj.qty.shrink / k,
        returned: adj.qty.return / k,
        other: adj.qty.other / k,
        should: r.onHand / k,
        counted: got / k,
        missing: missing / k,
        missingDollars: ing.costPerRecipeUnit != null ? missing * ing.costPerRecipeUnit : null,
        wasteDollars: adj.dollars.waste,
        theftDollars: adj.dollars.shrink,
        returnDollars: adj.dollars.return,
        otherDollars: adj.dollars.other,
        partial: r.partial,
      })
    }
    rows.sort((a, b) => (b.missingDollars ?? 0) - (a.missingDollars ?? 0))
    const offEntries = [...adjBy].filter(([id]) => !onRows.has(id)).flatMap(([, list]) => list)
    const off = sumAdjustments(offEntries)
    const onEntries = [...adjBy].filter(([id]) => onRows.has(id)).flatMap(([, list]) => list)
    const thrownOn = onEntries.filter((e) => isThrownOut(e.reason))
    const apartOf = (id: GapApart["id"]): GapApart => {
      const list = onEntries.filter((e) => !isThrownOut(e.reason) && reasonClass(e.reason) === id)
      const priced = list.filter((e) => e.cost != null)
      return {
        id,
        label: REASON_CLASS_LABEL[id],
        entries: list.length,
        unpriced: list.length - priced.length,
        dollars: priced.length ? priced.reduce((t, e) => t + e.qty * (e.cost ?? 0), 0) : null,
      }
    }
    return {
      ...reportTotals(rows),
      rows,
      wasteEntries: onEntries.filter((e) => reasonClass(e.reason) === "waste").length,
      thrownEntries: thrownOn.length,
      thrownUnpriced: thrownOn.filter((e) => e.cost == null).length,
      apart: [apartOf("shrink"), apartOf("return")],
      offReportEntries: Object.values(off.entries).reduce((t, n) => t + n, 0),
      offReportDollars: Object.values(off.dollars).reduce((t, n) => t + n, 0),
      offReportUnpriced: offEntries.filter((e) => e.cost == null).length,
    }
}

/** "Went missing" between a store's two most recent finished counts. Null until there are two. */
export type LatestGap = GapHeadline & {
  from: string
  to: string
}

/**
 * A store's two most recent finished counts and the gap between them, once
 * per request: the Overview tile, the Report tab's by-store comparison and
 * the one-item page all start here.
 */
export const loadLatestPair = cache(async (accountId: string, storeId: string): Promise<(LatestGap & { rows: GapRow[] }) | null> => {
  const [cur, prev] = await prisma.stockCount.findMany({
    where: { storeId, store: { accountId }, status: "COMPLETED" },
    orderBy: { countedAt: "desc" },
    take: 2,
    select: { id: true, countedAt: true },
  })
  if (!cur || !prev) return null
  const gap = await loadGap(accountId, storeId, cur, prev)
  return { from: dayLabel(prev.countedAt), to: dayLabel(cur.countedAt), ...gapHeadline(gap.rows), rows: gap.rows }
})

export async function loadLatestGap(accountId: string, storeId: string): Promise<LatestGap | null> {
  const pair = await loadLatestPair(accountId, storeId)
  if (!pair) return null
  return { from: pair.from, to: pair.to, items: pair.items, unpriced: pair.unpriced, missingDollars: pair.missingDollars }
}

/**
 * The report's totals, from its rows and nothing else — so the rows add up to
 * them. Missing is SHORTAGES only; overages are their own figure rather than
 * dropped (or netted against the shortages, which would hide both).
 */
export function reportTotals(rows: GapRow[]): Pick<
  ReportData,
  "missingDollars" | "extraDollars" | "extraUnpriced" | "wasteDollars" | "thrownDollars" | "theftDollars" | "returnDollars" | "otherDollars"
> {
  const sum = (f: (r: GapRow) => number) => rows.reduce((t, r) => t + f(r), 0)
  return {
    missingDollars: sum((r) => Math.max(0, r.missingDollars ?? 0)),
    extraDollars: sum((r) => Math.max(0, -(r.missingDollars ?? 0))),
    extraUnpriced: rows.filter((r) => r.missing < 0 && r.missingDollars === null).length,
    wasteDollars: sum((r) => r.wasteDollars),
    thrownDollars: sum((r) => r.thrownDollars),
    theftDollars: sum((r) => r.theftDollars),
    returnDollars: sum((r) => r.returnDollars),
    otherDollars: sum((r) => r.otherDollars),
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
              name: plainName(it.canonicalIngredient.name),
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
