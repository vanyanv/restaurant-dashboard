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
import type { CalibrationSummary } from "./llm-calibration"
import type { LlmGroupedKFoldAnalysis } from "./llm-kfold"
import { wilsonUpper95 } from "./sweep-analysis"
import { writeCalibrationTable, writePerFoldTable, writeAllWrongCases } from "./llm-report-detail"

export type LlmArmRun = {
  model: string
  callResult: LlmCallResult
  poolResults: LlmResult[]
  calibration: CalibrationSummary
  kfold: LlmGroupedKFoldAnalysis | null
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

  writeCalibrationTable(lines, run.calibration)

  if (!run.kfold) {
    lines.push("No grouped k-fold analysis available (empty pool or all folds degenerate).")
    lines.push("")
    return
  }

  writePerFoldTable(lines, run.kfold)

  const a = run.kfold
  const caseWilson = wilsonUpper95(a.pooledCombined.wrong, a.pooledCombined.autoLinked)
  const canonAuto = a.pooledCombinedAcceptedCanonicals.size
  const canonWrong = a.pooledCombinedWrongCanonicals.size
  const canonWilson = wilsonUpper95(canonWrong, canonAuto)

  lines.push("#### Pooled combined result (vector fixed auto-links + LLM cross-validated accepts)")
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
  lines.push(
    `Versus the vector-only-alone baseline: ${input.vectorFixedAutoCount}/${input.totalGoldCases} auto-linked ` +
      `(${((input.vectorFixedAutoCount / input.totalGoldCases) * 100).toFixed(1)}% coverage, ${input.vectorFixedWrong} wrong).`,
  )
  lines.push("")

  writeAllWrongCases(lines, a.pooledWrongLlmCases, a.pooledWrongVectorCases, input.caseIndex)
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function timestampForFilename(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}
