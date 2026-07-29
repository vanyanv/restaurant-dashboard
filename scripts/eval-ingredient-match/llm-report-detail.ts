/**
 * Leaf renderers for the LLM bake-off report: calibration table, per-fold
 * table, and full wrong-case detail (both origins — a fixed vector-only
 * wrong pick carried into a fold's holdout, and an LLM-accepted wrong pick).
 * Split out of llm-report.ts purely to stay under the 400-line file cap.
 */

import type { GoldCase } from "./gold"
import type { ArmResult } from "./arms"
import type { LlmResult } from "./llm-resolve"
import type { CalibrationSummary } from "./llm-calibration"
import type { LlmGroupedKFoldAnalysis } from "./llm-kfold"
import type { WrongAtConfidence } from "./llm-threshold-eval"
import { formatScore } from "./report-case-detail"

export function writeCalibrationTable(lines: string[], cal: CalibrationSummary): void {
  lines.push("#### Calibration: stated confidence vs. actual accuracy")
  lines.push("")
  lines.push(
    `Pool cases: ${cal.totalPoolCases} · resolved to a real candidate: ${cal.resolved} · ` +
      `explicit "none of these" (matchName=null): ${cal.nullAnswer} · hallucinated (matchName not in that ` +
      `case's own shortlist): ${cal.hallucinated} · missing draft (model never answered this case): ${cal.missingDraft}`,
  )
  lines.push("")
  lines.push("Bucketed over every *resolved* decision (a real candidate was picked), independent of any acceptance threshold:")
  lines.push("")
  lines.push("| Confidence bucket | n | Correct | Accuracy |")
  lines.push("|---|---|---|---|")
  for (const b of cal.buckets) {
    if (b.n === 0) continue
    lines.push(`| [${b.lo.toFixed(1)}, ${b.hi.toFixed(1)}${b.hi === 1 ? "]" : ")"} | ${b.n} | ${b.correct} | ${b.accuracyPct.toFixed(1)}% |`)
  }
  lines.push("")
}

export function writePerFoldTable(lines: string[], a: LlmGroupedKFoldAnalysis): void {
  lines.push("#### Per-fold selections (LLM confidence threshold, tuned on that fold's own tuning pool)")
  lines.push("")
  lines.push(
    "| Fold | Held-out canonicals | Tuning pool | Holdout pool | Own tau | Zero-error on tuning? | Combined holdout auto | Combined wrong | Combined coverage | Combined precision |",
  )
  lines.push("|---|---|---|---|---|---|---|---|---|---|")
  for (const f of a.folds) {
    lines.push(
      `| ${f.index} | ${f.heldOutCanonicalCount} | ${f.tuningPoolCount} | ${f.holdoutPoolCount} | ${f.ownSelectionTau.toFixed(2)} | ` +
        `${f.ownSelectionIsZeroError ? "yes" : "no (fewest-wrong)"} | ${f.combinedHoldout.autoLinked} | ${f.combinedHoldout.wrong} | ` +
        `${f.combinedHoldout.coveragePct.toFixed(1)}% | ${f.combinedHoldout.precisionPct.toFixed(1)}% |`,
    )
  }
  lines.push("")
}

export function writeLlmWrongCase(
  lines: string[],
  r: LlmResult,
  caseIndex: Map<string, GoldCase>,
): void {
  const g = caseIndex.get(r.caseId)
  lines.push(`#### ${r.caseId} (LLM-accepted, wrong)`)
  lines.push("")
  lines.push(`- Product name: \`${g?.productName ?? "?"}\``)
  lines.push(`- Vendor: \`${g?.vendorName ?? "?"}\` · Unit: \`${g?.unit ?? "(none)"}\``)
  lines.push(`- Expected canonical: **${r.expectedCanonicalName}** (\`${r.expectedCanonicalId}\`)`)
  lines.push(`- Model's choice: **${r.resolvedCandidateName ?? "?"}** (\`${r.resolvedCanonicalId}\`)`)
  lines.push(`- Model's stated confidence: ${r.confidence.toFixed(2)}`)
  lines.push(`- Model's reasoning: ${r.reasoning || "(none given)"}`)
  lines.push(`- Vector top score for this case (pre-LLM): ${formatScore(r.vectorTopScore)}`)
  lines.push("")
}

export function writeVectorFixedWrongCase(lines: string[], r: ArmResult, caseIndex: Map<string, GoldCase>): void {
  const g = caseIndex.get(r.caseId)
  const chosen = r.candidates.find((c) => c.canonicalIngredientId === r.chosenCanonicalId)
  lines.push(`#### ${r.caseId} (vector-only fixed auto-link, wrong — carried in from Step 0, not an LLM decision)`)
  lines.push("")
  lines.push(`- Product name: \`${g?.productName ?? "?"}\``)
  lines.push(`- Expected canonical: **${g?.expectedCanonicalName ?? "?"}** (\`${r.expectedCanonicalId}\`)`)
  lines.push(`- Chosen canonical: **${chosen?.name ?? "?"}** (\`${r.chosenCanonicalId}\`), score ${formatScore(chosen?.score)}`)
  lines.push("")
}

export function writeAllWrongCases(
  lines: string[],
  wrongLlm: WrongAtConfidence[],
  wrongVector: ArmResult[],
  caseIndex: Map<string, GoldCase>,
): void {
  lines.push("#### All wrong decisions in the pooled combined result, in full")
  lines.push("")
  if (wrongLlm.length === 0 && wrongVector.length === 0) {
    lines.push("None.")
    lines.push("")
    return
  }
  for (const w of wrongVector) writeVectorFixedWrongCase(lines, w, caseIndex)
  for (const w of wrongLlm) writeLlmWrongCase(lines, w.result, caseIndex)
}
