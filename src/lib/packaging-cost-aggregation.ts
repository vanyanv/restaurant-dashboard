/**
 * Pure helper for the dine-in avoided-cost rollup.
 *
 * Replaces the per-order findMany loop in `getPackagingCostData` (which
 * fetched every dine-in order with two-level nested includes). The SQL
 * pre-groups orders by basket signature and returns one row per unique
 * signature with an `occurrences` count; this helper runs the (heavy)
 * `packOrderCostAware` classifier once per signature and weights by count.
 *
 * Treats a null unit cost as 0 — preserves the prior `costForCounts`
 * behaviour at the call site, which already coerced missing prices to 0.
 */

import {
  PACKAGING_SCENARIO,
  packOrderCostAware,
  type ContainerCounts,
  type ContainerGroup,
} from "@/lib/container-packaging"

export type AvoidedCostSignatureRow = {
  fulfillmentMode: string | null
  items: Array<{
    name: string
    quantity: number
    subItems: Array<{
      name: string
      quantity: number
      subHeader: string | null
    }>
  }>
  occurrences: number
}

const ALL_GROUPS = [
  "medium_6x6",
  "large_9x6",
  "one_compartment",
] satisfies ContainerGroup[]

function priceCounts(
  counts: ContainerCounts,
  unitCosts: Record<ContainerGroup, number | null>
): number {
  let total = 0
  for (const group of ALL_GROUPS) {
    const unitCost = unitCosts[group]
    if (unitCost == null) continue
    total += counts[group] * unitCost
  }
  return total
}

export function summarizeAvoidedDineInCost(
  rows: AvoidedCostSignatureRow[],
  unitCosts: Record<ContainerGroup, number | null>
): number {
  let total = 0
  for (const row of rows) {
    const packed = packOrderCostAware(
      { fulfillmentMode: row.fulfillmentMode, items: row.items },
      unitCosts,
      PACKAGING_SCENARIO
    )
    total += priceCounts(packed.counts, unitCosts) * row.occurrences
  }
  return total
}
