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
import { batchCanonicalSpend } from "@/lib/canonical-spend-batch"
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

  const [canonicals, spendById] = await Promise.all([
    listCanonicalIngredients(),
    batchCanonicalSpend(scope.accountId),
  ])

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
