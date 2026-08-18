"use server"

/**
 * The Pantry ledger: canonical ingredients ranked by what they actually cost.
 *
 * Composes three sources rather than widening any of them —
 * `listCanonicalIngredients` is on mobile's and the recipe editor's critical
 * path and must not grow an aggregation neither of them reads.
 *
 * The row's headline number is `impact90`, not `pctChange`. A percentage
 * cannot be acted on: a +45% move on the fry programme is $7,299 a quarter
 * while a +5% move on sanitizer is $26, and rendering those two the same way
 * is what makes the live page's alerting useless.
 */

import { getAuthScope } from "@/lib/auth-scope"
import { listCanonicalIngredients } from "@/app/actions/canonical-ingredient-actions"
import { prisma } from "@/lib/prisma"
import { batchCanonicalSpend } from "@/lib/canonical-spend-batch"
import { computeIngredientLineCost } from "@/lib/recipe-cost"
import { normalizeVendorName } from "@/lib/vendor-normalize"
import {
  isPackagingStation,
  stationFor,
  type PantryStation,
} from "@/lib/pantry-stations"
import type { CanonicalIngredientSummary } from "@/types/recipe"

export type PantryLedgerRow = CanonicalIngredientSummary & {
  station: PantryStation
  isPackaging: boolean
  /** Net dollars purchased in the last 90 days. The ledger's sort key. */
  spend90: number
  lineCount: number
  vendors: string[]
  skus: string[]
  lastPurchaseAt: Date | null
  /**
   * How many recipes use this ingredient. Zero means its cost never reaches a
   * plate, so it is invisible to menu margin — true of 43 of 76 ingredients.
   */
  recipeUseCount: number
  /**
   * What the 30-day price move is worth against 90-day spend, in dollars.
   * Null when there is no comparable price history — deliberately not 0,
   * which would read as "measured, and flat".
   */
  impact90: number | null
}

export type PantryStationSummary = {
  station: PantryStation
  itemCount: number
  spend: number
}

export type PantryLedgerTotals = {
  spend: number
  foodSpend: number
  packagingSpend: number
  count: number
  foodCount: number
  packagingCount: number
}

export type PantryLedgerData = {
  rows: PantryLedgerRow[]
  stations: PantryStationSummary[]
  totals: PantryLedgerTotals
}

const EMPTY: PantryLedgerData = {
  rows: [],
  stations: [],
  totals: {
    spend: 0,
    foodSpend: 0,
    packagingSpend: 0,
    count: 0,
    foodCount: 0,
    packagingCount: 0,
  },
}

export async function listPantryLedger(): Promise<PantryLedgerData> {
  const scope = await getAuthScope()
  if (!scope) return EMPTY

  const [canonicals, spendById, recipeUses] = await Promise.all([
    listCanonicalIngredients(),
    batchCanonicalSpend(scope.accountId),
    prisma.recipeIngredient.groupBy({
      by: ["canonicalIngredientId"],
      where: {
        canonicalIngredientId: { not: null },
        recipe: { accountId: scope.accountId },
      },
      _count: { _all: true },
    }),
  ])

  const recipeCountById = new Map<string, number>(
    recipeUses
      .filter((r) => r.canonicalIngredientId != null)
      .map((r) => [r.canonicalIngredientId as string, r._count._all])
  )

  const rows: PantryLedgerRow[] = canonicals.map((c) => {
    const spend = spendById.get(c.id)
    const spend90 = spend?.spend ?? 0
    const station = stationFor(c.name, c.category)
    const pct = c.trend30d?.pctChange ?? null

    return {
      ...c,
      station,
      isPackaging: isPackagingStation(station),
      spend90,
      lineCount: spend?.lineCount ?? 0,
      vendors: spend?.vendors ?? [],
      skus: spend?.skus ?? [],
      lastPurchaseAt: spend?.lastPurchaseAt ?? null,
      recipeUseCount: recipeCountById.get(c.id) ?? 0,
      impact90: pct == null ? null : (spend90 * pct) / 100,
    }
  })

  rows.sort((a, b) => b.spend90 - a.spend90)

  const stationMap = new Map<PantryStation, PantryStationSummary>()
  const totals: PantryLedgerTotals = {
    spend: 0,
    foodSpend: 0,
    packagingSpend: 0,
    count: rows.length,
    foodCount: 0,
    packagingCount: 0,
  }

  for (const row of rows) {
    totals.spend += row.spend90
    if (row.isPackaging) {
      totals.packagingSpend += row.spend90
      totals.packagingCount += 1
    } else {
      totals.foodSpend += row.spend90
      totals.foodCount += 1
    }

    const summary =
      stationMap.get(row.station) ?? { station: row.station, itemCount: 0, spend: 0 }
    summary.itemCount += 1
    summary.spend += row.spend90
    stationMap.set(row.station, summary)
  }

  // Stations rank by spend, but packaging is pinned last however much it
  // costs: it is a real expense and not the one an owner manages daily.
  const stations = [...stationMap.values()].sort((a, b) => {
    const aPack = isPackagingStation(a.station)
    const bPack = isPackagingStation(b.station)
    if (aPack !== bPack) return aPack ? 1 : -1
    return b.spend - a.spend
  })

  return { rows, stations, totals }
}

/* ------------------------------------------------------------------ *
 * Expanded row: one ingredient's history
 * ------------------------------------------------------------------ */

export type PantryPricePoint = {
  /** ISO date, yyyy-mm-dd. */
  date: string
  unitPrice: number
  unit: string | null
  vendor: string
  sku: string | null
}

export type PantryDelivery = {
  date: string
  invoiceId: string
  invoiceNumber: string
  /** The RAW invoice line name, not the canonical name — that difference is
   *  how an owner sees that one ingredient spans several products. */
  productName: string
  vendor: string
  sku: string | null
  quantity: number
  unit: string | null
  unitPrice: number
  extendedPrice: number
}

export type PantryProductGroup = {
  sku: string | null
  /** Name from the most recent line in this SKU. */
  productName: string
  vendor: string
  firstAt: string
  lastAt: string
  lastUnitPrice: number
  unit: string | null
  spend: number
}

export type PantryRecipeUse = {
  recipeName: string
  quantity: number
  unit: string
  /** Null when the ingredient has no price, or the units cannot reconcile. */
  costPerServing: number | null
}

export type PantryIngredientHistory = {
  /** Oldest first, capped at the 60 most recent points. */
  series: PantryPricePoint[]
  /** Newest first, 8 most recent. */
  deliveries: PantryDelivery[]
  /** Grouped by SKU, ranked by spend. */
  products: PantryProductGroup[]
  recipes: PantryRecipeUse[]
}

const EMPTY_HISTORY: PantryIngredientHistory = {
  series: [],
  deliveries: [],
  products: [],
  recipes: [],
}

const SERIES_CAP = 60
const DELIVERY_CAP = 8

const isoDay = (d: Date): string => d.toISOString().slice(0, 10)

export async function getPantryIngredientHistory(
  canonicalId: string
): Promise<PantryIngredientHistory> {
  const scope = await getAuthScope()
  if (!scope) return EMPTY_HISTORY

  // Scope the lookup by account as well as id: the canonical id arrives from
  // the client, so this is the tenant boundary, not a convenience.
  const canonical = await prisma.canonicalIngredient.findFirst({
    where: { id: canonicalId, accountId: scope.accountId },
    select: { id: true, recipeUnit: true, costPerRecipeUnit: true },
  })
  if (!canonical) return EMPTY_HISTORY

  const [lines, recipeUses] = await Promise.all([
    prisma.invoiceLineItem.findMany({
      where: {
        canonicalIngredientId: canonicalId,
        invoice: { accountId: scope.accountId, invoiceDate: { not: null } },
      },
      select: {
        unitPrice: true,
        unit: true,
        quantity: true,
        extendedPrice: true,
        sku: true,
        productName: true,
        invoiceId: true,
        invoice: {
          select: { vendorName: true, invoiceDate: true, invoiceNumber: true },
        },
      },
    }),
    prisma.recipeIngredient.findMany({
      where: {
        canonicalIngredientId: canonicalId,
        recipe: { accountId: scope.accountId },
      },
      select: {
        quantity: true,
        unit: true,
        recipe: { select: { itemName: true, servingSize: true } },
      },
    }),
  ])

  const ordered = [...lines]
    .filter((l) => l.invoice.invoiceDate != null)
    .sort(
      (a, b) =>
        a.invoice.invoiceDate!.getTime() - b.invoice.invoiceDate!.getTime()
    )

  const series: PantryPricePoint[] = ordered
    .slice(-SERIES_CAP)
    .map((l) => ({
      date: isoDay(l.invoice.invoiceDate!),
      unitPrice: l.unitPrice,
      unit: l.unit,
      vendor: normalizeVendorName(l.invoice.vendorName),
      sku: l.sku?.trim() || null,
    }))

  const deliveries: PantryDelivery[] = [...ordered]
    .reverse()
    .slice(0, DELIVERY_CAP)
    .map((l) => ({
      date: isoDay(l.invoice.invoiceDate!),
      invoiceId: l.invoiceId,
      invoiceNumber: l.invoice.invoiceNumber,
      productName: l.productName,
      vendor: normalizeVendorName(l.invoice.vendorName),
      sku: l.sku?.trim() || null,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unitPrice,
      extendedPrice: l.extendedPrice,
    }))

  const groups = new Map<string, PantryProductGroup>()
  for (const l of ordered) {
    const sku = l.sku?.trim() || null
    const key = sku ?? "∅"
    const date = isoDay(l.invoice.invoiceDate!)
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, {
        sku,
        productName: l.productName,
        vendor: normalizeVendorName(l.invoice.vendorName),
        firstAt: date,
        lastAt: date,
        lastUnitPrice: l.unitPrice,
        unit: l.unit,
        spend: l.extendedPrice,
      })
      continue
    }
    existing.spend += l.extendedPrice
    if (date < existing.firstAt) existing.firstAt = date
    // `ordered` runs oldest → newest, so the last write wins on the newest line.
    if (date >= existing.lastAt) {
      existing.lastAt = date
      existing.lastUnitPrice = l.unitPrice
      existing.unit = l.unit
      existing.productName = l.productName
      existing.vendor = normalizeVendorName(l.invoice.vendorName)
    }
  }
  const products = [...groups.values()].sort((a, b) => b.spend - a.spend)

  const recipes: PantryRecipeUse[] = recipeUses
    .map((r) => {
      let costPerServing: number | null = null
      if (canonical.costPerRecipeUnit != null && canonical.recipeUnit) {
        const { lineCost, qtyInCostUnit } = computeIngredientLineCost({
          ingredientQuantity: r.quantity,
          ingredientUnit: r.unit,
          costUnitCost: canonical.costPerRecipeUnit,
          costUnit: canonical.recipeUnit,
        })
        costPerServing =
          qtyInCostUnit == null
            ? null
            : lineCost / Math.max(r.recipe.servingSize ?? 1, 1)
      }
      return {
        recipeName: r.recipe.itemName,
        quantity: r.quantity,
        unit: r.unit,
        costPerServing,
      }
    })
    .sort((a, b) => (b.costPerServing ?? 0) - (a.costPerServing ?? 0))

  return { series, deliveries, products, recipes }
}
