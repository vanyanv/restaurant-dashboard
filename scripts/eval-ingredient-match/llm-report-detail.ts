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
import { wilsonUpper95 } from "./sweep-analysis"
import { formatScore } from "./report-case-detail"

export function writeCalibrationTable(lines: string[], cal: CalibrationSummary, duplicateDraftCount: number): void {
  lines.push("#### Calibration: stated confidence vs. actual accuracy")
  lines.push("")
  lines.push(
    `Pool cases: ${cal.totalPoolCases} · resolved to a real candidate: ${cal.resolved} · ` +
      `explicit "none of these" (matchName=null): ${cal.nullAnswer} · hallucinated (matchName not in that ` +
      `case's own shortlist): ${cal.hallucinated} · missing draft (model never answered this case): ${cal.missingDraft} · ` +
      `duplicate drafts (repeated caseId — last one kept, earlier silently dropped): ${duplicateDraftCount}`,
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

/**
 * Every pool-level wrong resolution, regardless of whether any fold's
 * acceptance threshold would let it through (fix round 1, point 3 — "every
 * error is a pantry duplicate" was true only of *accepted* errors; at pool
 * level each arm makes several more wrong resolutions on ordinary,
 * winnable-looking products). This is what backs "the safety comes from the
 * acceptance gate, not from clean inputs."
 */
export function writePoolLevelWrongSection(
  lines: string[],
  wrong: LlmResult[],
  caseIndex: Map<string, GoldCase>,
): void {
  lines.push("#### Pool-level wrong resolutions (every wrong pick the model made, regardless of acceptance)")
  lines.push("")
  lines.push(
    `${wrong.length} of the pool's resolved decisions were wrong at the model's own top pick, before any confidence ` +
      "threshold is applied. Most of these never reach the combined figures above because their confidence didn't " +
      "clear the fold-selected acceptance gate — which is the point: the gate, not clean inputs, is what keeps them out.",
  )
  lines.push("")
  if (wrong.length === 0) {
    lines.push("None.")
    lines.push("")
    return
  }
  for (const r of wrong) writeLlmWrongCase(lines, r, caseIndex, "resolved, wrong — acceptance status noted per case below")
}

export function writeLlmWrongCase(
  lines: string[],
  r: LlmResult,
  caseIndex: Map<string, GoldCase>,
  headingSuffix = "LLM-accepted, wrong",
): void {
  const g = caseIndex.get(r.caseId)
  lines.push(`#### ${r.caseId} (${headingSuffix})`)
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
  label = "the pooled combined result",
): void {
  lines.push(`#### All wrong decisions in ${label}, in full`)
  lines.push("")
  if (wrongLlm.length === 0 && wrongVector.length === 0) {
    lines.push("None.")
    lines.push("")
    return
  }
  for (const w of wrongVector) writeVectorFixedWrongCase(lines, w, caseIndex)
  for (const w of wrongLlm) writeLlmWrongCase(lines, w.result, caseIndex)
}

/**
 * The pooled combined table, shared by the as-is and excluding-disputed
 * renders so the two can never drift out of sync with each other.
 * `poolLevelWrongCount` flags arms whose combined-wrong is 0 not because the
 * model was reliable but because its confidences never happened to clear the
 * fold-selected acceptance gate (fix round 1, point 4 — o4-mini's "0 wrong"
 * is hollow: 8 pool-level wrong resolutions, simply never accepted).
 */
export function writePooledCombinedTable(
  lines: string[],
  a: LlmGroupedKFoldAnalysis,
  heading: string,
  vectorFixedAutoCount: number,
  totalGoldCases: number,
  poolLevelWrongCount: number,
): void {
  const caseWilson = wilsonUpper95(a.pooledCombined.wrong, a.pooledCombined.autoLinked)
  const canonAuto = a.pooledCombinedAcceptedCanonicals.size
  const canonWrong = a.pooledCombinedWrongCanonicals.size
  const canonWilson = wilsonUpper95(canonWrong, canonAuto)

  lines.push(`#### ${heading}`)
  lines.push("")
  lines.push(
    "Columns are split so the combined figures (vector + LLM together) are never confused with the LLM's own " +
      "contribution alone — `LLM-added correct`/`LLM-added wrong`/`LLM share of auto-links` isolate what this " +
      "arm actually added on top of the fixed vector baseline; `Combined *` columns are the true totals.",
  )
  lines.push("")
  lines.push(
    "| Total cases | Combined auto | Combined correct | Combined wrong | Combined coverage | Combined precision | " +
      "LLM-added correct | LLM-added wrong | LLM share of auto-links | Wilson 95% (cases) | Wilson 95% (canonicals) |",
  )
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|")
  const llmSharePct = a.pooledCombined.autoLinked > 0 ? (a.pooledLlmOnly.accepted / a.pooledCombined.autoLinked) * 100 : 0
  lines.push(
    `| ${a.pooledCombined.total} | ${a.pooledCombined.autoLinked} | ${a.pooledCombined.correct} | **${a.pooledCombined.wrong}** | ` +
      `${a.pooledCombined.coveragePct.toFixed(1)}% | ${a.pooledCombined.precisionPct.toFixed(1)}% | ` +
      `${a.pooledLlmOnly.correct} | **${a.pooledLlmOnly.wrong}** | ${llmSharePct.toFixed(1)}% | ` +
      `${(caseWilson * 100).toFixed(1)}% (n=${a.pooledCombined.autoLinked}) | ${(canonWilson * 100).toFixed(1)}% (n=${canonAuto}) |`,
  )
  lines.push("")
  if (a.pooledCombined.wrong === 0 && poolLevelWrongCount > 0) {
    lines.push(
      `> **This arm's "0 wrong" is hollow, not a demonstration of reliability.** It made ${poolLevelWrongCount} ` +
        "pool-level wrong resolution(s) — see \"Pool-level wrong resolutions\" above — that simply never cleared " +
        "any fold's confidence-acceptance threshold. A pool with a different confidence distribution (or a " +
        "differently-shaped prompt) could easily have let one through under this exact sweep.",
    )
    lines.push("")
  }
  lines.push(
    `Versus the vector-only-alone baseline: ${vectorFixedAutoCount}/${totalGoldCases} auto-linked ` +
      `(${((vectorFixedAutoCount / totalGoldCases) * 100).toFixed(1)}% coverage, 0 wrong).`,
  )
  lines.push("")
}
