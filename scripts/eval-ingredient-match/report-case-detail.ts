/**
 * Shared markdown renderer for "one wrong case, in full" — used by both
 * report.ts (default-policy wrong list) and report-holdout.ts (frontier /
 * duplicate-creation detail). Split into its own leaf module so neither of
 * those two needs to import the other.
 */

import type { GoldCase } from "./gold"
import type { ArmResult } from "./arms"

export function writeWrongCase(
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

export function formatScore(score: number | undefined): string {
  return score === undefined ? "?" : score.toFixed(4)
}
