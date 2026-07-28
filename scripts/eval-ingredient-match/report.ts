/**
 * Markdown report writer for the ingredient auto-match bake-off. Structural
 * precedent: scripts/eval-chat/report.ts.
 *
 * The report is the deliverable — it must let a reader decide "can I trust
 * this?" without rerunning anything. So every wrong auto-link is printed in
 * full, the gold-set provenance is stated, and the zero-error threshold row
 * (or its absence) is called out explicitly per arm.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import type { BuildGoldSetResult, GoldCase } from "./gold"
import type { Arm, ArmResult, ThresholdRow } from "./arms"
import { THRESHOLDS } from "../../src/lib/ingredient-match-scoring"

export type ArmRun = {
  arm: Arm
  results: ArmResult[]
  sweep: ThresholdRow[]
}

export type ReportInput = {
  gold: BuildGoldSetResult
  armRuns: ArmRun[]
  startedAt: Date
  totalMs: number
}

export async function writeReport(outPath: string, input: ReportInput): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true })

  const caseIndex = new Map<string, GoldCase>(input.gold.cases.map((c) => [c.id, c]))

  const lines: string[] = []
  lines.push(`# Ingredient auto-match bake-off — ${formatTimestamp(input.startedAt)}`)
  lines.push("")
  lines.push(
    `Arms run: ${input.armRuns.map((r) => r.arm.name).join(", ")} · ${(input.totalMs / 1000).toFixed(1)}s total`,
  )
  lines.push("")

  lines.push("## Gold-set provenance")
  lines.push("")
  lines.push(`- Gold cases: ${input.gold.cases.length}`)
  lines.push(`- Total distinct (vendor, sku, productName) -> canonical pairs before exclusion: ${input.gold.totalPairsBeforeExclusion}`)
  lines.push(`- Excluded (alias-leakage — productName equals an alias rawName): ${input.gold.excluded}`)
  lines.push(`- Conflicts dropped (id mapped to >1 canonical, unscoreable): ${input.gold.conflicts.length}`)
  lines.push(`- Pantry size (\`CanonicalIngredient\` rows): ${input.gold.pantrySize}`)
  const bySource = {
    sku: input.gold.cases.filter((c) => c.source === "sku").length,
    alias: input.gold.cases.filter((c) => c.source === "alias").length,
    manual: input.gold.cases.filter((c) => c.source === "manual").length,
  }
  lines.push(`- Case source: sku=${bySource.sku}, alias=${bySource.alias}, manual=${bySource.manual}`)
  const distinctCanonicals = new Set(input.gold.cases.map((c) => c.expectedCanonicalId)).size
  lines.push(`- Distinct canonical ingredients covered: ${distinctCanonicals} of ${input.gold.pantrySize} pantry rows`)
  lines.push("")
  lines.push(
    "A case the strategy declines to auto-link (`ambiguous` or `new`) counts as an abstention, not an error. " +
      "Precision is computed only over auto-linked decisions.",
  )
  lines.push("")

  for (const run of input.armRuns) {
    writeArmSection(lines, run, caseIndex)
  }

  await writeFile(outPath, lines.join("\n"), "utf-8")
}

function writeArmSection(lines: string[], run: ArmRun, caseIndex: Map<string, GoldCase>): void {
  const { arm, results, sweep } = run
  const total = results.length
  const autoResults = results.filter((r) => r.decision === "auto")
  const correctResults = autoResults.filter((r) => r.correct === true)
  const wrongResults = autoResults.filter((r) => r.correct === false)
  const ambiguousCount = results.filter((r) => r.decision === "ambiguous").length
  const newCount = results.filter((r) => r.decision === "new").length

  const coveragePct = total > 0 ? (autoResults.length / total) * 100 : 0
  const precisionPct = autoResults.length > 0 ? (correctResults.length / autoResults.length) * 100 : 0

  lines.push(`## Arm: ${arm.name}`)
  lines.push("")
  lines.push(defaultPolicyLine(arm.name))
  lines.push("")
  lines.push("### Default-policy result")
  lines.push("")
  lines.push(`| Metric | Value |`)
  lines.push(`|---|---|`)
  lines.push(`| Cases | ${total} |`)
  lines.push(`| Auto-linked | ${autoResults.length} |`)
  lines.push(`| Ambiguous (abstained) | ${ambiguousCount} |`)
  lines.push(`| New / no candidate cleared floor (abstained) | ${newCount} |`)
  lines.push(`| Correct auto-links | ${correctResults.length} |`)
  lines.push(`| **Wrong auto-links** | **${wrongResults.length}** |`)
  lines.push(`| Coverage | ${coveragePct.toFixed(1)}% |`)
  lines.push(`| Precision (of auto-linked) | ${precisionPct.toFixed(1)}% |`)
  lines.push("")

  lines.push("### Zero-error threshold sweep")
  lines.push("")
  lines.push(
    `Swept HIGH 0.80–0.99 (step 0.01) × MARGIN 0.00–0.15 (step 0.01) = ${sweep.length} threshold pairs, ` +
      `recomputed from each case's stored candidate list (FLOOR=${THRESHOLDS.FLOOR}, LLM_ACCEPT=${THRESHOLDS.LLM_ACCEPT} held fixed).`,
  )
  lines.push("")
  const best = bestZeroErrorRow(sweep)
  if (best) {
    lines.push(
      `**Ship gate: HIGH=${best.high.toFixed(2)}, MARGIN=${best.margin.toFixed(2)} — ` +
        `${best.coveragePct.toFixed(1)}% coverage, 0 wrong auto-links (${best.autoLinked} auto-linked, ${best.correct} correct).**`,
    )
  } else {
    lines.push(
      "**No zero-error threshold pair exists for this arm anywhere in the swept grid.** " +
        "Every (HIGH, MARGIN) combination in range produced at least one wrong auto-link.",
    )
  }
  lines.push("")

  lines.push("<details><summary>Full precision/coverage curve (click to expand)</summary>")
  lines.push("")
  lines.push(`| HIGH | MARGIN | Auto-linked | Correct | Wrong | Coverage % | Precision % |`)
  lines.push(`|---|---|---|---|---|---|---|`)
  for (const row of sweep) {
    lines.push(
      `| ${row.high.toFixed(2)} | ${row.margin.toFixed(2)} | ${row.autoLinked} | ${row.correct} | ${row.wrong} | ` +
        `${row.coveragePct.toFixed(1)} | ${row.precisionPct.toFixed(1)} |`,
    )
  }
  lines.push("")
  lines.push("</details>")
  lines.push("")

  lines.push("### Wrong auto-links (default policy) — full detail")
  lines.push("")
  if (wrongResults.length === 0) {
    lines.push("None. Zero wrong auto-links at the default policy above.")
  } else {
    for (const r of wrongResults) {
      writeWrongCase(lines, r, caseIndex)
    }
  }
  lines.push("")
}

function defaultPolicyLine(armName: string): string {
  if (armName === "token-overlap") {
    return (
      "Default policy: Jaccard token-overlap score > 0.25 against the raw canonical name " +
      "(the production \"smart suggest\" heuristic, frozen baseline — see arms.ts for why it is duplicated, not imported)."
    )
  }
  return (
    `Default policy: THRESHOLDS defaults — HIGH=${THRESHOLDS.HIGH}, MARGIN=${THRESHOLDS.MARGIN}, ` +
    `FLOOR=${THRESHOLDS.FLOOR} (\`classifyCandidates\` with no override).`
  )
}

function writeWrongCase(lines: string[], r: ArmResult, caseIndex: Map<string, GoldCase>): void {
  const goldCase = caseIndex.get(r.caseId)
  const chosen = r.candidates.find((c) => c.canonicalIngredientId === r.chosenCanonicalId)
  const runnerUp = r.candidates[1]

  lines.push(`#### ${r.caseId}`)
  lines.push("")
  lines.push(`- Product name: \`${goldCase?.productName ?? "(unknown — not found in gold set)"}\``)
  lines.push(`- Vendor: \`${goldCase?.vendorName ?? "?"}\` · Unit: \`${goldCase?.unit ?? "(none)"}\``)
  lines.push(`- Expected canonical: **${goldCase?.expectedCanonicalName ?? "?"}** (\`${r.expectedCanonicalId}\`)`)
  lines.push(`- Chosen canonical: **${chosen?.name ?? "?"}** (\`${r.chosenCanonicalId}\`), score ${formatScore(chosen?.score)}`)
  lines.push(
    `- Runner-up: ${runnerUp ? `${runnerUp.name} (\`${runnerUp.canonicalIngredientId}\`), score ${formatScore(runnerUp.score)}` : "(none — only one candidate returned)"}`,
  )
  lines.push(`- Margin: ${r.margin.toFixed(4)}`)
  lines.push(`- Reasoning: ${r.reasoning ?? "n/a — free arm, no LLM adjudication involved"}`)
  lines.push("")
}

function formatScore(score: number | undefined): string {
  return score === undefined ? "?" : score.toFixed(4)
}

function bestZeroErrorRow(sweep: ThresholdRow[]): ThresholdRow | null {
  const zero = sweep.filter((r) => r.wrong === 0)
  if (zero.length === 0) return null
  return zero.reduce((best, r) => {
    if (r.coveragePct !== best.coveragePct) return r.coveragePct > best.coveragePct ? r : best
    // Deterministic tie-break: loosest HIGH first, then loosest MARGIN.
    if (r.high !== best.high) return r.high < best.high ? r : best
    return r.margin < best.margin ? r : best
  })
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function timestampForFilename(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}
