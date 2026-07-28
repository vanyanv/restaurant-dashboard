/**
 * Duplicate-creation ("new" decision) reporting, fix-round-3 points 2-4.
 *
 * Every one of the 260 gold cases has a real, existing correct canonical
 * ingredient. So any case a strategy decides `new` for would, in
 * production, auto-create a **duplicate** of something already in the
 * pantry — silently splitting that ingredient's cost history. This is
 * demonstrated, not hypothetical: the pantry already contains 3 such
 * near-duplicate conflicts (Task 3's gold-set build had to drop 3 ids for
 * exactly this reason). `ambiguous` is safe — it goes to human review.
 *
 * Three sections:
 *   1. Like-for-like across arms (headline) — `classifyCandidates` decides
 *      "new" purely from `top.score < FLOOR`, checked before HIGH or MARGIN
 *      are ever consulted, so comparing arms at *different* operating
 *      points is not a fair comparison. This applies one shared FLOOR to
 *      all arms.
 *   2. Secondary, per-arm, own-policy breakdown — each arm's own
 *      representative operating point, not comparable across arms, kept for
 *      context.
 *   3. FLOOR sweep, per arm — since FLOOR is the only lever that moves the
 *      duplicate-create count at all, sweeping it directly answers "what
 *      would it take to bring this to zero, and what would that cost."
 */

import type { GoldCase } from "./gold"
import type { ArmResult } from "./arms"
import type { ArmRun } from "./report"
import { THRESHOLDS } from "../../src/lib/ingredient-match-scoring"
import { breakdownAtThreshold, breakdownFromResults, newCasesAtFloor, type Breakdown } from "./threshold-eval"
import { bestZeroErrorRow, minWrongRow, pct } from "./sweep-analysis"
import { weightedCount } from "./weighting"
import { formatScore } from "./report-case-detail"

const EXPLAINER =
  "Every one of these 260 gold cases has a real, existing correct canonical ingredient. So any case a strategy " +
  "decides `new` for would, in production, auto-create a **duplicate** of something already in the pantry — " +
  "silently splitting that ingredient's cost history. This is demonstrated, not hypothetical: the pantry already " +
  "contains 3 such near-duplicate conflicts (Task 3's gold-set build had to drop 3 ids for exactly this reason). " +
  "`ambiguous` is safe — it goes to human review, not auto-create."

const FLOOR_RULE_EXPLAINER =
  "`classifyCandidates` decides `new` purely from `top.score < FLOOR` — checked *before* HIGH or MARGIN are ever " +
  "consulted (see `ingredient-match-scoring.ts`). So the duplicate-create count is a function of FLOOR alone; HIGH " +
  "and MARGIN cannot move it, at any value. Comparing arms at *different* operating points — each arm's own ship " +
  "gate or default policy — is therefore not a like-for-like comparison of this specific number, whatever else it's " +
  "useful for."

export function writeLikeForLikeWrongCreateSection(
  lines: string[],
  armRuns: ArmRun[],
  caseIndex: Map<string, GoldCase>,
): void {
  const floor = THRESHOLDS.FLOOR
  lines.push("## Wrong-create rate — like-for-like across arms (headline)")
  lines.push("")
  lines.push(EXPLAINER)
  lines.push("")
  lines.push(FLOOR_RULE_EXPLAINER)
  lines.push("")
  lines.push(`All three arms below, at the single shared rule **top score < FLOOR=${floor.toFixed(2)}**:`)
  lines.push("")
  lines.push(`| Arm | New (duplicate-create) | Weighted (by occurrences) |`)
  lines.push(`|---|---|---|`)
  for (const run of armRuns) {
    const newCases = newCasesAtFloor(run.results, floor)
    const total = run.results.length
    const totalWeighted = weightedCount(run.results, caseIndex)
    const newWeighted = weightedCount(newCases, caseIndex)
    lines.push(
      `| ${run.arm.name} | ${newCases.length} (${pct(newCases.length, total)}%) | ${newWeighted} (${pct(newWeighted, totalWeighted)}%) |`,
    )
  }
  lines.push("")
  lines.push(
    "Per-arm sections below also show each arm's duplicate-create rate at its *own* ship gate / default policy, " +
      "labeled secondary — useful for understanding that arm's actual recommended operating point end to end, but " +
      "not for comparing arms against each other on this specific number.",
  )
  lines.push("")
}

export function writeSecondaryDuplicateCreateSection(
  lines: string[],
  run: ArmRun,
  caseIndex: Map<string, GoldCase>,
): void {
  const { arm, results, sweep } = run
  let breakdown: Breakdown
  let policyLabel: string

  if (arm.name === "token-overlap") {
    breakdown = breakdownFromResults(results)
    policyLabel =
      "default policy (0.25 Jaccard cutoff) — its own honest baseline (see \"Wrong-create rate\" near the top of " +
      "this report for the like-for-like comparison at a shared FLOOR)"
  } else {
    const zeroErrorRow = bestZeroErrorRow(sweep)
    const row = zeroErrorRow ?? minWrongRow(sweep)
    breakdown = breakdownAtThreshold(results, row.high, row.margin)
    policyLabel =
      `illustrative full-sample row (HIGH=${row.high.toFixed(2)}, MARGIN=${row.margin.toFixed(2)}) — **not** the ` +
      'cross-validated result; see "Grouped k-fold validation" above for that'
  }

  const total = results.length
  const totalWeighted = weightedCount(results, caseIndex)

  lines.push("### Duplicate-creation rate — secondary, own policy (not comparable across arms)")
  lines.push("")
  lines.push(
    'See "Wrong-create rate — like-for-like across arms" near the top of this report for the fair cross-arm ' +
      "comparison. This table is this arm's own representative operating point.",
  )
  lines.push("")
  lines.push(`Breakdown at: ${policyLabel}.`)
  lines.push("")
  lines.push(`| Decision | Cases | Weighted (occurrences) |`)
  lines.push(`|---|---|---|`)
  writeBreakdownRow(lines, "Auto-linked, correct", breakdown.autoCorrectCases, total, totalWeighted, caseIndex)
  writeBreakdownRow(lines, "Auto-linked, wrong", breakdown.autoWrongCases, total, totalWeighted, caseIndex)
  writeBreakdownRow(lines, "Ambiguous (safe — human review)", breakdown.ambiguousCases, total, totalWeighted, caseIndex)
  writeBreakdownRow(lines, "**New (= duplicate-create if wired live)**", breakdown.newCases, total, totalWeighted, caseIndex, true)
  lines.push("")

  if (breakdown.newCases.length === 0) {
    lines.push("No `new` decisions at this policy.")
  } else {
    lines.push(`<details><summary>All ${breakdown.newCases.length} "new" cases (click to expand)</summary>`)
    lines.push("")
    lines.push(`| Case | Occurrences | Top score | Expected canonical (would be duplicated) |`)
    lines.push(`|---|---|---|---|`)
    for (const r of breakdown.newCases) {
      const goldCase = caseIndex.get(r.caseId)
      lines.push(
        `| ${r.caseId} | ${goldCase?.occurrences ?? "?"} | ${formatScore(r.topScore)} | ` +
          `${goldCase?.expectedCanonicalName ?? "?"} (\`${r.expectedCanonicalId}\`) |`,
      )
    }
    lines.push("")
    lines.push("</details>")
  }
  lines.push("")
}

function writeBreakdownRow(
  lines: string[],
  label: string,
  cases: ArmResult[],
  total: number,
  totalWeighted: number,
  caseIndex: Map<string, GoldCase>,
  bold = false,
): void {
  const weighted = weightedCount(cases, caseIndex)
  const countCell = `${cases.length} (${pct(cases.length, total)}%)`
  const weightedCell = `${weighted} (${pct(weighted, totalWeighted)}%)`
  lines.push(bold ? `| ${label} | **${countCell}** | **${weightedCell}** |` : `| ${label} | ${countCell} | ${weightedCell} |`)
}

const FLOOR_MIN_CENTS = 40
const FLOOR_MAX_CENTS = 72
const FLOOR_STEP_CENTS = 2

/**
 * FLOOR sweep (round-4, point 5). The previous version reported only the
 * benefit column — duplicate-creates falling as FLOOR drops — and none of the
 * cost, which made "FLOOR <= 0.44 gives zero duplicate-creates" look like a
 * free win. It is not: FLOOR was hardcoded to `THRESHOLDS.FLOOR` in every
 * classification path, so no precision or coverage figure in the report ever
 * moved with it. FLOOR is now a real swept parameter through
 * `classifyCandidates`, and both regimes are shown.
 */
export function writeFloorSweepSection(lines: string[], run: ArmRun, caseIndex: Map<string, GoldCase>): void {
  const { results, sweep } = run
  const total = results.length
  const totalWeighted = weightedCount(results, caseIndex)
  const currentFloorCents = Math.round(THRESHOLDS.FLOOR * 100)
  const gate = bestZeroErrorRow(sweep) ?? minWrongRow(sweep)

  lines.push("### FLOOR sweep — duplicate-creates, auto-link precision, and coverage")
  lines.push("")
  lines.push(
    `FLOOR is swept from ${(FLOOR_MIN_CENTS / 100).toFixed(2)} to ${(FLOOR_MAX_CENTS / 100).toFixed(2)} ` +
      `(production's current value) in steps of ${(FLOOR_STEP_CENTS / 100).toFixed(2)}, **through the real ` +
      "`classifyCandidates`**, so the cost of each value is visible next to its benefit. Two regimes, because they " +
      "answer different questions and only one of them is the regime the ship gates in this report actually land in.",
  )
  lines.push("")
  lines.push(
    "**Both tables are full-sample, not cross-validated.** Every row is scored on all " +
      `${total} cases at a fixed gate, the same caveat that applies to the reference precision/coverage curve above: ` +
      "a 100% precision cell here means \"no error at this point on data that was also used to find the point,\" " +
      "not a generalisation estimate. Use the grouped k-fold section for that. What these tables are for is the " +
      "*shape* of the FLOOR tradeoff, which was previously invisible because FLOOR never reached the classifier " +
      "as a variable at all.",
  )
  lines.push("")

  // Regime A: HIGH fixed. FLOOR below HIGH can only relabel new -> ambiguous.
  lines.push(`**Regime A — HIGH held fixed at ${gate.high.toFixed(2)}, MARGIN at ${gate.margin.toFixed(2)}.**`)
  lines.push("")
  writeFloorTable(lines, run, caseIndex, total, totalWeighted, currentFloorCents, () => gate.high, gate.margin)
  lines.push(
    "Auto-link precision and coverage are **completely flat** across this whole sweep, and that is not a bug — it " +
      "is the structural fact the previous version of this table obscured. `classifyCandidates` returns `new` when " +
      "`top.score < FLOOR`, and `auto` only when `top.score >= HIGH`. So whenever FLOOR <= HIGH, every case FLOOR " +
      "moves is a case scoring below HIGH, which could never have auto-linked anyway. Lowering FLOOR under a fixed " +
      "HIGH does not buy a single extra auto-link — it only **relabels `new` as `ambiguous`**, moving cases from " +
      "\"silently create a duplicate\" to \"send to human review.\" That is a genuine safety improvement, but it is " +
      "a routing change, not a coverage change, and it hands every one of those cases to a human.",
  )
  lines.push("")

  // Regime B: HIGH tracks FLOOR — the regime every ship gate in this report lands in.
  lines.push(`**Regime B — HIGH tracks FLOOR (HIGH = FLOOR at every step), MARGIN at ${gate.margin.toFixed(2)}.**`)
  lines.push("")
  writeFloorTable(lines, run, caseIndex, total, totalWeighted, currentFloorCents, (f) => f, gate.margin)
  lines.push(
    "This is the regime that matters: every zero-error ship gate found anywhere in this report lands with HIGH " +
      "exactly at FLOOR, so in practice lowering FLOOR lowers HIGH with it and genuinely admits new auto-links — " +
      "at whatever precision those newly-admitted, lower-scoring cases happen to have. That precision is measured " +
      "here for the first time; it was previously unmeasured because FLOOR never reached the classifier as a variable.",
  )
  lines.push("")

  writeFloorZeroClaim(lines, run, total)
}

/** One FLOOR sweep table. `highFor` decides the regime: a constant HIGH, or
 * HIGH tracking FLOOR. */
function writeFloorTable(
  lines: string[],
  run: ArmRun,
  caseIndex: Map<string, GoldCase>,
  total: number,
  totalWeighted: number,
  currentFloorCents: number,
  highFor: (floor: number) => number,
  margin: number,
): void {
  lines.push(`| FLOOR | HIGH | New (duplicate-create) | Weighted | Ambiguous | Auto-linked | Wrong | Coverage | Precision |`)
  lines.push(`|---|---|---|---|---|---|---|---|---|`)
  for (let f = FLOOR_MIN_CENTS; f <= FLOOR_MAX_CENTS; f += FLOOR_STEP_CENTS) {
    const floor = f / 100
    const high = highFor(floor)
    const b = breakdownAtThreshold(run.results, high, margin, floor)
    const autoLinked = b.autoCorrectCases.length + b.autoWrongCases.length
    const weighted = weightedCount(b.newCases, caseIndex)
    lines.push(
      `| ${floor.toFixed(2)}${f === currentFloorCents ? " (current)" : ""} | ${high.toFixed(2)} | ` +
        `${b.newCases.length} (${pct(b.newCases.length, total)}%) | ${weighted} (${pct(weighted, totalWeighted)}%) | ` +
        `${b.ambiguousCases.length} | ${autoLinked} | **${b.autoWrongCases.length}** | ` +
        `${pct(autoLinked, total)}% | ${autoLinked > 0 ? pct(b.autoCorrectCases.length, autoLinked) : "n/a"}% |`,
    )
  }
  lines.push("")
}

/** State plainly what a "zero duplicate-creates" FLOOR value actually means. */
function writeFloorZeroClaim(lines: string[], run: ArmRun, total: number): void {
  let highestZero: number | null = null
  for (let f = FLOOR_MIN_CENTS; f <= FLOOR_MAX_CENTS; f += FLOOR_STEP_CENTS) {
    if (newCasesAtFloor(run.results, f / 100).length === 0) highestZero = f / 100
  }
  const minTop = Math.min(...run.results.map((r) => r.topScore))
  if (highestZero === null) return
  lines.push(
    `> **What "zero duplicate-creates at FLOOR <= ${highestZero.toFixed(2)}" actually means.** It does not mean the ` +
      "matcher got better. The lowest top-score anywhere in this arm's " +
      `${total} cases is ${minTop.toFixed(4)}, so at any FLOOR at or below that value **no case can ever be classified ` +
      "`new`** — the bucket is empty because the rule that fills it can no longer fire. In production terms, setting " +
      "FLOOR there switches off new-ingredient onboarding entirely: every invoice line, including a genuinely novel " +
      "product this pantry has never seen, is forced to either auto-link to or be reviewed against an existing " +
      "canonical, and can never open a new one. Zero duplicate-creates is bought by making creation impossible, not " +
      "by making matching safer. Whether that is the right trade is a product decision; it is not a free win, and " +
      "the number should never be quoted without this sentence attached.",
  )
  lines.push("")
}
