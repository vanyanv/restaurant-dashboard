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

export function writeFloorSweepSection(lines: string[], run: ArmRun, caseIndex: Map<string, GoldCase>): void {
  const { results } = run
  const total = results.length
  const totalWeighted = weightedCount(results, caseIndex)
  const currentFloorCents = Math.round(THRESHOLDS.FLOOR * 100)

  lines.push("### FLOOR sweep — what it would take to bring duplicate-create to zero")
  lines.push("")
  lines.push(
    "The duplicate-create count depends on FLOOR alone (see above) — HIGH and MARGIN never move it. Swept here " +
      `from ${(FLOOR_MIN_CENTS / 100).toFixed(2)} to ${(FLOOR_MAX_CENTS / 100).toFixed(2)} (production's current value) ` +
      `in steps of ${(FLOOR_STEP_CENTS / 100).toFixed(2)}, so the actual cost of the current FLOOR — and of any change to it — is visible directly.`,
  )
  lines.push("")
  lines.push(`| FLOOR | New (duplicate-create) | Weighted |`)
  lines.push(`|---|---|---|`)
  for (let f = FLOOR_MIN_CENTS; f <= FLOOR_MAX_CENTS; f += FLOOR_STEP_CENTS) {
    const floor = f / 100
    const newCases = newCasesAtFloor(results, floor)
    const weighted = weightedCount(newCases, caseIndex)
    lines.push(
      `| ${floor.toFixed(2)}${f === currentFloorCents ? " (current)" : ""} | ${newCases.length} (${pct(newCases.length, total)}%) | ` +
        `${weighted} (${pct(weighted, totalWeighted)}%) |`,
    )
  }
  lines.push("")
  lines.push(
    "Lowering FLOOR reduces duplicate-creates but increases how often a genuinely novel product gets forced into a " +
      "match against something in the pantry that isn't actually it — FLOOR exists specifically to prevent that. " +
      "This sweep does not recommend a value; it makes the tradeoff visible.",
  )
  lines.push("")
}
