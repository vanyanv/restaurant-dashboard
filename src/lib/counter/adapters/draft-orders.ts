import { prisma } from "@/lib/prisma"
import {
  loadStoreInventoryContext,
  runningOnHandFromContext,
  dailyDepletionRateFromContext,
} from "@/lib/inventory/store-inventory-context"
import { computeForecastShapedDepletion } from "@/lib/inventory/forecast-depletion"
import { normalizeVendorName } from "@/lib/vendor-normalize"
import { daysUntilOut, draftLine, type DraftLine } from "@/lib/counter/draft-orders"
import { fmtQty } from "@/lib/counter/count-layers"
import { classify, guardSection, type StreamedSections } from "./types"
import type { SectionData } from "@/lib/counter/section-data"

/**
 * Count & waste — Orders: a draft of what each vendor should bring a store,
 * for the owner to test against what they would have ordered. "Skip this
 * week's count" (`Store.draftSkipCount`) drafts as if the last 7 days' counts
 * never happened, rolling on hand forward from the count before. The arithmetic is
 * `draftLine` in `draft-orders.ts`; this file only gathers its inputs.
 *
 * Tenancy: the store is matched on `accountId`, ingredients and lead times are
 * filtered by it, and invoice lines go through `invoice.store.accountId`.
 */

const DAY_MS = 86_400_000
const FORECAST_DAYS = 14
/** Used when a vendor has too few invoices to measure. Said on the line. */
const FALLBACK_LEAD_DAYS = 3
/** Past this many days since the last count, a line says the count was skipped. */
const STALE_COUNT_DAYS = 7
/** "Skip this week's count" ignores counts newer than this. */
const SKIP_WINDOW_DAYS = 7

export type DraftStore = { id: string; name: string; skip: boolean }

export type DraftRow = {
  id: string
  name: string
  unit: string
  onHand: string
  perDay: string
  /** Where the expected use came from, in words. */
  basis: string
  /** "Order today" / "Order by Fri 14" / "Covered". */
  when: string
  urgent: boolean
  /** "3 cases" or "40 oz" when the case size is unknown. */
  order: string
  /** "3 × 30 lb" — what a case is, when known. */
  caseNote: string | null
  needCaseSize: boolean
  /** How the number was reached, one line, for the "how" fold. */
  how: string
  dollars: number | null
  /** Some deliveries since the count could not be turned into recipe units. */
  partial: boolean
  /** "Counted today" / "Counted 9 days ago": how far the on-hand has rolled forward. */
  counted: string
  /** More than a week since the last count, so the estimate has drifted further. */
  stale: boolean
}

export type DraftVendor = {
  vendor: string
  lead: string
  rows: DraftRow[]
  dollars: number
  unpriced: number
}

/** One line of the Stock view: what is on the shelf and how long it lasts. */
export type StockRow = {
  id: string
  name: string
  onHand: string
  perDay: string
  /** Days until it runs out at expected use; null when it can't be read. */
  daysLeft: number | null
  /** Days until an order must be placed to arrive in time (lead + buffer). */
  orderAt: number | null
  /** "Runs out Fri Nov 14", "Lasts 60+ days", "Not counted". */
  runsOut: string
  status: "now" | "soon" | "ok" | "unknown"
  statusText: string
  counted: string
  stale: boolean
}

/** One card per store: how big its draft is right now. */
export type StoreSummary = {
  id: string
  name: string
  skip: boolean
  lines: number
  urgent: number
  dollars: number
  unpriced: number
  notCounted: number
}

export type DraftData = {
  stores: DraftStore[]
  store: DraftStore
  coverDays: number
  vendors: DraftVendor[]
  covered: number
  notCounted: string[]
  belowZero: string[]
  stock: StockRow[]
  summaries: StoreSummary[]
}

export type DraftSections = { drafts: SectionData<DraftData | null> }

function q(n: number): string {
  return fmtQty(Math.round(n * 10) / 10)
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Los_Angeles" })
}

function countedLabel(at: Date, asOf: Date): string {
  const days = Math.floor((asOf.getTime() - at.getTime()) / DAY_MS)
  if (days <= 0) return "Counted today"
  if (days === 1) return "Counted yesterday"
  return `Counted ${days} days ago`
}

function whenLabel(line: DraftLine, asOf: Date): { when: string; urgent: boolean } {
  if (line.short <= 0) return { when: "Covered", urgent: false }
  if (line.status === "urgent" || line.status === "reorder_now" || !line.orderBy) return { when: "Order today", urgent: true }
  const days = Math.round((line.orderBy.getTime() - asOf.getTime()) / DAY_MS)
  if (days <= 0) return { when: "Order today", urgent: true }
  return { when: `Order by ${dayLabel(line.orderBy)}`, urgent: false }
}

export function getDraftOrderSectionPromises(opts: { accountId: string; storeId?: string; coverDays: number }): StreamedSections<DraftSections> {
  return {
    drafts: guardSection(
      classify(async (): Promise<DraftData | null> => {
        const stores = (
          await prisma.store.findMany({
            where: { accountId: opts.accountId, isActive: true },
            select: { id: true, name: true, draftSkipCount: true },
            orderBy: { name: "asc" },
          })
        ).map((s) => ({ id: s.id, name: s.name, skip: s.draftSkipCount }))
        const store = stores.find((s) => s.id === opts.storeId) ?? stores[0]
        if (!store) return null
        const asOf = new Date()
        // Every store is drafted so the store cards can compare them; the
        // picked one is shown in full.
        const built = await Promise.all(stores.map((s) => buildDrafts(opts.accountId, s.id, opts.coverDays, asOf, s.skip)))
        const summaries: StoreSummary[] = stores.map((s, i) => {
          const b = built[i]
          const rows = b.vendors.flatMap((v) => v.rows)
          return {
            ...s,
            lines: rows.length,
            urgent: rows.filter((r) => r.urgent).length,
            dollars: b.vendors.reduce((t, v) => t + v.dollars, 0),
            unpriced: b.vendors.reduce((t, v) => t + v.unpriced, 0),
            notCounted: b.notCounted.length,
          }
        })
        const mine = built[stores.indexOf(store)]
        return { stores, store, coverDays: opts.coverDays, summaries, ...mine }
      }, { retryAction: "count.orders", isEmpty: (d) => d === null, emptyReason: "no_stores" }),
      "count.orders",
    ),
  }
}

async function buildDrafts(
  accountId: string,
  storeId: string,
  coverDays: number,
  asOf: Date,
  skipCount: boolean,
): Promise<Pick<DraftData, "vendors" | "covered" | "notCounted" | "belowZero" | "stock">> {
  const [ingredients, leadRows, liveCtx, vendorLines, olderCounts] = await Promise.all([
    prisma.canonicalIngredient.findMany({
      where: { accountId },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, recipeUnit: true, costPerRecipeUnit: true,
        caseUnit: true, recipeUnitsPerCase: true, innerPackUnit: true, innerPacksPerCase: true,
      },
    }),
    prisma.vendorLeadTime.findMany({
      where: { accountId },
      select: { vendorNameNormalized: true, medianLeadDays: true },
    }),
    loadStoreInventoryContext({ storeId, accountId, asOf }),
    prisma.invoiceLineItem.findMany({
      where: { canonicalIngredientId: { not: null }, invoice: { storeId, store: { accountId } } },
      orderBy: { invoice: { invoiceDate: "desc" } },
      select: { canonicalIngredientId: true, invoice: { select: { vendorName: true } } },
    }),
    // Only for "Skip this week's count": the counts from before the last 7 days.
    skipCount
      ? prisma.stockCountLine.findMany({
          where: {
            stockCount: {
              storeId,
              store: { accountId },
              status: "COMPLETED",
              countedAt: { lt: new Date(asOf.getTime() - SKIP_WINDOW_DAYS * DAY_MS) },
            },
          },
          orderBy: { stockCount: { countedAt: "desc" } },
          select: { canonicalIngredientId: true, qtyInRecipeUnit: true, stockCount: { select: { countedAt: true } } },
        })
      : Promise.resolve(null),
  ])
  // Skipping swaps only the starting count. Invoices, sales and waste after it
  // are then rolled forward by the same `runningOnHandFromContext`.
  let ctx = liveCtx
  if (olderCounts) {
    const base = new Map<string, { qtyInRecipeUnit: number; countedAt: Date }>()
    for (const l of olderCounts) {
      if (!base.has(l.canonicalIngredientId)) base.set(l.canonicalIngredientId, { qtyInRecipeUnit: l.qtyInRecipeUnit, countedAt: l.stockCount.countedAt })
    }
    ctx = { ...liveCtx, lastCountByIngredient: base }
  }
  // The window starts on the store's own (LA) business day. When sales for
  // today are already in, on hand has had them taken off, so counting today's
  // forecast again would order today's use twice: start tomorrow instead.
  const todayKey = asOf.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
  const soldToday = ctx.sales.some((r) => r.date.toISOString().slice(0, 10) === todayKey)
  const from = new Date(Date.parse(`${todayKey}T00:00:00Z`) + (soldToday ? DAY_MS : 0))
  const forecast = await computeForecastShapedDepletion({
    accountId,
    storeIds: [storeId],
    ingredientIds: ingredients.map((i) => i.id),
    from,
    days: FORECAST_DAYS,
  })

  const leadByVendor = new Map(leadRows.map((r) => [r.vendorNameNormalized, r.medianLeadDays]))
  const vendorOf = new Map<string, string>()
  for (const l of vendorLines) {
    if (l.canonicalIngredientId && !vendorOf.has(l.canonicalIngredientId)) vendorOf.set(l.canonicalIngredientId, l.invoice.vendorName)
  }

  const groups = new Map<string, DraftVendor>()
  const notCounted: string[] = []
  const belowZero: string[] = []
  const stock: StockRow[] = []
  let covered = 0

  for (const ing of ingredients) {
    const unit = ing.recipeUnit ?? ""
    const shaped = forecast.get(ing.id)
    const flat = dailyDepletionRateFromContext(ctx, ing)
    const useForecast = shaped != null && shaped.totalQty > 0
    const series = useForecast ? shaped.days.map((d) => d.qty) : []
    const tailRate = useForecast ? shaped.meanPerDay : flat.ratePerDay
    // Nothing on the menu uses it, by forecast or by recent sales: there is no
    // sales-based reason to order it, so it is left to the owner.
    if (!(tailRate > 0)) continue

    const oh = runningOnHandFromContext(ctx, ing)
    if (oh.baseAt === null) {
      notCounted.push(ing.name)
      stock.push({
        id: ing.id, name: ing.name, onHand: "—", perDay: `${q(tailRate)} ${unit}`, daysLeft: null, orderAt: null,
        runsOut: "Not counted", status: "unknown", statusText: "Count it", counted: "Never counted", stale: false,
      })
      continue
    }
    const counted = countedLabel(oh.baseAt, asOf)
    const stale = asOf.getTime() - oh.baseAt.getTime() > STALE_COUNT_DAYS * DAY_MS
    if (oh.onHand < 0) {
      belowZero.push(ing.name)
      stock.push({
        id: ing.id, name: ing.name, onHand: `${q(oh.onHand)} ${unit}`, perDay: `${q(tailRate)} ${unit}`, daysLeft: null, orderAt: null,
        runsOut: "Reads below zero", status: "unknown", statusText: "Count again", counted, stale,
      })
      continue
    }

    const vendorRaw = vendorOf.get(ing.id) ?? null
    const measured = vendorRaw ? leadByVendor.get(normalizeVendorName(vendorRaw)) : undefined
    const leadDays = measured ?? FALLBACK_LEAD_DAYS
    const line = draftLine({
      onHand: oh.onHand,
      series,
      tailRate,
      leadDays,
      coverDays,
      recipeUnitsPerCase: ing.recipeUnitsPerCase,
      asOf,
    })
    const { when, urgent } = whenLabel(line, asOf)
    const daysLeft = daysUntilOut(oh.onHand, series, tailRate)
    const ordering = line.orderQty > 0
    stock.push({
      id: ing.id,
      name: ing.name,
      onHand: `${q(oh.onHand)} ${unit}`,
      perDay: `${q(line.perDay)} ${unit}`,
      daysLeft,
      orderAt: leadDays + line.safetyDays,
      runsOut:
        daysLeft == null ? "Not used lately"
        : daysLeft >= 60 ? "Lasts 60+ days"
        : daysLeft < 1 ? "Runs out today"
        : `Runs out ${dayLabel(new Date(from.getTime() + daysLeft * DAY_MS))}`,
      status: !ordering ? "ok" : urgent ? "now" : "soon",
      statusText: !ordering ? "Enough" : when,
      counted,
      stale,
    })
    // `orderQty`, not `short`: float noise can leave a sliver short that rounds to 0 cases.
    if (!ordering) {
      covered++
      continue
    }

    const perCase = ing.recipeUnitsPerCase
    const caseWord = (ing.caseUnit ?? "case").toLowerCase() === "cs" ? "case" : (ing.caseUnit ?? "case").toLowerCase()
    const order = line.cases != null
      ? `${line.cases} ${line.cases === 1 ? caseWord : `${caseWord}s`}`
      : `${q(line.orderQty)} ${unit}`
    const dollars = ing.costPerRecipeUnit != null ? line.orderQty * ing.costPerRecipeUnit : null
    const basis = useForecast ? "store's 14-day sales forecast × recipes" : "recent sales × recipes"
    const how =
      `Use ${q(line.need)} ${unit} over ${q(line.windowDays)} days from ${soldToday ? "tomorrow" : "today"} ` +
      `(${q(leadDays)} to arrive + ${coverDays} to last + ${q(line.safetyDays)} buffer) − ${q(oh.onHand)} on hand = ${q(line.short)} ${unit} short` +
      (perCase ? `, ${q(perCase)} ${unit} a case, rounded up` : ", rounded up")

    // Grouped on the normalized name, so "SYSCO" and "Sysco" are one vendor.
    const key = vendorRaw ? normalizeVendorName(vendorRaw) : ""
    let g = groups.get(key)
    if (!g) {
      g = {
        vendor: vendorRaw ?? "No invoice at this store yet",
        lead: measured != null ? `Arrives in about ${q(measured)} days` : `Delivery time not measured yet, ${FALLBACK_LEAD_DAYS} days used`,
        rows: [],
        dollars: 0,
        unpriced: 0,
      }
      groups.set(key, g)
    }
    g.rows.push({
      id: ing.id,
      name: ing.name,
      unit,
      onHand: `${q(oh.onHand)} ${unit}`,
      perDay: `${q(line.perDay)} ${unit}`,
      basis,
      when,
      urgent,
      order,
      caseNote: perCase ? `1 ${caseWord} = ${q(perCase)} ${unit}` : null,
      needCaseSize: perCase == null,
      how,
      dollars,
      partial: oh.partial,
      counted,
      stale,
    })
    if (dollars != null) g.dollars += dollars
    else g.unpriced++
  }

  const vendors = [...groups.values()]
  for (const g of vendors) g.rows.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.name.localeCompare(b.name))
  vendors.sort((a, b) => Number(b.rows.some((r) => r.urgent)) - Number(a.rows.some((r) => r.urgent)) || a.vendor.localeCompare(b.vendor))
  // Soonest to run out first; unreadable lines (not counted, below zero) on top
  // because they need a hand before anything else can be trusted.
  const rank = (r: StockRow) => (r.status === "unknown" ? -1 : r.daysLeft ?? 999)
  stock.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  return { vendors, covered, notCounted, belowZero, stock }
}
