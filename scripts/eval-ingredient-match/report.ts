/**
 * Markdown report writer for the ingredient auto-match bake-off. Structural
 * precedent: scripts/eval-chat/report.ts.
 *
 * The report is the deliverable — it must let a reader decide "can I trust
 * this?" without rerunning anything. So every wrong auto-link is printed in
 * full (default policy, every fold's pooled holdout evaluation, and the
 * "frontier" case(s) that determine where each fold's zero-error boundary
 * sits in both the HIGH and MARGIN directions), the gold-set provenance and
 * its measurement caveats are stated up front, ship-gate thresholds are
 * selected by grouped k-fold cross-validation on canonical ingredient — never
 * on the same canonicals they're then scored on (report-holdout.ts) — and
 * every headline figure (coverage, precision, wrong-create) is shown both
 * unweighted (per distinct product name) and weighted by `occurrences` (per
 * invoice line), since money is lost per invoice line, not per product name.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import type { BuildGoldSetResult, GoldCase } from "./gold"
import type { Arm, ArmResult, ThresholdRow } from "./arms"
import { THRESHOLDS } from "../../src/lib/ingredient-match-scoring"
import { computeDiagnostics, pct, wilsonUpper95 } from "./sweep-analysis"
import { weightedCount } from "./weighting"
import { writeWrongCase } from "./report-case-detail"
import { writeHoldoutSection } from "./report-holdout"
import {
  writeLikeForLikeWrongCreateSection,
  writeSecondaryDuplicateCreateSection,
  writeFloorSweepSection,
} from "./report-duplicate-create"

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

  writeProvenanceSection(lines, input.gold)
  writeHowToReadSection(lines)
  writeLikeForLikeWrongCreateSection(lines, input.armRuns, caseIndex)

  for (const run of input.armRuns) {
    writeArmSection(lines, run, input.gold, caseIndex)
  }

  await writeFile(outPath, lines.join("\n"), "utf-8")
}

function writeProvenanceSection(lines: string[], gold: BuildGoldSetResult): void {
  lines.push("## Gold-set provenance")
  lines.push("")
  lines.push(`- Gold cases: ${gold.cases.length}`)
  lines.push(`- Total distinct (vendor, sku, productName) -> canonical pairs before exclusion: ${gold.totalPairsBeforeExclusion}`)
  lines.push(`- Excluded (alias-leakage — productName equals an alias rawName): ${gold.excluded}`)
  lines.push(`- Conflicts dropped (id mapped to >1 canonical, unscoreable): ${gold.conflicts.length}`)
  lines.push(`- Pantry size (\`CanonicalIngredient\` rows): ${gold.pantrySize}`)
  const bySource = {
    sku: gold.cases.filter((c) => c.source === "sku").length,
    alias: gold.cases.filter((c) => c.source === "alias").length,
    manual: gold.cases.filter((c) => c.source === "manual").length,
  }
  lines.push(`- Case source: sku=${bySource.sku}, alias=${bySource.alias}, manual=${bySource.manual}`)
  const distinctCanonicals = new Set(gold.cases.map((c) => c.expectedCanonicalId)).size
  lines.push(`- Distinct canonical ingredients covered: ${distinctCanonicals} of ${gold.pantrySize} pantry rows`)
  lines.push("")
}

function writeHowToReadSection(lines: string[]): void {
  lines.push("## How to read these numbers")
  lines.push("")
  lines.push(
    "A case the strategy declines to auto-link (`ambiguous` or `new`) counts as an abstention, not an error. " +
      "Precision is computed only over auto-linked decisions.",
  )
  lines.push("")
  lines.push(
    "**This gold set is 100% sku-sourced (0 alias-sourced) — that is not representative of what this matcher " +
      "sees in production.** The alias-leakage exclusion (required so a case's productName never equals text " +
      "already folded into its own target's embedding — see gold.ts) removed exactly the alias-matched lines, " +
      "which are precisely the cases name-matching exists to handle. And in production, this matcher only ever " +
      "runs *after* sku lookup has already failed. So the real traffic this matcher will see skews toward the " +
      "harder tail this gold set structurally cannot include. Treat every coverage/precision number below as an " +
      "**upper bound** on deployed performance, not a direct estimate.",
  )
  lines.push("")
  lines.push(
    "**Alias text is folded into canonical embeddings, which biases `vector-only`/`vector-productname-only` " +
      "upward — the unsafe direction for a zero-error gate.** `buildCanonicalIngredientText` (frozen, upstream " +
      "of this eval) appends every known `IngredientAlias.rawName` for a canonical into that canonical's embedded " +
      "document. A query that happens to closely resemble a *known* alias can score high because it's matching " +
      "text baked directly into the pantry document, not because the embedding model generalizes well to unseen " +
      "phrasing. A genuinely novel product name won't get that boost, so live precision at any given threshold " +
      "could run lower than what's measured here.",
  )
  lines.push("")
  lines.push(
    "**Correction to a fix-round-1 claim: the stored pantry embeddings were NOT built via `embed()` only — most " +
      "came from `embedBatch()`, the same function this round's `embedBatch` misalignment fix touched.** " +
      "`CanonicalIngredientEmbedding.createdAt` clusters into exactly 3 timestamps (72 rows / 3 rows / 1 row). " +
      "Rows sharing an identical timestamp were written inside one Postgres transaction (`NOW()` is transaction-start " +
      "time), which matches `scripts/backfill-embeddings.ts`'s chunked `BEGIN`/`COMMIT` loop (uses `embedBatch`) — " +
      "not the live per-canonical `syncCanonicalEmbedding()` path (uses single `embed()` calls, which would produce " +
      "76 distinct timestamps, not 3). So **75 of 76 pantry rows (98.7%) were written via `embedBatch`**, and only " +
      "the single most recent row came from `embed()`. This eval's own `embedBatch` fix therefore does not fully " +
      "close off batch-misalignment as an alternative explanation for low cosine scores — the pantry side could " +
      "theoretically have been affected too, pre-fix. What argues against that having actually happened: 95% top-1 " +
      "accuracy and 100% recall@10 (see diagnostics below) are inconsistent with any meaningful fraction of pantry " +
      "rows holding embeddings unrelated to their own name text, and every individual wrong case traced in this " +
      "report has an explainable score-based cause, not a nonsensical top candidate. To close this out formally, " +
      "re-run `backfill-embeddings.ts` (now carrying the `row.index` fix) and confirm no ranking in this eval changes.",
  )
  lines.push("")
}

function writeArmSection(
  lines: string[],
  run: ArmRun,
  gold: BuildGoldSetResult,
  caseIndex: Map<string, GoldCase>,
): void {
  const { arm, results, sweep } = run
  const total = results.length
  const autoResults = results.filter((r) => r.decision === "auto")
  const correctResults = autoResults.filter((r) => r.correct === true)
  const wrongResults = autoResults.filter((r) => r.correct === false)
  const ambiguousCount = results.filter((r) => r.decision === "ambiguous").length
  const newCount = results.filter((r) => r.decision === "new").length

  const coveragePct = total > 0 ? (autoResults.length / total) * 100 : 0
  const precisionPct = autoResults.length > 0 ? (correctResults.length / autoResults.length) * 100 : 0

  const totalWeighted = weightedCount(results, caseIndex)
  const autoWeighted = weightedCount(autoResults, caseIndex)
  const correctWeighted = weightedCount(correctResults, caseIndex)
  const wrongWeighted = weightedCount(wrongResults, caseIndex)
  const coverageWeightedPct = pct(autoWeighted, totalWeighted)
  const precisionWeightedPct = autoWeighted > 0 ? pct(correctWeighted, autoWeighted) : "0.0"

  lines.push(`## Arm: ${arm.name}`)
  lines.push("")
  lines.push(defaultPolicyLine(arm.name))
  if (arm.name === "vector-productname-only") {
    lines.push(
      "Diagnostic arm, not a shipping candidate on its own — tests whether dropping vendor/unit from the " +
        "embedded query text (see arms.ts) recovers cosine score versus `vector-only`.",
    )
  }
  lines.push("")
  lines.push(
    `**FLOOR context:** classifyCandidates rejects anything scoring under FLOOR=${THRESHOLDS.FLOOR.toFixed(2)} as ` +
      "\"new\" before HIGH or MARGIN are ever consulted. Ship gates in this report frequently land with HIGH exactly " +
      "at FLOOR — when that happens, the HIGH gate is effectively inert and safety rests entirely on MARGIN plus " +
      "FLOOR itself, which this report never sweeps except in the dedicated \"FLOOR sweep\" section below, because " +
      "FLOOR is the only lever that moves the duplicate-create count at all (see \"Wrong-create rate\" near the top).",
  )
  lines.push("")
  lines.push("### Default-policy result")
  lines.push("")
  lines.push("Unweighted = per distinct product name. Weighted = by `occurrences` (per invoice line).")
  lines.push("")
  lines.push(`| Metric | Unweighted | Weighted (occurrences) |`)
  lines.push(`|---|---|---|`)
  lines.push(`| Cases | ${total} | ${totalWeighted} |`)
  lines.push(`| Auto-linked | ${autoResults.length} | ${autoWeighted} |`)
  lines.push(`| Ambiguous (abstained) | ${ambiguousCount} | ${weightedCount(results.filter((r) => r.decision === "ambiguous"), caseIndex)} |`)
  lines.push(`| New / no candidate cleared floor (abstained) | ${newCount} | ${weightedCount(results.filter((r) => r.decision === "new"), caseIndex)} |`)
  lines.push(`| Correct auto-links | ${correctResults.length} | ${correctWeighted} |`)
  lines.push(`| **Wrong auto-links** | **${wrongResults.length}** | **${wrongWeighted}** |`)
  lines.push(`| Coverage | ${coveragePct.toFixed(1)}% | ${coverageWeightedPct}% |`)
  lines.push(`| Precision (of auto-linked) | ${precisionPct.toFixed(1)}% | ${precisionWeightedPct}% |`)
  const n1 = wilsonUpper95(wrongResults.length, autoResults.length)
  lines.push(
    `| Wilson 95% upper bound on true error rate | ${(n1 * 100).toFixed(1)}% (n=${autoResults.length} auto-linked) | n/a |`,
  )
  lines.push("")

  writeDiagnosticsSection(lines, results)
  writeFullSampleCurveSection(lines, sweep, total)
  writeWrongCasesSection(lines, "Wrong auto-links (default policy) — full detail", wrongResults, caseIndex)
  writeHoldoutSection(lines, run, gold, caseIndex)
  writeSecondaryDuplicateCreateSection(lines, run, caseIndex)
  writeFloorSweepSection(lines, run, caseIndex)
}

/** Threshold-free diagnostics (point 4): distinguish "the embedding signal
 * is weak" from "the signal is fine but the scores are compressed/shifted
 * relative to the HIGH/MARGIN gate calibrated for it." */
function writeDiagnosticsSection(lines: string[], results: ArmResult[]): void {
  const { total, top1Correct, recallAt10, histogram } = computeDiagnostics(results)

  lines.push("### Threshold-free diagnostics")
  lines.push("")
  lines.push(
    `- Top-1 accuracy (highest-scoring candidate is correct, ignoring all thresholds): ` +
      `${top1Correct}/${total} (${pct(top1Correct, total)}%)`,
  )
  lines.push(
    `- Recall@${10} (expected canonical appears anywhere in the retrieved top-10): ` +
      `${recallAt10}/${total} (${pct(recallAt10, total)}%)`,
  )
  lines.push("")
  lines.push("Top-score histogram (bucket width 0.05):")
  lines.push("")
  lines.push(`| Score range | Cases |`)
  lines.push(`|---|---|`)
  for (let b = 19; b >= 0; b--) {
    const count = histogram.get(b) ?? 0
    if (count === 0) continue
    const lo = (b * 0.05).toFixed(2)
    const hi = ((b + 1) * 0.05).toFixed(2)
    lines.push(`| [${lo}, ${hi}) | ${count} |`)
  }
  lines.push("")
}

/**
 * Full-260 precision/coverage curve — reference only. Fix-round-2, point 1:
 * a threshold cannot be *selected* from this curve — that would be picking a
 * threshold using the same cases it's then reported as error-free on. Actual
 * threshold selection happens on each fold's tuning portion only, in the
 * "Grouped k-fold validation" section below (report-holdout.ts). This table
 * exists so a reader can see the overall shape of the curve, not to justify a
 * threshold.
 */
function writeFullSampleCurveSection(lines: string[], sweep: ThresholdRow[], total: number): void {
  const highs = sweep.map((r) => r.high)
  const margins = sweep.map((r) => r.margin)
  const minHigh = Math.min(...highs)
  const maxHigh = Math.max(...highs)
  const minMargin = Math.min(...margins)
  const maxMargin = Math.max(...margins)

  lines.push("### Full-sample precision/coverage curve (reference only)")
  lines.push("")
  lines.push(
    `Swept HIGH ${minHigh.toFixed(2)}–${maxHigh.toFixed(2)} (step 0.01) × MARGIN ${minMargin.toFixed(2)}–${maxMargin.toFixed(2)} ` +
      `(step 0.01) = ${sweep.length} threshold pairs, over all ${total} cases. ` +
      "**Not used to select any threshold** — see \"Grouped k-fold validation\" below for how ship-gate thresholds " +
      "are actually chosen and cross-validated. Shown here only so the overall shape of the curve is visible.",
  )
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
}

function writeWrongCasesSection(
  lines: string[],
  heading: string,
  wrongResults: ArmResult[],
  caseIndex: Map<string, GoldCase>,
): void {
  lines.push(`### ${heading}`)
  lines.push("")
  if (wrongResults.length === 0) {
    lines.push("None.")
  } else {
    for (const r of wrongResults) {
      writeWrongCase(lines, r, r.chosenCanonicalId, r.margin, caseIndex)
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

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function timestampForFilename(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}
