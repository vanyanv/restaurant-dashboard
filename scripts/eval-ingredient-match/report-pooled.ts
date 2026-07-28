/**
 * The pooled grouped-k-fold table, rendered four ways (round-4, points 2 & 3):
 * two gate-selection rules × two case sets (as-is, and excluding the gold
 * labels this round audited and disputed).
 *
 * The as-is / permissive row is the same number every earlier round reported,
 * and it is always printed first. Nothing is silently dropped: the disputed
 * cases are enumerated with their evidence immediately below the tables.
 */

import type { GoldCase } from "./gold"
import type { ArmResult } from "./arms"
import {
  analyzeGroupedKFold,
  GATE_RULES,
  GATE_RULE_LABELS,
  type GateRule,
  type GroupedKFoldAnalysis,
} from "./holdout-analysis"
import { wilsonUpper95, pct } from "./sweep-analysis"
import { weightedCount } from "./weighting"
import { DISPUTED_LABELS, excludeDisputed, excludeDisputedCases } from "./disputed-labels"

export type CaseSet = "as-is" | "excluding disputed"

export type PooledVariant = {
  rule: GateRule
  caseSet: CaseSet
  analysis: GroupedKFoldAnalysis
}

/** All four (rule × case set) combinations, in a fixed order so the as-is /
 * permissive row — the directly comparable one — always reads first. */
export function buildPooledVariants(cases: GoldCase[], results: ArmResult[]): PooledVariant[] {
  const keptCases = excludeDisputedCases(cases)
  const keptResults = excludeDisputed(results)
  const variants: PooledVariant[] = []
  for (const rule of GATE_RULES) {
    variants.push({ rule, caseSet: "as-is", analysis: analyzeGroupedKFold(cases, results, rule) })
    variants.push({
      rule,
      caseSet: "excluding disputed",
      analysis: analyzeGroupedKFold(keptCases, keptResults, rule),
    })
  }
  return variants
}

function gateCell(a: GroupedKFoldAnalysis): string {
  if (a.sharedGate) {
    return `HIGH=${a.sharedGate.high.toFixed(2)}, MARGIN=${a.sharedGate.margin.toFixed(2)} (shared)`
  }
  return "per fold (see table above)"
}

export function writePooledTables(
  lines: string[],
  variants: PooledVariant[],
  caseIndex: Map<string, GoldCase>,
): void {
  lines.push("#### Pooled results — both gate-selection rules, both case sets")
  lines.push("")
  lines.push(
    "Two things that were previously collapsed into a single number are separated here. First, the **gate-selection " +
      "rule**: `bestZeroErrorRow` maximises coverage subject to zero error, so it lands on the loosest threshold " +
      "with no tuning errors — sitting exactly on the empirical boundary. That is a real choice, not a neutral " +
      "default, and it is load-bearing on this data. Second, the **case set**: three gold labels were audited " +
      "against production this round and found not to be a fair test (listed in full below).",
  )
  lines.push("")
  for (const rule of GATE_RULES) {
    lines.push(`- \`${rule}\` — ${GATE_RULE_LABELS[rule]}`)
  }
  lines.push("")
  lines.push(
    "> **Read the `median` rows as the full-sample curve at a single gate — they are not a cross-validated result, " +
      "despite sitting under this heading.** Under `median` every fold is scored at the same gate, and every case is " +
      "held out in exactly one fold, so pooling sums disjoint subsets that together are the entire gold set at one " +
      "fixed threshold. That is arithmetically identical to scoring all cases at that threshold in a single pass — " +
      "you can check it directly: each `median` row reproduces the matching row of this arm's own full-sample " +
      "precision/coverage curve above. It is not a weakened cross-validated number; it is a different quantity. " +
      "**The cross-validated estimate in this report is the `permissive` rows and only those.** The `median` rows " +
      "answer a narrower question: where does the whole gold set sit at one shared threshold, instead of at " +
      "whichever threshold each fold happened to pick for itself?",
  )
  lines.push("")
  lines.push(
    "`median` is also **not** reliably the tighter or safer of the two, so it is described here rather than " +
      "characterized: on this data it selects MARGIN=0.01 for `vector-only` excluding disputed labels, and " +
      "MARGIN=0.15 — the edge of the swept grid — for `token-overlap`, both looser than most folds' own picks. " +
      "(\"Tightest zero-error row\" was the other candidate rule and was rejected as degenerate: coverage falls " +
      "monotonically in HIGH, so rows near HIGH=0.99 auto-link almost nothing and are zero-error trivially — the " +
      "tightest zero-error gate is an empty gate.)",
  )
  lines.push("")

  lines.push("Unweighted (per distinct product name):")
  lines.push("")
  lines.push(
    "| Rule | Case set | Gate | Cases | Auto-linked | Correct | Wrong | Coverage | Precision | Auto canon. | Wrong canon. | Wilson 95% (cases) | Wilson 95% (canon.) |",
  )
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
  for (const v of variants) {
    const a = v.analysis
    const caseWilson = wilsonUpper95(a.pooled.wrong, a.pooled.autoLinked)
    const canonWilson = wilsonUpper95(a.pooledWrongDistinctCanonicals, a.pooledAutoLinkedDistinctCanonicals)
    lines.push(
      `| ${v.rule} | ${v.caseSet} | ${gateCell(a)} | ${a.totalCases} | ${a.pooled.autoLinked} | ${a.pooled.correct} | ` +
        `**${a.pooled.wrong}** | ${a.pooled.coveragePct.toFixed(1)}% | ${a.pooled.precisionPct.toFixed(1)}% | ` +
        `${a.pooledAutoLinkedDistinctCanonicals} | ${a.pooledWrongDistinctCanonicals} | ` +
        `${(caseWilson * 100).toFixed(1)}% (n=${a.pooled.autoLinked}) | ` +
        `${(canonWilson * 100).toFixed(1)}% (n=${a.pooledAutoLinkedDistinctCanonicals}) |`,
    )
  }
  lines.push("")
  lines.push(
    "The case-count Wilson bound treats every one of the ~3.8 spelling variants per canonical as an independent " +
      "trial. They aren't: if the embedding gets one ingredient family wrong, it is likely to get every spelling of " +
      "that family wrong together. The distinct-canonical bound is the honest denominator for \"how many genuinely " +
      "different things has this been tested against,\" and it stays in the high single digits under every rule — " +
      "a 0-wrong pooled result does not mean a proven zero error rate.",
  )
  lines.push("")

  lines.push("Weighted by `occurrences` (per invoice line — money is lost per line, not per product name):")
  lines.push("")
  lines.push("| Rule | Case set | Lines | Auto-linked | Correct | Wrong | Coverage | Precision |")
  lines.push("|---|---|---|---|---|---|---|---|")
  for (const v of variants) {
    const a = v.analysis
    const autoW = weightedCount(a.pooledAutoLinkedCases, caseIndex)
    const correctW = weightedCount(a.pooledCorrectCases, caseIndex)
    const denomW = weightedCount(a.pooledAllCases, caseIndex)
    lines.push(
      `| ${v.rule} | ${v.caseSet} | ${denomW} | ${autoW} | ${correctW} | **${autoW - correctW}** | ` +
        `${pct(autoW, denomW)}% | ${autoW > 0 ? pct(correctW, autoW) : "0.0"}% |`,
    )
  }
  lines.push("")
}

export function writeDisputedSection(lines: string[]): void {
  lines.push("#### The disputed gold labels, in full")
  lines.push("")
  lines.push(
    `${DISPUTED_LABELS.length} cases are excluded from the "excluding disputed" rows above — every one listed here ` +
      "with the evidence that decided it. They remain in the gold set and in every other table in this report; " +
      "`gold.ts` was not modified. The audit behind them was read-only against production and changed nothing.",
  )
  lines.push("")
  for (const d of DISPUTED_LABELS) {
    lines.push(`**\`${d.caseId}\`** — ${d.kind}`)
    lines.push("")
    lines.push(`- Product name: \`${d.productName}\``)
    lines.push(`- Gold label (from \`InvoiceLineItem.canonicalIngredientId\`): ${d.goldSays}`)
    lines.push(`- What it should plainly be: ${d.shouldBe}`)
    lines.push(`- Evidence: ${d.evidence}`)
    lines.push("")
  }
  const mislabeled = DISPUTED_LABELS.filter((d) => d.kind === "mislabeled-gold")
  if (mislabeled.length > 0) {
    lines.push(
      `> **This is a live data bug, not only an evaluation artifact.** ${mislabeled.length} invoice line(s) are ` +
        "currently costed against the wrong canonical ingredient in production, so those dollars are landing in " +
        "the wrong ingredient's cost history. That is worth raising with the account owner independently of " +
        "anything this bake-off concludes. Nothing was written to fix it — that is the owner's call on his own records.",
    )
    lines.push("")
  }
}
