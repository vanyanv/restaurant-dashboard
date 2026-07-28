/**
 * Grouped k-fold validation section (fix-round-3, point 1 — replaces the
 * round-2 single 50/50 per-case split, which let ~85% of a holdout case's
 * canonical also sit in tuning). The ship-gate threshold for each fold is
 * selected on that fold's tuning portion only (no canonical shared with the
 * held-out portion) and applied unchanged to the held-out canonicals; folds
 * are then pooled. Every "0 wrong" claim ships with two Wilson 95% upper
 * bounds — one on case count, one on distinct-canonical count — since cases
 * sharing a canonical are not independent trials.
 */

import type { GoldCase } from "./gold"
import type { ArmRun } from "./report"
import { analyzeGroupedKFold, type FrontierProbe } from "./holdout-analysis"
import { wilsonUpper95, pct } from "./sweep-analysis"
import { weightedCount } from "./weighting"
import { writeWrongCase } from "./report-case-detail"

export function writeHoldoutSection(
  lines: string[],
  run: ArmRun,
  gold: { cases: GoldCase[] },
  caseIndex: Map<string, GoldCase>,
): void {
  const a = analyzeGroupedKFold(gold.cases, run.results)

  lines.push("### Grouped k-fold validation (ship-gate selection)")
  lines.push("")
  lines.push(
    `${a.totalDistinctCanonicals} distinct canonicals are split into ${a.k} folds, deterministically, by ` +
      "`(stableHash(canonicalId) >>> 16) % 5` (FNV-1a; upper bits only — the low bits are provably low-entropy, see " +
      "holdout-analysis.ts). **No canonical appears in both the tuning and held-out portion of the same fold** — " +
      "the round-2 split was per-case, so ~85% of a holdout case's canonical also sat in tuning, meaning \"generalizes\" " +
      "mostly meant \"transfers to another spelling of the same ingredient.\" Each fold selects its ship-gate threshold " +
      "from its own tuning portion only, applies it unchanged to that fold's held-out canonicals, and folds are pooled below.",
  )
  lines.push("")

  lines.push("#### Per-fold results")
  lines.push("")
  lines.push(
    `| Fold | Held-out canonicals | Ship gate | Zero-error on tuning? | Holdout auto-linked | Holdout wrong | Holdout coverage | Holdout precision |`,
  )
  lines.push(`|---|---|---|---|---|---|---|---|`)
  for (const f of a.folds) {
    lines.push(
      `| ${f.index} | ${f.holdoutCanonicalCount} | HIGH=${f.shipGate.high.toFixed(2)}, MARGIN=${f.shipGate.margin.toFixed(2)} | ` +
        `${f.shipGateIsZeroError ? "yes" : "no (fewest-wrong)"} | ${f.holdoutAtShipGate.autoLinked} | ${f.holdoutAtShipGate.wrong} | ` +
        `${f.holdoutAtShipGate.coveragePct.toFixed(1)}% | ${f.holdoutAtShipGate.precisionPct.toFixed(1)}% |`,
    )
  }
  lines.push("")

  const caseWilson = wilsonUpper95(a.pooled.wrong, a.pooled.autoLinked)
  const canonWilson = wilsonUpper95(a.pooledWrongDistinctCanonicals, a.pooledAutoLinkedDistinctCanonicals)
  const totalWeighted = weightedCount(run.results, caseIndex)
  const autoLinkedWeighted = weightedCount(a.pooledAutoLinkedCases, caseIndex)
  const correctWeighted = weightedCount(a.pooledCorrectCases, caseIndex)
  const wrongWeighted = autoLinkedWeighted - correctWeighted
  const coverageWeightedPct = pct(autoLinkedWeighted, totalWeighted)
  const precisionWeightedPct = autoLinkedWeighted > 0 ? pct(correctWeighted, autoLinkedWeighted) : "0.0"
  lines.push("#### Pooled (all folds' holdout evaluations combined)")
  lines.push("")
  lines.push("Unweighted = per distinct product name. Weighted = by `occurrences` (per invoice line) — see \"How to read these numbers.\"")
  lines.push("")
  lines.push(`| | Unweighted | Weighted (occurrences) |`)
  lines.push(`|---|---|---|`)
  lines.push(`| Auto-linked | ${a.pooled.autoLinked} | ${autoLinkedWeighted} |`)
  lines.push(`| Correct | ${a.pooled.correct} | ${correctWeighted} |`)
  lines.push(`| Wrong | ${a.pooled.wrong} | ${wrongWeighted} |`)
  lines.push(`| Coverage | ${a.pooled.coveragePct.toFixed(1)}% | ${coverageWeightedPct}% |`)
  lines.push(`| Precision | ${a.pooled.precisionPct.toFixed(1)}% | ${precisionWeightedPct}% |`)
  lines.push(`| Auto-linked, distinct canonicals | ${a.pooledAutoLinkedDistinctCanonicals} | n/a |`)
  lines.push(`| Wrong, distinct canonicals | ${a.pooledWrongDistinctCanonicals} | n/a |`)
  lines.push(
    `| Wilson 95% upper bound (denominator = auto-linked **cases**, n=${a.pooled.autoLinked}) | ${(caseWilson * 100).toFixed(1)}% |`,
  )
  lines.push(
    `| **Wilson 95% upper bound (denominator = distinct **canonicals**, n=${a.pooledAutoLinkedDistinctCanonicals}) — the honest one** | **${(canonWilson * 100).toFixed(1)}%** |`,
  )
  lines.push("")
  lines.push(
    "The case-count bound treats every one of the ~3.8 spelling variants per canonical as an independent trial. " +
      "They aren't: if the embedding gets one ingredient family wrong, it's likely to get every spelling of that " +
      "same family wrong together, not independently. The distinct-canonical bound is the honest denominator for " +
      "\"how many genuinely different things has this been tested against.\"",
  )
  lines.push("")

  if (a.pooled.wrong > 0) {
    lines.push(
      `**${a.pooled.wrong} wrong auto-link(s) across all folds' holdout evaluations, pooled** — every one printed in full:`,
    )
    lines.push("")
    for (const w of a.pooledWrongCases) {
      writeWrongCase(lines, w.result, w.chosenId, w.result.margin, caseIndex, w.isTie)
    }
  } else {
    lines.push("No wrong auto-links in any fold's holdout evaluation.")
    lines.push("")
  }

  lines.push("#### Frontier detail, per fold")
  lines.push("")
  lines.push(
    "For each fold whose tuning-selected ship gate was zero-error, both adjacent directions are probed — " +
      "`HIGH - 0.01` and `MARGIN - 0.01` — since for some arms/folds the binding constraint is HIGH, not MARGIN, and " +
      "probing only MARGIN would silently miss the case that actually bounds the zero-error region.",
  )
  lines.push("")
  for (const f of a.folds) {
    if (!f.shipGateIsZeroError) {
      lines.push(`**Fold ${f.index}:** ship gate was fewest-wrong, not zero-error — its own wrong cases (table above) are the decisive detail; no frontier probe applies.`)
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
      `HIGH=${probe.row.high.toFixed(2)}, MARGIN=${probe.row.margin.toFixed(2)} — the decisive case(s) that keep ` +
      `this fold's ship gate from being one step looser in the ${probe.direction} direction:`,
  )
  lines.push("")
  for (const w of probe.wrongCases) {
    writeWrongCase(lines, w.result, w.chosenId, w.result.margin, caseIndex, w.isTie)
  }
}
