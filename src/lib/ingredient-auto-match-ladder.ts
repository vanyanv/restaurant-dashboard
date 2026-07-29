// The retrieval half of the auto-match ladder: for each unmatched group,
// decide WHICH canonical (if any) it should link to, without writing
// anything. See ingredient-auto-match.ts for the full ladder description
// and ingredient-auto-match-persist.ts for what happens to the result.
//
//   L1 auto-exact  — normalized product name == a canonical's name, or an
//                     IngredientAlias.rawName at ANY store (cross-scope).
//                     A name resolving to MORE THAN ONE canonical is NOT a
//                     match (IngredientAlias is unique per store, not per
//                     account, so the same raw string can legitimately
//                     alias different canonicals in different stores) — see
//                     resolveExactMatch in ingredient-auto-match-core.ts.
//   L2 auto-vector — cosine similarity against CanonicalIngredientEmbedding,
//                     gated by classifyCandidates' HIGH/MARGIN rule. Any
//                     candidate this account has undone for this exact group
//                     is dropped before scoring.
//   L3 auto-llm    — classifyCandidates' "ambiguous"/"new" groups go to one
//                     adjudicate() call; a draft is only accepted when
//                     confidence clears LLM_ACCEPT AND its matchName
//                     resolves to a member of THAT group's own shortlist. A
//                     group with ANY undo history skips L3 entirely — L1/L2
//                     are measured at zero errors and may retry it, but L3
//                     carries the one measured cross-validated error, so a
//                     group a human already corrected doesn't get a second
//                     silent swing from it.
//
// Error isolation: an embedBatch failure degrades every group still pending
// L2 to "leave for review" (L1 results are unaffected, having already been
// decided); a $queryRawUnsafe failure for one group degrades only that
// group. Neither throws out of this function — failures are counted and
// returned, never discarded silently.

import { prisma } from "@/lib/prisma"
import { embedBatch, toVectorLiteral } from "@/lib/chat/embeddings"
import { adjudicate, MAX_CASES_PER_REQUEST, type AdjudicatorCase } from "@/lib/ingredient-match-llm"
import {
  classifyCandidates,
  buildMatchQueryText,
  THRESHOLDS,
  SHORTLIST,
  type MatchCandidate,
} from "@/lib/ingredient-match-scoring"
import {
  suppressionKey,
  resolveLlmDraft,
  resolveExactMatch,
  candidateJson,
  type LineGroup,
  type ResolvedGroup,
} from "@/lib/ingredient-auto-match-core"

const VECTOR_CANDIDATE_LIMIT = 10

export type LadderResult = {
  resolved: ResolvedGroup[]
  llmCalls: number
  /** Line items whose group hit a real retrieval error (embedding call or
   * vector query), not a genuine "no confident match". */
  failed: number
}

export async function runLadder(input: {
  accountId: string
  ownerId: string
  groups: LineGroup[]
}): Promise<LadderResult> {
  const { accountId, ownerId, groups } = input
  const resolved: ResolvedGroup[] = []
  let failed = 0

  // Suppression: never re-propose a (groupKey, canonicalIngredientId) pair a
  // human has explicitly undone (checked at L1 and L2), and never let a
  // group with ANY undo history reach L3 (checked once, before L3).
  const undone = await prisma.ingredientMatchDecision.findMany({
    where: { accountId, status: "UNDONE" },
    select: { groupKey: true, canonicalIngredientId: true },
  })
  const suppressed = new Set(undone.map((d) => suppressionKey(d.groupKey, d.canonicalIngredientId)))
  const isSuppressed = (groupKey: string, canonicalIngredientId: string) =>
    suppressed.has(suppressionKey(groupKey, canonicalIngredientId))
  const groupKeysWithUndoHistory = new Set(undone.map((d) => d.groupKey))

  // ---- L1: cross-scope exact name --------------------------------------
  const canonicals = await prisma.canonicalIngredient.findMany({
    where: { accountId },
    select: { id: true, name: true },
  })
  const canonicalByName = new Map<string, Set<string>>()
  for (const c of canonicals) {
    const key = c.name.trim().toLowerCase()
    const set = canonicalByName.get(key) ?? new Set<string>()
    set.add(c.id)
    canonicalByName.set(key, set)
  }

  // Constrained by BOTH store.accountId and canonicalIngredient.accountId:
  // the first keeps this account from reading another tenant's aliases, the
  // second keeps a mis-parented alias row from resolving to another
  // tenant's canonical even if its storeId happens to check out.
  const aliases = await prisma.ingredientAlias.findMany({
    where: {
      canonicalIngredientId: { not: null },
      store: { accountId },
      canonicalIngredient: { accountId },
    },
    select: { rawName: true, canonicalIngredientId: true },
  })
  const aliasByName = new Map<string, Set<string>>()
  for (const a of aliases) {
    if (!a.canonicalIngredientId) continue
    const key = a.rawName.trim().toLowerCase()
    const set = aliasByName.get(key) ?? new Set<string>()
    set.add(a.canonicalIngredientId)
    aliasByName.set(key, set)
  }

  const afterL1: LineGroup[] = []
  for (const g of groups) {
    const normalizedName = g.productName.trim().toLowerCase()
    const match = resolveExactMatch(normalizedName, canonicalByName, aliasByName)
    const canonicalId = match && "canonicalIngredientId" in match ? match.canonicalIngredientId : null
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

  // ---- L2: vector ---------------------------------------------------------
  const llmQueue: Array<{ group: LineGroup; shortlist: MatchCandidate[] }> = []

  if (afterL1.length > 0) {
    let vectors: number[][] | null = null
    try {
      const texts = afterL1.map((g) =>
        buildMatchQueryText({ productName: g.productName, vendorName: g.vendorName, unit: g.unit })
      )
      vectors = await embedBatch(texts)
    } catch (e) {
      console.warn(
        "[ingredient-auto-match] embedBatch failed — leaving all pending groups for review:",
        e
      )
      failed += afterL1.reduce((n, g) => n + g.lineItemIds.length, 0)
    }

    if (vectors) {
      for (let i = 0; i < afterL1.length; i++) {
        const g = afterL1[i]
        try {
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
          // Drop anything this account has explicitly undone for this group
          // BEFORE it can win the margin check or bias the shortlist — a
          // suppressed candidate must not be visible to classifyCandidates,
          // let alone the adjudicator.
          const candidates: MatchCandidate[] = rows
            .map((r) => ({
              canonicalIngredientId: r.canonicalIngredientId,
              name: r.name,
              score: Number(r.score),
            }))
            .filter((c) => !isSuppressed(g.groupKey, c.canonicalIngredientId))

          const classification = classifyCandidates(candidates)
          if (classification.kind === "auto") {
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

          // A group the automation has already been told "no" about (on any
          // canonical, not just one appearing in today's candidates) does
          // not get a second silent LLM swing.
          if (groupKeysWithUndoHistory.has(g.groupKey)) continue

          const shortlist =
            classification.kind === "ambiguous" ? classification.candidates : candidates.slice(0, SHORTLIST)
          llmQueue.push({ group: g, shortlist })
        } catch (e) {
          console.warn(
            `[ingredient-auto-match] vector retrieval failed for group ${g.groupKey} — leaving for review:`,
            e
          )
          failed += g.lineItemIds.length
        }
      }
    }
  }

  // ---- L3: LLM adjudication -----------------------------------------------
  let llmCalls = 0
  if (llmQueue.length > 0) {
    const cases: AdjudicatorCase[] = llmQueue.map(({ group, shortlist }) => ({
      caseId: group.groupKey,
      productName: group.productName,
      vendorName: group.vendorName,
      unit: group.unit,
      candidates: shortlist.map((c) => ({ name: c.name, score: c.score })),
    }))

    // adjudicate() chunks internally at MAX_CASES_PER_REQUEST cases/request
    // and never throws, so this counts the requests the batch actually
    // costs rather than a hardcoded 1.
    llmCalls = Math.ceil(cases.length / MAX_CASES_PER_REQUEST)
    const { drafts, model } = await adjudicate({ cases, userId: ownerId })
    const draftByCase = new Map(drafts.map((d) => [d.caseId, d]))

    for (const { group, shortlist } of llmQueue) {
      const accepted = resolveLlmDraft({
        shortlist,
        draft: draftByCase.get(group.groupKey),
        llmAccept: THRESHOLDS.LLM_ACCEPT,
      })
      if (!accepted) continue

      const draft = draftByCase.get(group.groupKey)!
      const shortlistTop = shortlist.length > 0 ? Math.max(...shortlist.map((c) => c.score)) : null
      resolved.push({
        group,
        canonicalIngredientId: accepted.canonicalIngredientId,
        layer: "auto-llm",
        confidence: draft.confidence,
        topScore: shortlistTop,
        margin: null,
        candidates: candidateJson(shortlist),
        model,
        reasoning: draft.reasoning || null,
      })
    }
  }

  return { resolved, llmCalls, failed }
}
