/**
 * Resolves a model's raw AdjudicatorDraft[] against each pool case's own
 * shown shortlist. `parseAdjudicatorDrafts` (src/lib/ingredient-match-llm.ts)
 * only checks JSON shape — it deliberately does not check `matchName`
 * membership, leaving that to the caller. This is the caller.
 *
 * No I/O.
 */

import type { GoldCase } from "./gold"
import type { ArmResult } from "./arms"
import type { AdjudicatorDraft } from "../../src/lib/ingredient-match-llm"

export type LlmResult = {
  caseId: string
  expectedCanonicalId: string
  expectedCanonicalName: string
  /** The pool case's own captured candidates (top-10, same as ArmResult.candidates)
   * — kept so report writers can show the runner-up / full shortlist without a
   * second lookup. */
  vectorTopScore: number
  matchName: string | null
  confidence: number
  reasoning: string
  /** null when matchName is null, or when matchName doesn't exactly match any
   * candidate this case was actually shown (a hallucinated name). */
  resolvedCanonicalId: string | null
  resolvedCandidateName: string | null
  hallucinated: boolean
  /** null when resolvedCanonicalId is null — nothing to score. */
  correct: boolean | null
  /** true when the model returned no draft at all for this case's id. */
  missingDraft: boolean
}

export function resolveLlmResults(
  poolResults: ArmResult[],
  drafts: AdjudicatorDraft[],
  caseIndex: Map<string, GoldCase>,
  shortlistSize: number,
): LlmResult[] {
  const draftByCaseId = new Map(drafts.map((d) => [d.caseId, d]))

  return poolResults.map((r) => {
    const shortlist = r.candidates.slice(0, shortlistSize)
    const g = caseIndex.get(r.caseId)
    const draft = draftByCaseId.get(r.caseId)

    if (!draft) {
      return {
        caseId: r.caseId,
        expectedCanonicalId: r.expectedCanonicalId,
        expectedCanonicalName: g?.expectedCanonicalName ?? "?",
        vectorTopScore: r.topScore,
        matchName: null,
        confidence: 0,
        reasoning: "",
        resolvedCanonicalId: null,
        resolvedCandidateName: null,
        hallucinated: false,
        correct: null,
        missingDraft: true,
      }
    }

    if (draft.matchName === null) {
      return {
        caseId: r.caseId,
        expectedCanonicalId: r.expectedCanonicalId,
        expectedCanonicalName: g?.expectedCanonicalName ?? "?",
        vectorTopScore: r.topScore,
        matchName: null,
        confidence: draft.confidence,
        reasoning: draft.reasoning,
        resolvedCanonicalId: null,
        resolvedCandidateName: null,
        hallucinated: false,
        correct: null,
        missingDraft: false,
      }
    }

    const candidate = shortlist.find((c) => c.name === draft.matchName)
    if (!candidate) {
      return {
        caseId: r.caseId,
        expectedCanonicalId: r.expectedCanonicalId,
        expectedCanonicalName: g?.expectedCanonicalName ?? "?",
        vectorTopScore: r.topScore,
        matchName: draft.matchName,
        confidence: draft.confidence,
        reasoning: draft.reasoning,
        resolvedCanonicalId: null,
        resolvedCandidateName: null,
        hallucinated: true,
        correct: null,
        missingDraft: false,
      }
    }

    return {
      caseId: r.caseId,
      expectedCanonicalId: r.expectedCanonicalId,
      expectedCanonicalName: g?.expectedCanonicalName ?? "?",
      vectorTopScore: r.topScore,
      matchName: draft.matchName,
      confidence: draft.confidence,
      reasoning: draft.reasoning,
      resolvedCanonicalId: candidate.canonicalIngredientId,
      resolvedCandidateName: candidate.name,
      hallucinated: false,
      correct: candidate.canonicalIngredientId === r.expectedCanonicalId,
      missingDraft: false,
    }
  })
}
