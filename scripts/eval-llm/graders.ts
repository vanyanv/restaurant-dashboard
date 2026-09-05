/**
 * Graders for the frozen LLM golden set.
 *
 * Pure functions: a recorded model output in, a pass/fail with reasons out. No
 * network, no clock, no database. That is what lets the replay suite run inside
 * `npm test` against committed fixtures — free, deterministic, no API key —
 * while the live runner reuses the exact same grading logic against the real
 * model when someone actually edits a prompt.
 *
 * Two rules shape everything here.
 *
 * 1. Pass/fail is decided by the PRODUCTION parser wherever one exists —
 *    `parseVerdictLine`, `parseProposalDrafts`, `parseAdjudicatorDrafts`. The
 *    graders never re-implement a shipped rule. An eval that grades against its
 *    own copy of the guard stops measuring the guard the first time they drift,
 *    and does it silently.
 *
 * 2. A failure must be readable. Production only needs "reject"; a report needs
 *    "quoted $9,999, which is not in the fact block". So each grader adds a
 *    diagnosis alongside the verdict. The diagnosis is advisory — if it ever
 *    disagrees with the production parser, the parser wins and the reason line
 *    says so.
 */

import { parseVerdictLine, VERDICT_MAX_CHARS } from "@/lib/decision-verdict-llm"
import {
  parseProposalDrafts,
  type ProposalDraftKind,
} from "@/lib/proposal-llm"
import {
  parseAdjudicatorDrafts,
  type AdjudicatorCase,
} from "@/lib/ingredient-match-llm"
import {
  verdictFactBlock,
  type VerdictFacts,
} from "@/lib/decisions/verdict-copy"

export interface Grade {
  pass: boolean
  /** Empty when passing. One short human-readable phrase per failed check. */
  failures: string[]
}

const ok = (): Grade => ({ pass: true, failures: [] })
const bad = (...failures: string[]): Grade => ({ pass: false, failures })

// --- tool choice ---------------------------------------------------------------

/**
 * Did the chat agent reach for the right data?
 *
 * `expected` is a set of acceptable tools, not a required sequence: several
 * questions have more than one defensible route, and chaining an extra lookup
 * alongside the right one is usually better behaviour rather than worse. Only
 * the *absence* of an acceptable tool is a regression.
 *
 * An empty `expected` inverts the test: the question is outside the warehouse
 * and the agent must say so rather than fish for an answer.
 */
export function gradeToolChoice(actual: string[], expected: string[]): Grade {
  const used = [...new Set(actual)]

  if (expected.length === 0) {
    return used.length === 0
      ? ok()
      : bad(`expected no tool call, got ${used.join(", ")}`)
  }
  if (used.length === 0) {
    return bad(`answered without calling a tool; expected one of ${expected.join(", ")}`)
  }
  if (used.some((t) => expected.includes(t))) return ok()

  return bad(
    `called ${used.join(", ")}; expected one of ${expected.join(", ")}`,
  )
}

// --- narrated verdict ----------------------------------------------------------

/** Digit-runs normalised so "$9,240" and "9240" compare equal. Mirrors the guard. */
function digitRuns(s: string): string[] {
  return (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""))
}

const REFUSAL = /\b(i'?m sorry|i can'?t|i cannot|as an ai|language model|i'?m unable)\b/i

/**
 * Why the guard is about to reject — for the report only.
 *
 * `parseVerdictLine` returns null and nothing else, which is exactly right in
 * production and useless in a scorecard. This walks the same conditions to name
 * one. It is never the source of truth for pass/fail.
 */
function diagnoseVerdict(raw: string, facts: VerdictFacts): string {
  if (!raw.trim()) return "empty completion"

  const first = (raw.split(/\r?\n/)[0] ?? "").trim()
  const line = first
    .replace(/^["'“”‘’]+/, "")
    .replace(/["'“”‘’]+$/, "")
    .replace(/\*\*|\*|`|_{2,}/g, "")
    .replace(/\s+/g, " ")
    .trim()

  if (REFUSAL.test(line)) return "model refused or answered meta"
  if (line.length > VERDICT_MAX_CHARS) {
    return `too long for the masthead: ${line.length} chars against a ${VERDICT_MAX_CHARS} budget`
  }

  const allowed = new Set(Object.values(verdictFactBlock(facts)).flatMap(digitRuns))
  const invented = digitRuns(line).filter((n) => !allowed.has(n))
  if (invented.length > 0) {
    return `quoted ${invented.join(", ")}, which the page never computed`
  }
  return "rejected by the guard for a reason this diagnosis does not cover"
}

export interface VerdictExpectation {
  /**
   * Substrings the sentence must carry — normally the one figure a working
   * owner acts on first. Faithfulness alone is not enough: a sentence about
   * forecast accuracy quotes nothing invented and is still the wrong thing to
   * put at the top of the page.
   */
  mustContain?: string[]
}

export function gradeVerdictNarration(
  raw: string,
  facts: VerdictFacts,
  expect: VerdictExpectation = {},
): Grade {
  const line = parseVerdictLine(raw, facts)
  if (line === null) return bad(diagnoseVerdict(raw, facts))

  const missing = (expect.mustContain ?? []).filter((needle) => !line.includes(needle))
  if (missing.length > 0) {
    return bad(`did not lead with ${missing.join(", ")} — said instead: "${line}"`)
  }
  return ok()
}

// --- structured: recipe proposals ----------------------------------------------

export interface ExpectedProposal {
  itemName: string
  kind: ProposalDraftKind
  /** kind=MATCH: the existing recipe this item must resolve to. */
  matchRecipeName?: string
  /** Order-insensitive. Checked as a set, since the model's ordering is arbitrary. */
  componentNames?: string[]
  /**
   * Every component must reference an existing recipe rather than a raw
   * ingredient — the prompt's load-bearing rule, expressed without pinning
   * which recipes.
   *
   * Some item names have more than one defensible bill of materials ("2 Slider
   * Combo" is two singles or one double depending on the reader) while having
   * exactly one defensible *shape*. Grading those on an exact composition tests
   * whoever wrote the label. This tests the rule.
   */
  allComponentsAreRecipes?: boolean
}

export function gradeProposalDrafts(
  raw: string,
  expected: ExpectedProposal[],
): Grade {
  const drafts = parseProposalDrafts(raw)
  if (drafts.length === 0 && expected.length > 0) {
    return bad("no parseable proposals in the completion")
  }

  const failures: string[] = []
  const byName = new Map(drafts.map((d) => [d.itemName, d]))

  for (const e of expected) {
    const got = byName.get(e.itemName)
    if (!got) {
      failures.push(`no proposal for "${e.itemName}"`)
      continue
    }
    if (got.kind !== e.kind) {
      failures.push(`"${e.itemName}": kind ${got.kind}, expected ${e.kind}`)
    }
    if (e.matchRecipeName && got.matchRecipeName !== e.matchRecipeName) {
      failures.push(
        `"${e.itemName}": matched ${got.matchRecipeName ?? "nothing"}, expected ${e.matchRecipeName}`,
      )
    }
    if (e.allComponentsAreRecipes) {
      if (got.components.length === 0) {
        failures.push(`"${e.itemName}": decomposed into nothing`)
      }
      const raw = got.components.filter((c) => c.type !== "recipe").map((c) => c.name)
      if (raw.length > 0) {
        failures.push(
          `"${e.itemName}": flattened to raw ingredients (${raw.join(", ")}) instead of composing recipes`,
        )
      }
    }
    if (e.componentNames) {
      const want = [...e.componentNames].sort()
      const have = got.components.map((c) => c.name).sort()
      if (want.join("|") !== have.join("|")) {
        failures.push(
          `"${e.itemName}": composed of ${have.join(" + ") || "nothing"}, expected ${want.join(" + ")}`,
        )
      }
    }
  }

  // An unasked-for proposal is a real defect, not noise: the action layer will
  // happily surface it to the owner as something to approve.
  const wanted = new Set(expected.map((e) => e.itemName))
  for (const d of drafts) {
    if (!wanted.has(d.itemName)) failures.push(`invented a proposal for "${d.itemName}"`)
  }

  return failures.length === 0 ? ok() : { pass: false, failures }
}

// --- structured: invoice-line adjudication -------------------------------------

export interface ExpectedAdjudication {
  caseId: string
  /** The candidate that IS the product, or null for a genuinely new ingredient. */
  matchName: string | null
}

export function gradeAdjudicatorDrafts(
  raw: string,
  cases: AdjudicatorCase[],
  expected: ExpectedAdjudication[],
): Grade {
  const drafts = parseAdjudicatorDrafts(raw)
  const byCase = new Map(drafts.map((d) => [d.caseId, d]))
  const shortlists = new Map(
    cases.map((c) => [c.caseId, new Set(c.candidates.map((x) => x.name))]),
  )

  const failures: string[] = []
  for (const e of expected) {
    const got = byCase.get(e.caseId)
    if (!got) {
      failures.push(`case ${e.caseId}: no draft returned`)
      continue
    }

    // Checked before correctness, and checked for every case rather than only
    // the ones that got it wrong: nothing downstream re-verifies which case a
    // name came from, so a borrowed candidate ships as a confident wrong link.
    if (got.matchName !== null && !shortlists.get(e.caseId)?.has(got.matchName)) {
      failures.push(
        `case ${e.caseId}: "${got.matchName}" is not on that case's shortlist`,
      )
      continue
    }

    if (got.matchName !== e.matchName) {
      failures.push(
        `case ${e.caseId}: chose ${got.matchName ?? "none of these"}, expected ${e.matchName ?? "none of these"}`,
      )
    }
  }

  return failures.length === 0 ? ok() : { pass: false, failures }
}

// --- the scorecard -------------------------------------------------------------

export interface GradedCase {
  feature: string
  id: string
  pass: boolean
  failures: string[]
  costUsd: number
  durationMs: number
}

export interface FeatureSummary {
  total: number
  passed: number
  passRate: number
  costUsd: number
}

export interface EvalSummary {
  total: number
  passed: number
  passRate: number
  costUsd: number
  byFeature: Record<string, FeatureSummary>
}

export function summarise(rows: GradedCase[]): EvalSummary {
  const byFeature: Record<string, FeatureSummary> = {}
  for (const r of rows) {
    const f = (byFeature[r.feature] ??= { total: 0, passed: 0, passRate: 0, costUsd: 0 })
    f.total += 1
    if (r.pass) f.passed += 1
    f.costUsd += r.costUsd
  }
  for (const f of Object.values(byFeature)) {
    f.passRate = f.total === 0 ? 0 : f.passed / f.total
  }

  const passed = rows.filter((r) => r.pass).length
  return {
    total: rows.length,
    passed,
    passRate: rows.length === 0 ? 0 : passed / rows.length,
    costUsd: rows.reduce((s, r) => s + r.costUsd, 0),
    byFeature,
  }
}

export interface FloorCheck {
  feature: string
  passRate: number
  floor: number
  total: number
  ok: boolean
}

/**
 * An eval with no threshold is a report, not a gate.
 *
 * Iterates the FLOORS, not the results: a run that silently produced no cases
 * for a feature must fail rather than report green. That is the failure mode
 * that lets an eval quietly stop testing something while still looking healthy.
 */
export function checkFloors(
  summary: EvalSummary,
  floors: Record<string, number>,
): FloorCheck[] {
  return Object.entries(floors).map(([feature, floor]) => {
    const f = summary.byFeature[feature]
    const total = f?.total ?? 0
    const passRate = f?.passRate ?? 0
    return { feature, passRate, floor, total, ok: total > 0 && passRate >= floor }
  })
}
