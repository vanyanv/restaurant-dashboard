// Auto-match ladder for unmatched invoice line items. Runs AFTER the
// deterministic matcher (`matchNewLineItems` in ingredient-matching.ts) —
// this module only ever sees whatever that pass left with
// `canonicalIngredientId: null`.
//
// The ladder, each group exits at the first rung that resolves it:
//   L1 auto-exact  — normalized product name == a canonical's name, or an
//                     IngredientAlias.rawName at ANY store (cross-scope,
//                     unlike matchNewLineItems which only reads the
//                     invoice's own store). Free, confidence 0.99.
//   L2 auto-vector — cosine similarity against CanonicalIngredientEmbedding,
//                     gated by classifyCandidates' HIGH/MARGIN rule.
//   L3 auto-llm    — classifyCandidates' "ambiguous" or "new" groups go to
//                     one adjudicate() call; a draft is only accepted when
//                     confidence clears LLM_ACCEPT AND its matchName
//                     resolves to a member of THAT group's own shortlist.
//   (no L4)        — AUTO_CREATE_ENABLED is asserted false below. A "new"
//                     classification is left for review exactly like
//                     "ambiguous" — this module never calls
//                     canonicalIngredient.create.
//
// Suppression: IngredientMatchDecision rows with status "UNDONE" name a
// (groupKey, canonicalIngredientId) pair that must never be re-linked,
// regardless of which layer would otherwise propose it.
//
// Shadow mode (opts.mode === "shadow"): the full ladder runs for real
// (real embeddings, real LLM calls) so the recorded decisions reflect what
// would actually happen, but the only write is the IngredientMatchDecision
// row itself (status "SHADOW") — no line item update, no sku/alias upsert,
// no cost recompute.

import { prisma } from "@/lib/prisma"
import { recomputeCanonicalCost } from "@/lib/ingredient-cost"
import { embedBatch, toVectorLiteral } from "@/lib/chat/embeddings"
import { adjudicate, type AdjudicatorCase } from "@/lib/ingredient-match-llm"
import {
  classifyCandidates,
  buildMatchQueryText,
  THRESHOLDS,
  AUTO_CREATE_ENABLED,
  type MatchCandidate,
} from "@/lib/ingredient-match-scoring"
import {
  groupUnmatchedLines,
  suppressionKey,
  resolveLlmDraft,
  type LineGroup,
} from "@/lib/ingredient-auto-match-core"

export type AutoMatchResult = {
  scanned: number
  autoExact: number
  autoVector: number
  autoLlm: number
  leftForReview: number
  costsUpdated: number
  llmCalls: number
}

type Layer = "auto-exact" | "auto-vector" | "auto-llm"

type ResolvedGroup = {
  group: LineGroup
  canonicalIngredientId: string
  layer: Layer
  confidence: number
  topScore: number | null
  margin: number | null
  candidates: Array<{ id: string; name: string; score: number }> | null
  model: string | null
  reasoning: string | null
}

const VECTOR_CANDIDATE_LIMIT = 10

function candidateJson(
  candidates: MatchCandidate[] | null
): Array<{ id: string; name: string; score: number }> | null {
  if (!candidates) return null
  return candidates.map((c) => ({ id: c.canonicalIngredientId, name: c.name, score: c.score }))
}

export async function autoResolveUnmatchedLines(
  scope: { accountId: string; ownerId: string | null },
  invoiceIds: string[],
  opts?: { mode?: "shadow" | "on" }
): Promise<AutoMatchResult> {
  // There is no auto-create path in this module — a "new" classification is
  // routed to review exactly like "ambiguous". This assertion exists so
  // that fact stays visible: it fires if AUTO_CREATE_ENABLED is ever
  // flipped without this file being revisited, rather than silently doing
  // nothing (or worse, silently starting to invent canonicals).
  if (AUTO_CREATE_ENABLED) {
    throw new Error(
      "ingredient-auto-match: AUTO_CREATE_ENABLED is true but this module has no L4 auto-create path implemented"
    )
  }

  const shadow = opts?.mode === "shadow"
  const result: AutoMatchResult = {
    scanned: 0,
    autoExact: 0,
    autoVector: 0,
    autoLlm: 0,
    leftForReview: 0,
    costsUpdated: 0,
    llmCalls: 0,
  }
  if (invoiceIds.length === 0) return result

  const { accountId, ownerId } = scope

  const invoices = await prisma.invoice.findMany({
    where: { id: { in: invoiceIds }, accountId },
    select: {
      vendorName: true,
      storeId: true,
      lineItems: {
        where: { canonicalIngredientId: null },
        select: { id: true, sku: true, productName: true, unit: true },
      },
    },
  })

  const groups = groupUnmatchedLines(invoices)
  result.scanned = groups.reduce((n, g) => n + g.lineItemIds.length, 0)
  if (groups.length === 0) return result

  // Suppression set: never re-propose a (groupKey, canonicalIngredientId)
  // pair a human has explicitly undone.
  const undone = await prisma.ingredientMatchDecision.findMany({
    where: { accountId, status: "UNDONE" },
    select: { groupKey: true, canonicalIngredientId: true },
  })
  const suppressed = new Set(undone.map((d) => suppressionKey(d.groupKey, d.canonicalIngredientId)))
  const isSuppressed = (groupKey: string, canonicalIngredientId: string) =>
    suppressed.has(suppressionKey(groupKey, canonicalIngredientId))

  const resolved: ResolvedGroup[] = []

  // ---- L1: cross-scope exact name -----------------------------------
  const canonicals = await prisma.canonicalIngredient.findMany({
    where: { accountId },
    select: { id: true, name: true },
  })
  const canonicalByName = new Map(canonicals.map((c) => [c.name.trim().toLowerCase(), c.id]))

  const aliases = await prisma.ingredientAlias.findMany({
    where: { canonicalIngredientId: { not: null }, store: { accountId } },
    select: { rawName: true, canonicalIngredientId: true },
  })
  const aliasByName = new Map<string, string>()
  for (const a of aliases) {
    if (a.canonicalIngredientId) aliasByName.set(a.rawName.trim().toLowerCase(), a.canonicalIngredientId)
  }

  const afterL1: LineGroup[] = []
  for (const g of groups) {
    const normalizedName = g.productName.trim().toLowerCase()
    const canonicalId = canonicalByName.get(normalizedName) ?? aliasByName.get(normalizedName)
    if (canonicalId && !isSuppressed(g.groupKey, canonicalId)) {
      resolved.push({
        group: g,
        canonicalIngredientId: canonicalId,
        layer: "auto-exact",
        confidence: 0.99,
        topScore: null,
        margin: null,
        candidates: null,
        model: null,
        reasoning: null,
      })
    } else {
      afterL1.push(g)
    }
  }

  // ---- L2: vector -----------------------------------------------------
  const afterL2: LineGroup[] = []
  const llmQueue: Array<{ group: LineGroup; shortlist: MatchCandidate[] }> = []

  if (afterL1.length > 0) {
    const texts = afterL1.map((g) =>
      buildMatchQueryText({ productName: g.productName, vendorName: g.vendorName, unit: g.unit })
    )
    const vectors = await embedBatch(texts)

    for (let i = 0; i < afterL1.length; i++) {
      const g = afterL1[i]
      const lit = toVectorLiteral(vectors[i])
      const rows = await prisma.$queryRawUnsafe<
        Array<{ canonicalIngredientId: string; name: string; score: number }>
      >(
        `SELECT e."canonicalIngredientId",
                e."name",
                (1 - (e.embedding <=> $1::vector))::float8 AS score
           FROM "CanonicalIngredientEmbedding" e
          WHERE e."accountId" = $2
          ORDER BY e.embedding <=> $1::vector
          LIMIT $3`,
        lit,
        accountId,
        VECTOR_CANDIDATE_LIMIT
      )
      const candidates: MatchCandidate[] = rows.map((r) => ({
        canonicalIngredientId: r.canonicalIngredientId,
        name: r.name,
        score: Number(r.score),
      }))

      const classification = classifyCandidates(candidates)
      if (
        classification.kind === "auto" &&
        !isSuppressed(g.groupKey, classification.candidate.canonicalIngredientId)
      ) {
        resolved.push({
          group: g,
          canonicalIngredientId: classification.candidate.canonicalIngredientId,
          layer: "auto-vector",
          confidence: classification.candidate.score,
          topScore: classification.candidate.score,
          margin: classification.margin,
          candidates: candidateJson(candidates),
          model: null,
          reasoning: null,
        })
        continue
      }

      afterL2.push(g)
      const shortlist =
        classification.kind === "ambiguous" ? classification.candidates : candidates.slice(0, 5)
      llmQueue.push({ group: g, shortlist })
    }
  }

  // ---- L3: LLM adjudication -------------------------------------------
  if (llmQueue.length > 0) {
    const cases: AdjudicatorCase[] = llmQueue.map(({ group, shortlist }) => ({
      caseId: group.groupKey,
      productName: group.productName,
      vendorName: group.vendorName,
      unit: group.unit,
      candidates: shortlist.map((c) => ({ name: c.name, score: c.score })),
    }))

    const { drafts, model } = await adjudicate({ cases, userId: ownerId })
    result.llmCalls = 1
    const draftByCase = new Map(drafts.map((d) => [d.caseId, d]))

    for (const { group, shortlist } of llmQueue) {
      const accepted = resolveLlmDraft({
        shortlist,
        draft: draftByCase.get(group.groupKey),
        llmAccept: THRESHOLDS.LLM_ACCEPT,
      })
      if (!accepted || isSuppressed(group.groupKey, accepted.canonicalIngredientId)) continue

      const draft = draftByCase.get(group.groupKey)!
      resolved.push({
        group,
        canonicalIngredientId: accepted.canonicalIngredientId,
        layer: "auto-llm",
        confidence: draft.confidence,
        topScore: accepted.score,
        margin: null,
        candidates: candidateJson(shortlist),
        model,
        reasoning: draft.reasoning || null,
      })
    }
  }

  for (const r of resolved) {
    const n = r.group.lineItemIds.length
    if (r.layer === "auto-exact") result.autoExact += n
    else if (r.layer === "auto-vector") result.autoVector += n
    else result.autoLlm += n
  }
  result.leftForReview = result.scanned - (result.autoExact + result.autoVector + result.autoLlm)

  // ---- Write-back -------------------------------------------------------
  if (shadow) {
    for (const r of resolved) {
      await prisma.ingredientMatchDecision.create({
        data: {
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
          status: "SHADOW",
        },
      })
    }
    return result
  }

  const touchedCanonicals = new Set<string>()
  const now = new Date()
  for (const r of resolved) {
    await prisma.$transaction(async (tx) => {
      await tx.invoiceLineItem.updateMany({
        where: { id: { in: r.group.lineItemIds } },
        data: { canonicalIngredientId: r.canonicalIngredientId, matchSource: r.layer, matchedAt: now },
      })

      // Learn the match forward, mirroring confirmSkuMatch: sku when the
      // sample line has one, else an alias scoped to the sample line's
      // store. IngredientSkuMatch requires a non-null ownerId; when the
      // caller has none (e.g. a cron/system run) the line items still get
      // linked above, we just skip persisting a learned sku match.
      if (r.group.sku && ownerId) {
        await tx.ingredientSkuMatch.upsert({
          where: { ownerId_vendorName_sku: { ownerId, vendorName: r.group.vendorName, sku: r.group.sku } },
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
      } else if (!r.group.sku && r.group.storeId) {
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

      await tx.ingredientMatchDecision.create({
        data: {
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
          status: "APPLIED",
        },
      })
    })
    touchedCanonicals.add(r.canonicalIngredientId)
  }

  for (const canonicalId of touchedCanonicals) {
    try {
      const res = await recomputeCanonicalCost(canonicalId)
      if (res.status === "updated") result.costsUpdated++
    } catch (e) {
      console.warn("[autoResolveUnmatchedLines] recomputeCanonicalCost failed:", e)
    }
  }

  return result
}
