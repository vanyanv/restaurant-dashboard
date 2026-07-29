// The write-back half of the auto-match ladder. Turns the
// ingredient-auto-match-ladder.ts's `ResolvedGroup[]` into either real
// writes (canonical link + learned sku/alias + cost recompute, mirroring
// confirmSkuMatch) or shadow-only IngredientMatchDecision rows.
//
// Error isolation: each group's write-back is independent. One group's
// transaction failing increments the returned `failed` counter and moves on
// — it does not stop the rest of the batch, and it does not throw.

import { prisma } from "@/lib/prisma"
import { recomputeCanonicalCost } from "@/lib/ingredient-cost"
import type { ResolvedGroup } from "@/lib/ingredient-auto-match-core"

export type PersistResult = {
  /** Groups whose write actually committed — the source of truth for the
   * ladder's autoExact/autoVector/autoLlm summary counts, NOT `resolved`
   * itself (which only says what the ladder proposed). */
  applied: ResolvedGroup[]
  costsUpdated: number
  failed: number
}

export async function persistResolvedGroups(input: {
  accountId: string
  ownerId: string
  resolved: ResolvedGroup[]
  shadow: boolean
}): Promise<PersistResult> {
  const { accountId, ownerId, resolved, shadow } = input
  const applied: ResolvedGroup[] = []
  let failed = 0

  if (shadow) {
    for (const r of resolved) {
      try {
        await prisma.ingredientMatchDecision.create({ data: decisionData(accountId, r, "SHADOW") })
        applied.push(r)
      } catch (e) {
        console.warn(`[ingredient-auto-match] shadow decision write failed for group ${r.group.groupKey}:`, e)
        failed += r.group.lineItemIds.length
      }
    }
    return { applied, costsUpdated: 0, failed }
  }

  const touchedCanonicals = new Set<string>()
  const now = new Date()
  for (const r of resolved) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.invoiceLineItem.updateMany({
          where: { id: { in: r.group.lineItemIds } },
          data: { canonicalIngredientId: r.canonicalIngredientId, matchSource: r.layer, matchedAt: now },
        })

        // Learn the match forward, mirroring confirmSkuMatch: sku when the
        // sample line has one, else an alias scoped to the sample line's
        // store.
        if (r.group.sku) {
          await tx.ingredientSkuMatch.upsert({
            where: {
              ownerId_vendorName_sku: { ownerId, vendorName: r.group.vendorName, sku: r.group.sku },
            },
            update: { canonicalIngredientId: r.canonicalIngredientId, confirmedBy: ownerId, confirmedAt: now },
            create: {
              ownerId,
              accountId,
              vendorName: r.group.vendorName,
              sku: r.group.sku,
              canonicalIngredientId: r.canonicalIngredientId,
              conversionFactor: 1,
              fromUnit: r.group.unit ?? "unit",
              toUnit: r.group.unit ?? "unit",
              confirmedBy: ownerId,
            },
          })
        } else if (r.group.storeId) {
          await tx.ingredientAlias.upsert({
            where: { storeId_rawName: { storeId: r.group.storeId, rawName: r.group.productName } },
            update: { canonicalIngredientId: r.canonicalIngredientId },
            create: {
              storeId: r.group.storeId,
              canonicalIngredientId: r.canonicalIngredientId,
              canonicalName: "",
              rawName: r.group.productName,
              conversionFactor: 1,
              fromUnit: r.group.unit ?? "unit",
              toUnit: r.group.unit ?? "unit",
            },
          })
        }

        await tx.ingredientMatchDecision.create({ data: decisionData(accountId, r, "APPLIED") })
      })
      applied.push(r)
      touchedCanonicals.add(r.canonicalIngredientId)
    } catch (e) {
      console.warn(`[ingredient-auto-match] write-back failed for group ${r.group.groupKey} — left for review:`, e)
      failed += r.group.lineItemIds.length
    }
  }

  let costsUpdated = 0
  for (const canonicalId of touchedCanonicals) {
    try {
      const res = await recomputeCanonicalCost(canonicalId)
      if (res.status === "updated") costsUpdated++
    } catch (e) {
      console.warn("[ingredient-auto-match] recomputeCanonicalCost failed:", e)
    }
  }

  return { applied, costsUpdated, failed }
}

function decisionData(accountId: string, r: ResolvedGroup, status: "APPLIED" | "SHADOW") {
  return {
    accountId,
    groupKey: r.group.groupKey,
    vendorName: r.group.vendorName,
    sku: r.group.sku,
    productName: r.group.productName,
    layer: r.layer,
    confidence: r.confidence,
    topScore: r.topScore,
    margin: r.margin,
    reasoning: r.reasoning,
    model: r.model,
    ...(r.candidates ? { candidates: r.candidates } : {}),
    canonicalIngredientId: r.canonicalIngredientId,
    createdCanonical: false,
    linkedLineItemIds: r.group.lineItemIds,
    linkedLineItemCount: r.group.lineItemIds.length,
    status,
  }
}
