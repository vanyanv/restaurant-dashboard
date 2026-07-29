/**
 * Markdown report writer for the task-6 LLM adjudicator bake-off. Structural
 * precedent: report.ts (the free-arm report). This is a separate file rather
 * than a new section threaded into report.ts — the free-arm pipeline is
 * exercised every time gold.ts changes and stays untouched here; this report
 * only covers the LLM layer applied on top of vector-only's fixed ship gate.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import type { GoldCase } from "./gold"
import type { ArmResult } from "./arms"
import type { LlmCallResult } from "./llm-call"
import type { LlmResult } from "./llm-resolve"
import { poolLevelWrongResolutions } from "./llm-resolve"
import type { CalibrationSummary } from "./llm-calibration"
import type { LlmGroupedKFoldAnalysis, FixedTauSensitivity } from "./llm-kfold"
import {
  writeCalibrationTable,
  writePerFoldTable,
  writeAllWrongCases,
  writePoolLevelWrongSection,
  writePooledCombinedTable,
  writeFixedTauSensitivity,
} from "./llm-report-detail"
import { writeDisputedSection } from "./report-pooled"

export type LlmArmRun = {
  model: string
  callResult: LlmCallResult
  poolResults: LlmResult[]
  calibration: CalibrationSummary
  duplicateDraftCount: number
  /** Cross-validated on the full (as-is) gold set. */
  kfold: LlmGroupedKFoldAnalysis | null
  /** Same analysis with the disputed gold labels (disputed-labels.ts) excluded
   * from both the pool and the fixed vector contribution — reported
   * side-by-side with `kfold`, never in place of it (fix round 1, point 2). */
  kfoldExcludingDisputed: LlmGroupedKFoldAnalysis | null
  /** Fixed-threshold sensitivity checks (fix round 2, point 1) — see
   * llm-kfold.ts#computeFixedTauSensitivity. Reported alongside, never in
   * place of, the cross-validated kfold/kfoldExcludingDisputed rows. */
  fixedTauSensitivity: FixedTauSensitivity | null
  fixedTauSensitivityExcludingDisputed: FixedTauSensitivity | null
  estimatedCostUsd: number
}

export type LlmReportInput = {
  gate: { high: number; margin: number }
  totalGoldCases: number
  poolSize: number
  vectorFixedAutoCount: number
  vectorFixedCorrect: number
  vectorFixedWrong: number
  vectorFixedWrongCases: ArmResult[]
  totalGoldCasesExcludingDisputed: number
  vectorFixedAutoCountExcludingDisputed: number
  armRuns: LlmArmRun[]
  caseIndex: Map<string, GoldCase>
  startedAt: Date
}

export async function writeLlmReport(outPath: string, input: LlmReportInput): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true })
  const lines: string[] = []

  lines.push(`# Ingredient auto-match — LLM adjudicator bake-off — ${formatTimestamp(input.startedAt)}`)
  lines.push("")
  lines.push(
    "The LLM layer runs only on cases vector-only abstains from at its fixed ship gate. Vector's own auto-links " +
      "are never re-decided — they carry over unchanged into every model arm's combined result below.",
  )
  lines.push("")
  lines.push(
    `- Vector ship gate used to split the pool: **HIGH=${input.gate.high.toFixed(2)}, MARGIN=${input.gate.margin.toFixed(2)}** ` +
      "(the cross-fold median gate from the Step-0 baseline — see task-6-report.md for why this specific gate was chosen).",
  )
  lines.push(`- Total gold cases: ${input.totalGoldCases}`)
  lines.push(
    `- Vector fixed auto-links (never touched by any LLM arm): ${input.vectorFixedAutoCount} ` +
      `(${input.vectorFixedCorrect} correct, ${input.vectorFixedWrong} wrong)`,
  )
  lines.push(`- Abstention pool handed to the LLM (ambiguous ∪ new): **${input.poolSize}**`)
  lines.push("")
  lines.push(
    "Every model was called exactly once over the full pool; every returned confidence was stored; the acceptance " +
      "threshold was then swept offline from stored results via grouped 5-fold cross-validation by " +
      "`expectedCanonicalId` (same fold assignment `holdout-analysis.ts` uses for the vector arm), never by re-querying " +
      "the model per threshold.",
  )
  lines.push("")
  lines.push(
    "> **The comparison below is asymmetric, and that matters for how confidently the headline can be stated.** " +
      "Vector's fixed contribution in every combined table is the cross-fold **median** gate scored once on the " +
      "full 255-case gold set — `runs/2026-07-28-1634.md` itself flags this rule in bold as *not* a cross-validated " +
      "result (it is the full-sample curve read at a single shared threshold). The LLM half of every combined " +
      "number, by contrast, genuinely is cross-validated: each fold's confidence threshold is selected on that " +
      "fold's own tuning pool and applied only to its held-out canonicals. So the LLM side of this comparison " +
      "carries a real generalization penalty the vector side does not. This does not appear to change the " +
      "direction of the conclusion — vector-only's zero-error result also holds under the fully cross-validated " +
      "`permissive` rule (166/166/0, 65.1%, from `runs/2026-07-28-1634.md`), not just under `median` — but it means " +
      "the vector baseline in this report's tables is measured more leniently than every LLM arm is.",
  )
  lines.push("")

  writeDisputedSection(lines)
  writeSpendSummary(lines, input.armRuns)

  for (const run of input.armRuns) {
    writeArmSection(lines, run, input)
  }

  await writeFile(outPath, lines.join("\n"), "utf-8")
}

function writeSpendSummary(lines: string[], armRuns: LlmArmRun[]): void {
  lines.push("## Spend summary")
  lines.push("")
  lines.push("| Model | Estimated (pre-call) | Actual | Input tok | Cached tok | Output tok | Error |")
  lines.push("|---|---|---|---|---|---|---|")
  let total = 0
  for (const r of armRuns) {
    total += r.callResult.costUsd
    lines.push(
      `| ${r.model} | $${r.estimatedCostUsd.toFixed(4)} | $${r.callResult.costUsd.toFixed(4)} | ` +
        `${r.callResult.inputTokens} | ${r.callResult.cachedTokens} | ${r.callResult.outputTokens} | ` +
        `${r.callResult.error ?? "—"} |`,
    )
  }
  lines.push("")
  lines.push(`**Total actual spend across all arms: $${total.toFixed(4)}**`)
  lines.push("")
}

function writeArmSection(lines: string[], run: LlmArmRun, input: LlmReportInput): void {
  lines.push(`## Arm: ${run.model}`)
  lines.push("")

  if (run.callResult.error) {
    lines.push(`**Call failed: ${run.callResult.error}** — this arm contributes nothing beyond the fixed vector baseline.`)
    lines.push("")
    return
  }

  lines.push(
    `Actual spend: **$${run.callResult.costUsd.toFixed(4)}** (${run.callResult.inputTokens} in / ` +
      `${run.callResult.outputTokens} out / ${run.callResult.cachedTokens} cached tokens, ${(run.callResult.durationMs / 1000).toFixed(1)}s).`,
  )
  lines.push("")

  writeCalibrationTable(lines, run.calibration, run.duplicateDraftCount)

  const poolWrong = poolLevelWrongResolutions(run.poolResults)
  writePoolLevelWrongSection(lines, poolWrong, input.caseIndex)

  if (!run.kfold) {
    lines.push("No grouped k-fold analysis available (empty pool or all folds degenerate).")
    lines.push("")
    return
  }

  writePerFoldTable(lines, run.kfold, "Per-fold selections — as-is (LLM confidence threshold, tuned on that fold's own tuning pool)")

  writePooledCombinedTable(
    lines,
    run.kfold,
    "Pooled combined result — as-is (vector fixed auto-links + LLM cross-validated accepts)",
    input.vectorFixedAutoCount,
    input.totalGoldCases,
    poolWrong.length,
  )
  writeAllWrongCases(lines, run.kfold.pooledWrongLlmCases, run.kfold.pooledWrongVectorCases, input.caseIndex, "the as-is pooled combined result")
  writeFixedTauSensitivity(lines, run.fixedTauSensitivity)

  if (run.kfoldExcludingDisputed) {
    lines.push(
      "> The tables below re-run the same analysis with `disputed-labels.ts`'s entries excluded from both the " +
        "pool and the fixed vector contribution (see the disputed-labels section near the top of this report for " +
        "the audit evidence). Nothing is dropped silently — the as-is tables above are always shown first.",
    )
    lines.push("")
    writePerFoldTable(
      lines,
      run.kfoldExcludingDisputed,
      "Per-fold selections — excluding disputed gold labels (LLM confidence threshold, tuned on that fold's own tuning pool)",
    )
    writePooledCombinedTable(
      lines,
      run.kfoldExcludingDisputed,
      "Pooled combined result — excluding disputed gold labels",
      input.vectorFixedAutoCountExcludingDisputed,
      input.totalGoldCasesExcludingDisputed,
      poolWrong.length,
    )
    writeAllWrongCases(
      lines,
      run.kfoldExcludingDisputed.pooledWrongLlmCases,
      run.kfoldExcludingDisputed.pooledWrongVectorCases,
      input.caseIndex,
      "the excluding-disputed pooled combined result",
    )
    writeFixedTauSensitivity(lines, run.fixedTauSensitivityExcludingDisputed)
  }
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function timestampForFilename(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}
