/**
 * Markdown report writer for the ingredient auto-match bake-off. Structural
 * precedent: scripts/eval-chat/report.ts.
 *
 * The report is the deliverable — it must let a reader decide "can I trust
 * this?" without rerunning anything. So every wrong auto-link is printed in
 * full (both at default policy AND at the sweep's ship-gate row — the single
 * error that actually decides a verdict can live anywhere in the grid, not
 * just at the defaults), the gold-set provenance and its measurement
 * caveats are stated up front, and the zero-error threshold row (or its
 * absence, or its position on a structural boundary) is called out
 * explicitly per arm.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import type { BuildGoldSetResult, GoldCase } from "./gold"
import type { Arm, ArmResult, ThresholdRow } from "./arms"
import { classifyCandidates, THRESHOLDS } from "../../src/lib/ingredient-match-scoring"
import { bestZeroErrorRow, minWrongRow, computeDiagnostics, pct } from "./sweep-analysis"

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

  for (const run of input.armRuns) {
    writeArmSection(lines, run, caseIndex)
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
  if (arm.name === "vector-productname-only") {
    lines.push(
      "Diagnostic arm, not a shipping candidate on its own — tests whether dropping vendor/unit from the " +
        "embedded query text (see arms.ts) recovers cosine score versus `vector-only`.",
    )
  }
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

  writeDiagnosticsSection(lines, results)
  const shipGate = writeSweepSection(lines, sweep)
  writeWrongCasesSection(lines, "Wrong auto-links (default policy) — full detail", wrongResults, caseIndex)
  writeShipGateWrongCasesSection(lines, run, shipGate, caseIndex)
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

/** Writes the zero-error sweep summary + full curve. Returns the "ship-gate
 * row" — the best zero-error row, or (when none exists) the row with the
 * fewest wrong auto-links — so the caller can print its wrong-case detail
 * separately. */
function writeSweepSection(lines: string[], sweep: ThresholdRow[]): ThresholdRow {
  const highs = sweep.map((r) => r.high)
  const margins = sweep.map((r) => r.margin)
  const minHigh = Math.min(...highs)
  const maxHigh = Math.max(...highs)
  const minMargin = Math.min(...margins)
  const maxMargin = Math.max(...margins)

  lines.push("### Zero-error threshold sweep")
  lines.push("")
  lines.push(
    `Swept HIGH ${minHigh.toFixed(2)}–${maxHigh.toFixed(2)} (step 0.01) × MARGIN ${minMargin.toFixed(2)}–${maxMargin.toFixed(2)} ` +
      `(step 0.01) = ${sweep.length} threshold pairs, recomputed from each case's stored candidate list ` +
      `(FLOOR=${THRESHOLDS.FLOOR}, LLM_ACCEPT=${THRESHOLDS.LLM_ACCEPT} held fixed). The HIGH lower bound is FLOOR itself — ` +
      `classifyCandidates rejects anything scoring below FLOOR regardless of HIGH, so this is the entire reachable range, not an arbitrary cutoff.`,
  )
  lines.push("")

  const zeroErrorBest = bestZeroErrorRow(sweep)
  const shipGate = zeroErrorBest ?? minWrongRow(sweep)

  if (zeroErrorBest) {
    lines.push(
      `**Ship gate: HIGH=${zeroErrorBest.high.toFixed(2)}, MARGIN=${zeroErrorBest.margin.toFixed(2)} — ` +
        `${zeroErrorBest.coveragePct.toFixed(1)}% coverage, 0 wrong auto-links (${zeroErrorBest.autoLinked} auto-linked, ${zeroErrorBest.correct} correct).**`,
    )
    if (zeroErrorBest.high === minHigh) {
      lines.push("")
      lines.push(
        `This sits at HIGH=${minHigh.toFixed(2)}, the lower edge of the swept range — but that edge is FLOOR, a structural ` +
          "boundary of `classifyCandidates`, not an artifact of where the sweep happened to stop. Nothing scoring below " +
          "FLOOR is ever a candidate for auto-linking, so this coverage figure is the true ceiling reachable by tuning " +
          "HIGH/MARGIN alone, given the current FLOOR value. Coverage could only go higher than this by lowering FLOOR itself, " +
          "which is a separate, out-of-scope change to the production classifier.",
      )
    }
  } else {
    lines.push(
      "**No zero-error threshold pair exists for this arm anywhere in the swept grid.** " +
        "Every (HIGH, MARGIN) combination in range produced at least one wrong auto-link. " +
        `Closest: HIGH=${shipGate.high.toFixed(2)}, MARGIN=${shipGate.margin.toFixed(2)} — ${shipGate.wrong} wrong ` +
        `out of ${shipGate.autoLinked} auto-linked (${shipGate.coveragePct.toFixed(1)}% coverage).`,
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

  return shipGate
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

/** Prints wrong-case detail at the sweep's ship-gate row — the threshold
 * point that actually decides "zero-error pair exists or not" — separately
 * from the default-policy list. At a zero-error gate, the single decisive
 * error can live anywhere in the grid, not just at THRESHOLDS defaults. */
function writeShipGateWrongCasesSection(
  lines: string[],
  run: ArmRun,
  shipGate: ThresholdRow,
  caseIndex: Map<string, GoldCase>,
): void {
  const isDefaultRow = shipGate.high === THRESHOLDS.HIGH && shipGate.margin === THRESHOLDS.MARGIN
  lines.push(
    `### Wrong auto-links at the ship-gate row (HIGH=${shipGate.high.toFixed(2)}, MARGIN=${shipGate.margin.toFixed(2)}) — full detail`,
  )
  lines.push("")
  if (isDefaultRow) {
    lines.push("Ship-gate row is identical to the default-policy row above — see that section.")
    lines.push("")
    return
  }
  if (shipGate.wrong === 0) {
    lines.push("None — this is the zero-error row.")
    lines.push("")
    return
  }

  const wrongAtGate: Array<{ result: ArmResult; chosenId: string; isTie: boolean }> = []
  for (const r of run.results) {
    const classification = classifyCandidates(r.candidates, {
      HIGH: shipGate.high,
      MARGIN: shipGate.margin,
      FLOOR: THRESHOLDS.FLOOR,
      LLM_ACCEPT: THRESHOLDS.LLM_ACCEPT,
    })
    if (classification.kind !== "auto") continue
    if (classification.candidate.canonicalIngredientId === r.expectedCanonicalId) continue
    const expectedCandidate = r.candidates.find((c) => c.canonicalIngredientId === r.expectedCanonicalId)
    const isTie = expectedCandidate !== undefined && expectedCandidate.score === classification.candidate.score
    wrongAtGate.push({ result: r, chosenId: classification.candidate.canonicalIngredientId, isTie })
  }

  const tieCount = wrongAtGate.filter((w) => w.isTie).length
  lines.push(
    `${wrongAtGate.length} wrong auto-link(s) at this row. ${tieCount} of ${wrongAtGate.length} are score ties ` +
      "with the expected canonical (i.e. the wrong pick and the correct pick had identical scores, and the " +
      "deterministic secondary sort — canonicalIngredientId ascending — is what decided the winner).",
  )
  lines.push("")
  for (const w of wrongAtGate) {
    writeWrongCase(lines, w.result, w.chosenId, w.result.margin, caseIndex, w.isTie)
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

function writeWrongCase(
  lines: string[],
  r: ArmResult,
  chosenCanonicalId: string | null,
  margin: number,
  caseIndex: Map<string, GoldCase>,
  isTie?: boolean,
): void {
  const goldCase = caseIndex.get(r.caseId)
  const chosen = r.candidates.find((c) => c.canonicalIngredientId === chosenCanonicalId)
  const runnerUp = r.candidates[1]

  lines.push(`#### ${r.caseId}`)
  lines.push("")
  lines.push(`- Product name: \`${goldCase?.productName ?? "(unknown — not found in gold set)"}\``)
  lines.push(`- Vendor: \`${goldCase?.vendorName ?? "?"}\` · Unit: \`${goldCase?.unit ?? "(none)"}\``)
  lines.push(`- Expected canonical: **${goldCase?.expectedCanonicalName ?? "?"}** (\`${r.expectedCanonicalId}\`)`)
  lines.push(`- Chosen canonical: **${chosen?.name ?? "?"}** (\`${chosenCanonicalId}\`), score ${formatScore(chosen?.score)}`)
  lines.push(
    `- Runner-up: ${runnerUp ? `${runnerUp.name} (\`${runnerUp.canonicalIngredientId}\`), score ${formatScore(runnerUp.score)}` : "(none — only one candidate returned)"}`,
  )
  lines.push(`- Margin: ${margin.toFixed(4)}`)
  if (isTie !== undefined) {
    lines.push(`- Score tie with expected canonical: ${isTie ? "**yes**" : "no"}`)
  }
  lines.push(`- Reasoning: ${r.reasoning ?? "n/a — free arm, no LLM adjudication involved"}`)
  lines.push("")
}

function formatScore(score: number | undefined): string {
  return score === undefined ? "?" : score.toFixed(4)
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function timestampForFilename(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}
