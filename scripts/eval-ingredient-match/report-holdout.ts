/**
 * Grouped k-fold validation section. Ship-gate thresholds are selected on a
 * fold's tuning portion only (no canonical shared with the held-out portion)
 * and applied unchanged to the held-out canonicals; folds are then pooled.
 *
 * Round-4 changes: the pooled table moved to report-pooled.ts and is now
 * rendered under two gate-selection rules and two case sets rather than one
 * of each; the per-fold table shows each fold's own selection so the reader
 * can see directly which fold is the outlier; and gates sitting on the edge
 * of the swept MARGIN grid are flagged as unconverged rather than silently
 * reported as if the grid had bracketed them.
 */

import type { GoldCase } from "./gold"
import type { ArmRun } from "./report"
import { type FrontierProbe, type GroupedKFoldAnalysis } from "./holdout-analysis"
import { writeWrongCase } from "./report-case-detail"
import { buildPooledVariants, writePooledTables, writeDisputedSection, type PooledVariant } from "./report-pooled"

export function writeHoldoutSection(
  lines: string[],
  run: ArmRun,
  gold: { cases: GoldCase[] },
  caseIndex: Map<string, GoldCase>,
): void {
  const variants = buildPooledVariants(gold.cases, run.results)
  const primary = variants.find((v) => v.rule === "permissive" && v.caseSet === "as-is")
  if (!primary) return

  lines.push("### Grouped k-fold validation (ship-gate selection)")
  lines.push("")
  lines.push(
    `${primary.analysis.totalDistinctCanonicals} distinct canonicals are split into ${primary.analysis.k} folds, ` +
      "deterministically, by `(stableHash(canonicalId) >>> 16) % 5` (FNV-1a; upper bits only — the low bits are " +
      "provably low-entropy, see holdout-analysis.ts). **No canonical appears in both the tuning and held-out " +
      "portion of the same fold.** Each fold selects its ship-gate threshold from its own tuning portion only, " +
      "applies it unchanged to that fold's held-out canonicals, and the folds are pooled.",
  )
  lines.push("")

  writePerFoldTable(lines, primary.analysis)
  writeGridEdgeWarning(lines, primary.analysis)
  writePooledTables(lines, variants, caseIndex)
  writeDisputedSection(lines)
  writePooledWrongCases(lines, variants, caseIndex)
  writeFrontierDetail(lines, primary.analysis, caseIndex)
}

function writePerFoldTable(lines: string[], a: GroupedKFoldAnalysis): void {
  lines.push("#### Per-fold selections (permissive rule)")
  lines.push("")
  lines.push(
    "`Own selection` is the gate that fold's tuning half picked on its own. Where one fold's selection differs " +
      "from the rest, the pooled result under the permissive rule is partly that fold's choice rather than a " +
      "property of the matcher — which is exactly why the conservative rule below is reported alongside it.",
  )
  lines.push("")
  lines.push(
    "| Fold | Held-out canonicals | Own selection | Zero-error on tuning? | Holdout auto-linked | Holdout wrong | Holdout coverage | Holdout precision |",
  )
  lines.push("|---|---|---|---|---|---|---|---|")
  for (const f of a.folds) {
    lines.push(
      `| ${f.index} | ${f.holdoutCanonicalCount} | HIGH=${f.ownSelection.high.toFixed(2)}, MARGIN=${f.ownSelection.margin.toFixed(2)} | ` +
        `${f.shipGateIsZeroError ? "yes" : "no (fewest-wrong)"} | ${f.holdoutAtShipGate.autoLinked} | ${f.holdoutAtShipGate.wrong} | ` +
        `${f.holdoutAtShipGate.coveragePct.toFixed(1)}% | ${f.holdoutAtShipGate.precisionPct.toFixed(1)}% |`,
    )
  }
  lines.push("")
}

/**
 * A gate that lands on the last value of the swept MARGIN grid has not been
 * bracketed by the sweep — the true optimum may lie beyond it, and the
 * reported coverage/precision at that point is a grid artifact rather than a
 * measured optimum. Flagged rather than fixed by widening the grid: widening
 * it to chase a gate is threshold-shopping, and the honest statement is that
 * this arm's operating point is unconverged.
 */
function writeGridEdgeWarning(lines: string[], a: GroupedKFoldAnalysis): void {
  const maxMargin = Math.max(...a.folds.flatMap((f) => f.tuningSweep.map((r) => r.margin)))
  const atEdge = a.folds.filter((f) => f.ownSelection.margin === maxMargin)
  if (atEdge.length === 0) return
  lines.push(
    `> **Unconverged: ${atEdge.length} of ${a.folds.length} folds selected MARGIN=${maxMargin.toFixed(2)}, which is the ` +
      "maximum value in the swept grid.** The sweep therefore never bracketed this arm's optimum — the zero-error " +
      "region may continue past the edge, so the coverage reported for those folds is a property of where the grid " +
      "stops, not of where the arm's safe operating point actually is. The grid was deliberately *not* widened to " +
      "chase it: extending a sweep until a gate stops moving is threshold-shopping against the same data, and the " +
      "decision-relevant statement is simply that this arm's operating point is not converged and its numbers " +
      "should not be compared like-for-like against an arm whose gate sits in the grid's interior.",
  )
  lines.push("")
}

function writePooledWrongCases(
  lines: string[],
  variants: PooledVariant[],
  caseIndex: Map<string, GoldCase>,
): void {
  lines.push("#### Pooled wrong auto-links, in full")
  lines.push("")
  for (const v of variants) {
    lines.push(`**Rule \`${v.rule}\`, case set "${v.caseSet}" — ${v.analysis.pooled.wrong} wrong:**`)
    lines.push("")
    if (v.analysis.pooled.wrong === 0) {
      lines.push("None — no wrong auto-link in any fold's held-out evaluation.")
      lines.push("")
      continue
    }
    for (const w of v.analysis.pooledWrongCases) {
      writeWrongCase(lines, w.result, w.chosenId, w.result.margin, caseIndex, w.isTie)
    }
  }
}

function writeFrontierDetail(
  lines: string[],
  a: GroupedKFoldAnalysis,
  caseIndex: Map<string, GoldCase>,
): void {
  lines.push("#### Frontier detail, per fold (permissive rule)")
  lines.push("")
  lines.push(
    "For each fold whose tuning-selected ship gate was zero-error, both adjacent directions are probed — " +
      "`HIGH - 0.01` and `MARGIN - 0.01` — since for some arms/folds the binding constraint is HIGH, not MARGIN, " +
      "and probing only MARGIN would silently miss the case that actually bounds the zero-error region. These are " +
      "**tuning-side** probes: they show what keeps a fold's gate from being one step looser, not held-out errors.",
  )
  lines.push("")
  for (const f of a.folds) {
    if (!f.shipGateIsZeroError) {
      lines.push(
        `**Fold ${f.index}:** ship gate was fewest-wrong, not zero-error — its own wrong cases are the decisive ` +
          "detail; no frontier probe applies.",
      )
      lines.push("")
      continue
    }
    lines.push(`**Fold ${f.index}** (ship gate HIGH=${f.shipGate.high.toFixed(2)}, MARGIN=${f.shipGate.margin.toFixed(2)}):`)
    lines.push("")
    for (const probe of f.frontier) {
      writeFrontierProbe(lines, probe, caseIndex)
    }
  }
}

function writeFrontierProbe(lines: string[], probe: FrontierProbe, caseIndex: Map<string, GoldCase>): void {
  if (probe.outOfRangeReason) {
    lines.push(`- **${probe.direction}** direction: ${probe.outOfRangeReason}`)
    lines.push("")
    return
  }
  if (!probe.row) {
    lines.push(`- **${probe.direction}** direction: no adjacent row found in the tuning sweep.`)
    lines.push("")
    return
  }
  if (probe.row.wrong === 0) {
    lines.push(
      `- **${probe.direction}** direction: also zero-error at HIGH=${probe.row.high.toFixed(2)}, MARGIN=${probe.row.margin.toFixed(2)} ` +
        `(${probe.row.autoLinked} auto-linked) — the zero-error region extends at least one more step in this direction ` +
        "on the tuning half. This does not mean it extends indefinitely, only that this specific adjacent row has 0 wrong too.",
    )
    lines.push("")
    return
  }
  lines.push(
    `- **${probe.direction}** direction: ${probe.row.wrong} wrong out of ${probe.row.autoLinked} auto-linked at ` +
      `HIGH=${probe.row.high.toFixed(2)}, MARGIN=${probe.row.margin.toFixed(2)} — the decisive **tuning-side** case(s) that keep ` +
      `this fold's ship gate from being one step looser in the ${probe.direction} direction:`,
  )
  lines.push("")
  for (const w of probe.wrongCases) {
    writeWrongCase(lines, w.result, w.chosenId, w.result.margin, caseIndex, w.isTie)
  }
}
