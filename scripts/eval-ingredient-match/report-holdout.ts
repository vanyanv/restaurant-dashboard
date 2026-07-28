/**
 * Two report sections added in fix-round-2:
 *   1. Tuning/holdout validation — the ship-gate threshold is selected on a
 *      deterministic half of the gold set and verified, unchanged, against
 *      the other half. A "0 wrong" claim ships with its Wilson 95% upper
 *      bound so it reads as a sample-size-bounded estimate, not a guarantee.
 *   2. Duplicate-creation rate — every case an arm decides "new" would, in
 *      production, auto-create a duplicate of a canonical that already
 *      exists (every gold case has one), silently splitting its cost
 *      history. That failure mode is invisible in auto-link precision/
 *      coverage numbers, so it gets its own accounting.
 */

import type { GoldCase } from "./gold"
import type { ArmResult } from "./arms"
import type { ArmRun } from "./report"
import { THRESHOLDS } from "../../src/lib/ingredient-match-scoring"
import { analyzeHoldout } from "./holdout-analysis"
import { breakdownAtThreshold, breakdownFromResults, wrongCasesAtThreshold, type Breakdown } from "./threshold-eval"
import { wilsonUpper95, pct } from "./sweep-analysis"
import { writeWrongCase, formatScore } from "./report-case-detail"

export function writeHoldoutSection(
  lines: string[],
  run: ArmRun,
  gold: { cases: GoldCase[] },
  caseIndex: Map<string, GoldCase>,
): void {
  const a = analyzeHoldout(gold.cases, run.results)

  lines.push("### Tuning/holdout validation (ship-gate selection)")
  lines.push("")
  lines.push(
    "Gold cases are split 50/50, deterministically, by `stableHash(case.id) % 2` (FNV-1a; no `Math.random()`, " +
      "identical every run). The ship-gate threshold is selected **only** on the tuning half's sweep, then applied " +
      "unchanged to the holdout half — a threshold chosen because it's exactly where the last tuning-half error " +
      "disappears is a point estimate at that half's boundary, not a property of the strategy, until it's checked " +
      "against cases it wasn't chosen from.",
  )
  lines.push("")
  lines.push(`Tuning half: ${a.tuningCount} cases. Holdout half: ${a.holdoutCount} cases.`)
  lines.push("")

  if (a.shipGateIsZeroError) {
    lines.push(
      `**Ship gate (selected on tuning half only): HIGH=${a.shipGate.high.toFixed(2)}, MARGIN=${a.shipGate.margin.toFixed(2)}** — ` +
        `zero-error on tuning (${a.shipGate.autoLinked} auto-linked, ${a.shipGate.correct} correct, 0 wrong).`,
    )
  } else {
    lines.push(
      `**No zero-error row exists on the tuning half.** Reporting the fewest-wrong row instead: ` +
        `HIGH=${a.shipGate.high.toFixed(2)}, MARGIN=${a.shipGate.margin.toFixed(2)} — ${a.shipGate.wrong} wrong ` +
        `out of ${a.shipGate.autoLinked} auto-linked.`,
    )
  }
  lines.push("")

  lines.push(`| | Tuning (n=${a.tuningCount}) | Holdout (n=${a.holdoutCount}, same thresholds) |`)
  lines.push(`|---|---|---|`)
  lines.push(`| Auto-linked | ${a.shipGate.autoLinked} | ${a.holdoutAtShipGate.autoLinked} |`)
  lines.push(`| Correct | ${a.shipGate.correct} | ${a.holdoutAtShipGate.correct} |`)
  lines.push(`| Wrong | ${a.shipGate.wrong} | ${a.holdoutAtShipGate.wrong} |`)
  lines.push(`| Coverage | ${a.shipGate.coveragePct.toFixed(1)}% | ${a.holdoutAtShipGate.coveragePct.toFixed(1)}% |`)
  lines.push(`| Precision | ${a.shipGate.precisionPct.toFixed(1)}% | ${a.holdoutAtShipGate.precisionPct.toFixed(1)}% |`)
  lines.push(
    `| Wilson 95% upper bound on true error rate | ${(wilsonUpper95(a.shipGate.wrong, a.shipGate.autoLinked) * 100).toFixed(1)}% | ` +
      `${(wilsonUpper95(a.holdoutAtShipGate.wrong, a.holdoutAtShipGate.autoLinked) * 100).toFixed(1)}% |`,
  )
  lines.push("")

  if (a.holdoutAtShipGate.wrong > 0) {
    lines.push(
      `**The holdout half shows ${a.holdoutAtShipGate.wrong} wrong auto-link(s) at the tuning-selected thresholds ` +
        "that the tuning half's own \"zero errors\" claim did not predict.** This is the single most important " +
        "finding for this arm: the zero-error result does not generalize past the sample it was selected on. Full " +
        "detail below, not retuned away.",
    )
    lines.push("")
    const holdoutResults = run.results.filter((r) => a.split.holdoutIds.has(r.caseId))
    for (const w of wrongCasesAtThreshold(holdoutResults, a.shipGate.high, a.shipGate.margin)) {
      writeWrongCase(lines, w.result, w.chosenId, w.result.margin, caseIndex, w.isTie)
    }
  }

  lines.push("#### The decisive case (frontier detail)")
  lines.push("")
  if (a.frontier) {
    lines.push(
      `At MARGIN=${a.frontier.row.margin.toFixed(2)} (one step looser than the ship gate's ` +
        `MARGIN=${a.shipGate.margin.toFixed(2)}, same HIGH=${a.shipGate.high.toFixed(2)}), the tuning half has ` +
        `${a.frontier.row.wrong} wrong out of ${a.frontier.row.autoLinked} auto-linked (${a.frontier.row.coveragePct.toFixed(1)}% coverage) — ` +
        "this is the exact case (or cases) that keep the threshold from being one notch looser. Printed in full " +
        "because a zero-error row's own wrong-case list is trivially empty and would otherwise hide it.",
    )
    lines.push("")
    for (const w of a.frontier.wrongCases) {
      writeWrongCase(lines, w.result, w.chosenId, w.result.margin, caseIndex, w.isTie)
    }
  } else if (a.shipGateIsZeroError) {
    lines.push(
      "No adjacent looser-MARGIN row (or it has 0 wrong too) — the zero-error region extends at least one step " +
        "looser than the ship gate on the tuning half.",
    )
    lines.push("")
  } else {
    lines.push("No zero-error row exists, so the ship-gate row's own wrong cases above (default-policy section or holdout list) are the decisive detail; no separate frontier applies.")
    lines.push("")
  }
}

export function writeDuplicateCreationSection(
  lines: string[],
  run: ArmRun,
  gold: { cases: GoldCase[] },
  caseIndex: Map<string, GoldCase>,
): void {
  const { arm, results } = run
  let breakdown: Breakdown
  let policyLabel: string

  if (arm.name === "token-overlap") {
    breakdown = breakdownFromResults(results)
    policyLabel = "default policy (0.25 Jaccard cutoff) — its own honest baseline; the cosine-calibrated sweep doesn't transfer to Jaccard scores (see arms.ts)"
  } else {
    const a = analyzeHoldout(gold.cases, results)
    breakdown = breakdownAtThreshold(results, a.shipGate.high, a.shipGate.margin)
    policyLabel = `ship-gate thresholds selected on the tuning half (HIGH=${a.shipGate.high.toFixed(2)}, MARGIN=${a.shipGate.margin.toFixed(2)}), applied to all ${results.length} cases`
  }

  const total = results.length
  lines.push("### Duplicate-creation rate")
  lines.push("")
  lines.push(
    "Every one of these 260 gold cases has a real, existing correct canonical ingredient. So any case a strategy " +
      "decides `new` for would, in production, auto-create a **duplicate** of something already in the pantry — " +
      "silently splitting that ingredient's cost history. This is demonstrated, not hypothetical: the pantry " +
      "already contains 3 such near-duplicate conflicts (Task 3's gold-set build had to drop 3 ids for exactly " +
      "this reason). `ambiguous` is safe — it goes to human review, not auto-create.",
  )
  lines.push("")
  lines.push(`Breakdown at: ${policyLabel}.`)
  lines.push("")
  lines.push(`| Decision | Count | % of ${total} |`)
  lines.push(`|---|---|---|`)
  lines.push(`| Auto-linked, correct | ${breakdown.autoCorrect} | ${pct(breakdown.autoCorrect, total)}% |`)
  lines.push(`| Auto-linked, wrong | ${breakdown.autoWrong} | ${pct(breakdown.autoWrong, total)}% |`)
  lines.push(`| Ambiguous (safe — human review) | ${breakdown.ambiguous} | ${pct(breakdown.ambiguous, total)}% |`)
  lines.push(`| **New (= duplicate-create if wired live)** | **${breakdown.newCount}** | **${pct(breakdown.newCount, total)}%** |`)
  lines.push("")

  if (breakdown.newCount === 0) {
    lines.push("No `new` decisions at this policy — 0 duplicate-creates.")
  } else {
    lines.push(`<details><summary>All ${breakdown.newCount} "new" cases (click to expand)</summary>`)
    lines.push("")
    lines.push(`| Case | Top score | Expected canonical (would be duplicated) |`)
    lines.push(`|---|---|---|`)
    for (const r of breakdown.newCases) {
      const goldCase = caseIndex.get(r.caseId)
      lines.push(
        `| ${r.caseId} | ${formatScore(r.topScore)} | ${goldCase?.expectedCanonicalName ?? "?"} (\`${r.expectedCanonicalId}\`) |`,
      )
    }
    lines.push("")
    lines.push("</details>")
  }
  lines.push("")
}
