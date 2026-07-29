/**
 * Splits vector-only's results at a fixed ship gate into the fixed auto-link
 * contribution (never re-decided by the LLM) and the abstention pool (the
 * LLM's target). Per the brief: cases classified `ambiguous` OR `new` are one
 * combined pool — auto-create was cancelled, so `new` now means "no
 * confident vector match," not "create an ingredient."
 *
 * No I/O, no API calls.
 */

import type { GoldCase } from "./gold"
import type { ArmResult } from "./arms"
import { breakdownAtThreshold } from "./threshold-eval"
import type { AdjudicatorCase } from "../../src/lib/ingredient-match-llm"

/** Candidates shown to the LLM per case, capped the same as production's
 * ambiguous-band shortlist (classifyCandidates' SHORTLIST=5) — even for
 * `new` cases, whose top score sits under FLOOR but which still have a
 * ranked candidate list captured (vectorSearch always returns up to
 * SHORTLIST_FOR_STORAGE=10 rows regardless of how the case classifies). */
const SHORTLIST_FOR_LLM = 5

export type PoolSplit = {
  gate: { high: number; margin: number }
  /** Fixed vector auto-links — never touched by any LLM arm. */
  vectorAutoCorrect: ArmResult[]
  vectorAutoWrong: ArmResult[]
  /** The abstention pool: ambiguous ∪ new, at this gate. */
  poolResults: ArmResult[]
}

export function splitPool(vectorResults: ArmResult[], gate: { high: number; margin: number }): PoolSplit {
  const b = breakdownAtThreshold(vectorResults, gate.high, gate.margin)
  return {
    gate,
    vectorAutoCorrect: b.autoCorrectCases,
    vectorAutoWrong: b.autoWrongCases,
    poolResults: [...b.ambiguousCases, ...b.newCases],
  }
}

/** Build the AdjudicatorCase[] the model actually sees — one per pool case,
 * shortlist capped at SHORTLIST_FOR_LLM, using each case's own stored
 * top-ranked candidates (never the whole pantry). */
export function buildAdjudicatorCases(
  poolResults: ArmResult[],
  caseIndex: Map<string, GoldCase>,
): AdjudicatorCase[] {
  return poolResults.map((r) => {
    const g = caseIndex.get(r.caseId)
    return {
      caseId: r.caseId,
      productName: g?.productName ?? "(unknown)",
      vendorName: g?.vendorName ?? "(unknown)",
      unit: g?.unit ?? null,
      candidates: r.candidates.slice(0, SHORTLIST_FOR_LLM).map((c) => ({ name: c.name, score: c.score })),
    }
  })
}
