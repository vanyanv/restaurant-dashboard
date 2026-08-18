"use server"

// The undo half of the invoice-line auto-match ladder
// (see ingredient-auto-match.ts / ingredient-auto-match-ladder.ts /
// ingredient-auto-match-persist.ts for the write side this reverses).
//
// This is the safety net the whole feature was approved on: every
// automatic match is recorded as an IngredientMatchDecision, and
// `undoAutoMatch` is how an owner reverses one in a single click. An
// UNDONE decision row is not just history — `ingredient-auto-match-ladder.ts`
// reads UNDONE rows and refuses to re-propose that exact (groupKey,
// canonicalIngredientId) pairing at any rung, and routes any group with
// undo history away from the LLM rung entirely. This file must not build a
// second suppression mechanism; setting `status: "UNDONE"` on the decision
// IS the suppression.

import { getAuthScope as requireScope } from "@/lib/auth-scope"
import { prisma } from "@/lib/prisma"
import { recomputeCanonicalCost } from "@/lib/ingredient-cost"
import { vendorMatchKey } from "@/lib/vendor-normalize"
import { revalidatePath } from "next/cache"

export type RecentAutoMatchCandidate = { id: string; name: string; score: number }

export type RecentAutoMatch = {
  id: string
  groupKey: string
  vendorName: string
  sku: string | null
  productName: string
  layer: string
  confidence: number
  topScore: number | null
  margin: number | null
  reasoning: string | null
  model: string | null
  candidates: RecentAutoMatchCandidate[] | null
  canonicalIngredientId: string
  canonicalIngredientName: string | null
  createdCanonical: boolean
  linkedLineItemIds: string[]
  linkedLineItemCount: number
  status: "APPLIED" | "UNDONE" | "SHADOW"
  createdAt: Date
  undoneAt: Date | null
  undoneById: string | null
}

/**
 * Recent automatic ingredient-match decisions — feeds the undo/review UI
 * (product, what it linked to, confidence, the model's reasoning, and the
 * scored runner-ups). Defaults to a 7-day window.
 *
 * SHADOW rows are included by default: during a trial run they're exactly
 * what the operator wants to see (what the ladder WOULD have auto-linked,
 * with nothing actually written). Pass `excludeShadow: true` to hide them
 * once the account has moved past trial mode.
 */
export async function listRecentAutoMatches(
  days: number = 7,
  opts?: { excludeShadow?: boolean }
): Promise<RecentAutoMatch[]> {
  const scope = await requireScope()
  if (!scope) return []
  const { accountId } = scope

  const since = new Date()
  since.setDate(since.getDate() - days)

  const decisions = await prisma.ingredientMatchDecision.findMany({
    where: {
      accountId,
      createdAt: { gte: since },
      // SUGGESTED rows are never activity: they linked nothing. They belong
      // to the review inbox's pre-fill, and listing them here would report
      // work the automation explicitly declined to do as work it did.
      status: opts?.excludeShadow
        ? { notIn: ["SHADOW", "SUGGESTED"] }
        : { not: "SUGGESTED" },
    },
    orderBy: { createdAt: "desc" },
    include: { canonicalIngredient: { select: { name: true } } },
  })

  return decisions.map((d) => ({
    id: d.id,
    groupKey: d.groupKey,
    vendorName: d.vendorName,
    sku: d.sku,
    productName: d.productName,
    layer: d.layer,
    confidence: d.confidence,
    topScore: d.topScore,
    margin: d.margin,
    reasoning: d.reasoning,
    model: d.model,
    candidates: (d.candidates as RecentAutoMatchCandidate[] | null) ?? null,
    canonicalIngredientId: d.canonicalIngredientId,
    canonicalIngredientName: d.canonicalIngredient?.name ?? null,
    createdCanonical: d.createdCanonical,
    linkedLineItemIds: d.linkedLineItemIds,
    linkedLineItemCount: d.linkedLineItemCount,
    status: d.status as RecentAutoMatch["status"],
    createdAt: d.createdAt,
    undoneAt: d.undoneAt,
    undoneById: d.undoneById,
  }))
}

export type UndoAutoMatchResult = {
  decisionId: string
  /** True when the decision was already UNDONE — a safe no-op, not a
   * second unlink. Every other field is zero/false/null in that case. */
  alreadyUndone: boolean
  /** Line items actually unlinked — a subset of `linkedLineItemIds`,
   * excluding any a human re-confirmed after the automatic match. */
  unlinkedCount: number
  /** Whether the learned IngredientSkuMatch/IngredientAlias row this
   * decision taught the system was found and removed. */
  learnedMatchRemoved: boolean
  canonicalDeleted: boolean
  /** Set when `createdCanonical` was true but the canonical is still
   * referenced elsewhere, so it was kept (unlink-only). */
  canonicalKeptReason: string | null
  costRecomputed: boolean
}

/**
 * Reverse one automatic match, in order:
 *
 *   1. Unlink exactly `linkedLineItemIds`, but only rows still carrying an
 *      `auto-*` matchSource for THIS decision's canonical — a line a human
 *      manually re-confirmed since (matchSource flips to "sku"/"alias" on
 *      manual confirm, or to a different auto-* layer/canonical on a later
 *      ladder run) is left alone.
 *   2. Delete the IngredientSkuMatch / IngredientAlias row this decision
 *      learned, so the pattern stops applying to future invoices —
 *      independent of which individual lines step 1 actually touched.
 *   3. Defensive, unreachable today (`createdCanonical` is always false
 *      while AUTO_CREATE_ENABLED is off): if the decision created its own
 *      canonical, delete it (and its embedding) only when nothing else
 *      references it. The FK is `onDelete: Restrict`, so this decision row
 *      — which still references the canonical — must be REMOVED, not
 *      merely updated, before that delete. A deleted canonical can never be
 *      re-proposed by the ladder anyway, so there is nothing left to
 *      suppress and no UNDONE row is needed for it.
 *   4. Recompute the canonical's cost outside the transaction (mirroring
 *      confirmSkuMatch/persistResolvedGroups) so a recompute failure never
 *      rolls back the undo itself. Skipped when the canonical was deleted.
 *   5. Otherwise, set status "UNDONE" — this row IS the permanent
 *      suppression the ladder reads.
 *
 * Steps 1, 2, and 5 (or 1, 2, and the decision-row removal in step 3) run
 * inside one transaction: a partial undo that unlinks lines but leaves the
 * decision APPLIED would silently re-link on the next sync.
 */
export async function undoAutoMatch(decisionId: string): Promise<UndoAutoMatchResult> {
  const scope = await requireScope()
  if (!scope) throw new Error("Not authenticated")
  const { accountId, ownerId } = scope

  const decision = await prisma.ingredientMatchDecision.findFirst({
    where: { id: decisionId, accountId },
  })
  if (!decision) throw new Error("Decision not found")

  if (decision.status === "UNDONE") {
    return {
      decisionId,
      alreadyUndone: true,
      unlinkedCount: 0,
      learnedMatchRemoved: false,
      canonicalDeleted: false,
      canonicalKeptReason: null,
      costRecomputed: false,
    }
  }

  let unlinkedCount = 0
  let learnedMatchRemoved = false
  let canonicalDeleted = false
  let canonicalKeptReason: string | null = null

  await prisma.$transaction(async (tx) => {
    // Step 1 — look the lines up first (not a blind updateMany) so we know
    // both which are still eligible (auto-* matchSource, still pointing at
    // THIS decision's canonical) and which store(s) an alias, if any, was
    // scoped to for step 2.
    const linkedLines = await tx.invoiceLineItem.findMany({
      where: { id: { in: decision.linkedLineItemIds } },
      select: { id: true, matchSource: true, invoice: { select: { storeId: true } } },
    })
    const eligibleIds = linkedLines
      .filter(
        (li) =>
          li.matchSource != null &&
          li.matchSource.startsWith("auto-")
      )
      .map((li) => li.id)

    if (eligibleIds.length > 0) {
      const unlink = await tx.invoiceLineItem.updateMany({
        where: { id: { in: eligibleIds } },
        data: { canonicalIngredientId: null, matchSource: null, matchedAt: null },
      })
      unlinkedCount = unlink.count
    }

    // Step 2 — un-teach the learned pattern, regardless of which
    // individual lines step 1 left alone.
    if (decision.sku) {
      // Match on vendorKey, not the decision's stored spelling: the row this
      // undo has to find is keyed the same way the matcher looks it up.
      const removed = await tx.ingredientSkuMatch.deleteMany({
        where: {
          accountId,
          vendorKey: vendorMatchKey(decision.vendorName),
          sku: decision.sku,
          canonicalIngredientId: decision.canonicalIngredientId,
        },
      })
      learnedMatchRemoved = removed.count > 0
    } else {
      const storeIds = [
        ...new Set(
          linkedLines
            .map((li) => li.invoice.storeId)
            .filter((s): s is string => s != null)
        ),
      ]
      if (storeIds.length > 0) {
        const removed = await tx.ingredientAlias.deleteMany({
          where: {
            storeId: { in: storeIds },
            rawName: decision.productName,
            canonicalIngredientId: decision.canonicalIngredientId,
          },
        })
        learnedMatchRemoved = removed.count > 0
      }
    }

    // Step 3 — defensive, unreachable while AUTO_CREATE_ENABLED is false.
    if (decision.createdCanonical) {
      const [recipeUses, stockUses, remainingLineItems] = await Promise.all([
        tx.recipeIngredient.count({
          where: { canonicalIngredientId: decision.canonicalIngredientId },
        }),
        tx.stockCountLine.count({
          where: { canonicalIngredientId: decision.canonicalIngredientId },
        }),
        tx.invoiceLineItem.count({
          where: { canonicalIngredientId: decision.canonicalIngredientId },
        }),
      ])

      if (recipeUses === 0 && stockUses === 0 && remainingLineItems === 0) {
        // Remove (not update) this decision row: it still references the
        // canonical via a non-null, onDelete:Restrict FK, and once the
        // canonical is gone there is nothing left for an UNDONE suppression
        // row to suppress.
        await tx.ingredientMatchDecision.delete({ where: { id: decision.id } })
        await tx.canonicalIngredientEmbedding.deleteMany({
          where: { canonicalIngredientId: decision.canonicalIngredientId },
        })
        await tx.canonicalIngredient.delete({
          where: { id: decision.canonicalIngredientId },
        })
        canonicalDeleted = true
        return
      }

      canonicalKeptReason = `Still referenced (recipes: ${recipeUses}, stock counts: ${stockUses}, invoice lines: ${remainingLineItems}) — unlinked only.`
    }

    // Step 5 — this row IS the permanent suppression from here on.
    await tx.ingredientMatchDecision.update({
      where: { id: decision.id },
      data: { status: "UNDONE", undoneAt: new Date(), undoneById: ownerId },
    })
  })

  // Step 4 — outside the transaction so a recompute failure doesn't roll
  // back the undo. No-op when the canonical no longer exists.
  let costRecomputed = false
  if (!canonicalDeleted) {
    try {
      await recomputeCanonicalCost(decision.canonicalIngredientId)
      costRecomputed = true
    } catch (e) {
      console.warn("[undoAutoMatch] recomputeCanonicalCost failed:", e)
    }
  }

  revalidatePath("/dashboard/ingredients")
  revalidatePath("/dashboard/menu/catalog")
  revalidatePath("/dashboard/recipes")

  return {
    decisionId,
    alreadyUndone: false,
    unlinkedCount,
    learnedMatchRemoved,
    canonicalDeleted,
    canonicalKeptReason,
    costRecomputed,
  }
}
