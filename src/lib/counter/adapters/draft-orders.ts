import { prisma } from "@/lib/prisma"
import {
  loadStoreInventoryContext,
  runningOnHandFromContext,
  dailyDepletionRateFromContext,
} from "@/lib/inventory/store-inventory-context"
import { computeForecastShapedDepletion } from "@/lib/inventory/forecast-depletion"
import { normalizeVendorName } from "@/lib/vendor-normalize"
import { draftLine, type DraftLine } from "@/lib/counter/draft-orders"
import { fmtQty } from "@/lib/counter/count-layers"
import { classify, guardSection, type StreamedSections } from "./types"
import type { SectionData } from "@/lib/counter/section-data"

/**
 * Count & waste — Orders: a draft of what each vendor should bring a store,
 * for the owner to test against what they would have ordered. Off per store
 * until the owner turns it on (`Store.draftOrdersOn`). The arithmetic is
 * `draftLine` in `draft-orders.ts`; this file only gathers its inputs.
 *
 * Tenancy: the store is matched on `accountId`, ingredients and lead times are
 * filtered by it, and invoice lines go through `invoice.store.accountId`.
 */

const DAY_MS = 86_400_000
const FORECAST_DAYS = 14
/** Used when a vendor has too few invoices to measure. Said on the line. */
const FALLBACK_LEAD_DAYS = 3

export type DraftStore = { id: string; name: string; on: boolean }

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
}

export type DraftVendor = {
  vendor: string
  lead: string
  rows: DraftRow[]
  dollars: number
  unpriced: number
}

export type DraftData = {
  stores: DraftStore[]
  store: DraftStore
  coverDays: number
  vendors: DraftVendor[]
  covered: number
  notCounted: string[]
  belowZero: string[]
}

export type DraftSections = { drafts: SectionData<DraftData | null> }

function q(n: number): string {
  return fmtQty(Math.round(n * 10) / 10)
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Los_Angeles" })
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
            select: { id: true, name: true, draftOrdersOn: true },
            orderBy: { name: "asc" },
          })
        ).map((s) => ({ id: s.id, name: s.name, on: s.draftOrdersOn }))
        const store = stores.find((s) => s.id === opts.storeId) ?? stores[0]
        if (!store) return null
        const base: DraftData = { stores, store, coverDays: opts.coverDays, vendors: [], covered: 0, notCounted: [], belowZero: [] }
        if (!store.on) return base
        return { ...base, ...(await buildDrafts(opts.accountId, store.id, opts.coverDays, new Date())) }
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
): Promise<Pick<DraftData, "vendors" | "covered" | "notCounted" | "belowZero">> {
  const [ingredients, leadRows, ctx, vendorLines] = await Promise.all([
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
  ])
  const forecast = await computeForecastShapedDepletion({
    accountId,
    storeIds: [storeId],
    ingredientIds: ingredients.map((i) => i.id),
    from: asOf,
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
      continue
    }
    if (oh.onHand < 0) {
      belowZero.push(ing.name)
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
    if (line.short <= 0) {
      covered++
      continue
    }

    const { when, urgent } = whenLabel(line, asOf)
    const perCase = ing.recipeUnitsPerCase
    const caseWord = (ing.caseUnit ?? "case").toLowerCase() === "cs" ? "case" : (ing.caseUnit ?? "case").toLowerCase()
    const order = line.cases != null
      ? `${line.cases} ${line.cases === 1 ? caseWord : `${caseWord}s`}`
      : `${q(line.orderQty)} ${unit}`
    const dollars = ing.costPerRecipeUnit != null ? line.orderQty * ing.costPerRecipeUnit : null
    const basis = useForecast ? "store's 14-day sales forecast × recipes" : "recent sales × recipes"
    const how =
      `Use ${q(line.need)} ${unit} over ${q(line.windowDays)} days ` +
      `(${q(leadDays)} to arrive + ${coverDays} to last + ${q(line.safetyDays)} buffer) − ${q(oh.onHand)} on hand = ${q(line.short)} ${unit} short` +
      (perCase ? `, ${q(perCase)} ${unit} a case, rounded up` : ", rounded up")

    const key = vendorRaw ?? "No invoice at this store yet"
    let g = groups.get(key)
    if (!g) {
      g = {
        vendor: key,
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
    })
    if (dollars != null) g.dollars += dollars
    else g.unpriced++
  }

  const vendors = [...groups.values()]
  for (const g of vendors) g.rows.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.name.localeCompare(b.name))
  vendors.sort((a, b) => Number(b.rows.some((r) => r.urgent)) - Number(a.rows.some((r) => r.urgent)) || a.vendor.localeCompare(b.vendor))
  return { vendors, covered, notCounted, belowZero }
}
