/**
 * Pure helpers for aggregating Otter sub-item rows into the catalog shape.
 * Mirrors the SQL-side aggregation so tests can validate the contract that
 * the SQL query is expected to satisfy:
 *
 *   - occurrences = sum(subQty * parentQty)
 *   - mostCommonName  = name with the highest weighted-vote count
 *   - mostCommonHeader = subHeader with the highest weighted-vote count
 *                        (NULL is a valid winner)
 *   - storeIds = distinct store IDs across the rows
 *   - firstSeen / lastSeen = MIN / MAX referenceTimeLocal
 *
 * Rows are sorted by occurrences DESC.
 */

import type { OtterSubItemForCatalog } from "@/types/otter-subitem"

export type RawSubItemRow = {
  skuId: string | null
  name: string
  subHeader: string | null
  quantity: number | null
  parentQuantity: number | null
  storeId: string
  referenceTimeLocal: Date | null
}

export type SubItemAggregateRow = {
  skuId: string
  occurrences: number
  mostCommonName: string
  mostCommonHeader: string | null
  firstSeen: Date | null
  lastSeen: Date | null
  storeIds: string[]
}

export type SubItemMapping = {
  skuId: string
  recipeId: string
  recipeName: string
}

const NULL_HEADER_SENTINEL = "__none__"

type Bucket = {
  skuId: string
  occurrences: number
  nameVotes: Map<string, number>
  headerVotes: Map<string, number>
  firstSeen: Date | null
  lastSeen: Date | null
  storeIds: Set<string>
}

function pickTopKey(votes: Map<string, number>): string | null {
  let best: string | null = null
  let bestN = -1
  for (const [k, n] of votes) {
    if (n > bestN) {
      best = k
      bestN = n
    }
  }
  return best
}

export function aggregateRawSubItemRows(
  rows: RawSubItemRow[]
): SubItemAggregateRow[] {
  const buckets = new Map<string, Bucket>()
  for (const r of rows) {
    if (!r.skuId) continue
    let b = buckets.get(r.skuId)
    if (!b) {
      b = {
        skuId: r.skuId,
        occurrences: 0,
        nameVotes: new Map(),
        headerVotes: new Map(),
        firstSeen: null,
        lastSeen: null,
        storeIds: new Set(),
      }
      buckets.set(r.skuId, b)
    }
    const uses = (r.quantity ?? 1) * (r.parentQuantity ?? 1)
    b.occurrences += uses
    b.nameVotes.set(r.name, (b.nameVotes.get(r.name) ?? 0) + uses)
    const headerKey = r.subHeader ?? NULL_HEADER_SENTINEL
    b.headerVotes.set(headerKey, (b.headerVotes.get(headerKey) ?? 0) + uses)
    b.storeIds.add(r.storeId)
    const ts = r.referenceTimeLocal
    if (ts) {
      if (!b.firstSeen || ts < b.firstSeen) b.firstSeen = ts
      if (!b.lastSeen || ts > b.lastSeen) b.lastSeen = ts
    }
  }

  const aggregates: SubItemAggregateRow[] = []
  for (const b of buckets.values()) {
    const topHeader = pickTopKey(b.headerVotes)
    aggregates.push({
      skuId: b.skuId,
      occurrences: b.occurrences,
      mostCommonName: pickTopKey(b.nameVotes) ?? "",
      mostCommonHeader: topHeader === NULL_HEADER_SENTINEL ? null : topHeader,
      firstSeen: b.firstSeen,
      lastSeen: b.lastSeen,
      storeIds: Array.from(b.storeIds),
    })
  }

  aggregates.sort((a, b) => b.occurrences - a.occurrences)
  return aggregates
}

export function attachSubItemMappings(
  aggregates: SubItemAggregateRow[],
  mappings: SubItemMapping[]
): OtterSubItemForCatalog[] {
  const bySku = new Map<string, { recipeId: string; recipeName: string }>()
  for (const m of mappings) {
    if (!bySku.has(m.skuId)) {
      bySku.set(m.skuId, { recipeId: m.recipeId, recipeName: m.recipeName })
    }
  }
  return aggregates.map((a) => {
    const m = bySku.get(a.skuId)
    return {
      skuId: a.skuId,
      name: a.mostCommonName,
      subHeader: a.mostCommonHeader,
      occurrences: a.occurrences,
      firstSeen: a.firstSeen,
      lastSeen: a.lastSeen,
      storeIds: a.storeIds,
      mappedRecipeId: m?.recipeId ?? null,
      mappedRecipeName: m?.recipeName ?? null,
    }
  })
}
