// The free half of the harness.
//
// The live run is the only thing that can answer "does the current prompt still
// get the current model to behave", and it costs money, so it cannot run on
// every push. What CAN run on every push is the other direction: replaying what
// the model actually said, through the current guards, and checking the verdict
// has not moved.
//
// That is a different question from the 1562 tests around these parsers, and a
// more useful one. Those feed the guards strings a human wrote — strings chosen
// because someone already suspected they mattered. These are what gpt-4.1-mini,
// gpt-5.4-nano and gpt-5-mini actually emitted, with all the formatting habits
// nobody thought to imitate: the trailing period after the dollar amount, the
// em dash the prompt forbids, the JSON key ordering. Loosen a guard and this
// fails; tighten one past what the model really produces and this fails too.
//
// Fixtures are written by `npm run eval:llm -- --record`. They are committed on
// purpose — a fixture regenerated on demand tests nothing.

import { readdirSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import {
  gradeAdjudicatorDrafts,
  gradeProposalDrafts,
  gradeToolChoice,
  gradeVerdictNarration,
} from "../../scripts/eval-llm/graders"
import {
  ADJUDICATOR_CASES,
  PROPOSAL_CASES,
  TOOL_CHOICE_CASES,
  VERDICT_CASES,
} from "../../scripts/eval-llm/cases"

const FIXTURES = join(__dirname, "../../scripts/eval-llm/fixtures")

interface Fixture {
  raw?: string
  called?: string[]
  model: string
  pass: boolean
  failures: string[]
}

function load(feature: string): Map<string, Fixture> {
  const dir = join(FIXTURES, feature)
  if (!existsSync(dir)) return new Map()
  return new Map(
    readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(dir, f), "utf8"))]),
  )
}

const regrade = (
  feature: string,
  ids: string[],
  grader: (fx: Fixture, id: string) => { pass: boolean; failures: string[] },
) => {
  describe(feature, () => {
    const fixtures = load(feature)

    it("has a recorded response for every case in the golden set", () => {
      // Catches the quiet version of this going stale: a case added to
      // cases.ts, never run live, replaying green because nothing replays it.
      expect([...fixtures.keys()].sort()).toEqual([...ids].sort())
    })

    for (const id of ids) {
      it(`${id} — grades the same as when it was recorded`, () => {
        const fx = fixtures.get(id)
        expect(fx, `no fixture for ${id}; run npm run eval:llm -- --record`).toBeTruthy()
        const g = grader(fx!, id)
        expect(g.pass, `regrading changed this case: ${g.failures.join("; ")}`).toBe(fx!.pass)
        expect(g.failures).toEqual(fx!.failures)
      })
    }
  })
}

describe("replaying what the models actually said", () => {
  regrade("verdict", VERDICT_CASES.map((c) => c.id), (fx, id) => {
    const c = VERDICT_CASES.find((x) => x.id === id)!
    return gradeVerdictNarration(fx.raw ?? "", c.facts, c.expect)
  })

  regrade("proposal", PROPOSAL_CASES.map((c) => c.id), (fx, id) => {
    const c = PROPOSAL_CASES.find((x) => x.id === id)!
    return gradeProposalDrafts(fx.raw ?? "", c.expect)
  })

  regrade("adjudicator", ADJUDICATOR_CASES.map((c) => c.id), (fx, id) => {
    const c = ADJUDICATOR_CASES.find((x) => x.id === id)!
    return gradeAdjudicatorDrafts(fx.raw ?? "", c.cases, c.expect)
  })

  regrade("chat-tool-choice", TOOL_CHOICE_CASES.map((c) => c.id), (fx, id) => {
    const c = TOOL_CHOICE_CASES.find((x) => x.id === id)!
    return gradeToolChoice(fx.called ?? [], c.expectedTools)
  })

  // The negative half, and the reason it exists.
  //
  // Every case above passes. A suite of nothing but passing fixtures cannot
  // notice a guard getting *looser* — deleting the digit allowlist outright
  // left the replay green at 33/33, which is how this gap was found. These are
  // real completions, produced by appending an instruction that invites the
  // arithmetic the guard exists to stop, and each one must stay rejected.
  describe("verdict — completions the guard must keep rejecting", () => {
    const fixtures = load("verdict-adversarial")
    const facts = VERDICT_CASES[0].facts

    it("has a negative example at all", () => {
      expect(fixtures.size).toBeGreaterThan(0)
    })

    for (const [id, fx] of fixtures) {
      it(`${id} — ${(fx as Fixture & { nudge?: string }).nudge}`, () => {
        const g = gradeVerdictNarration(fx.raw ?? "", facts, VERDICT_CASES[0].expect)
        expect(
          g.pass,
          `this reached the masthead: ${JSON.stringify(fx.raw)}`,
        ).toBe(false)
      })
    }

    it("rejects most of them for an invented figure, not merely for being long", () => {
      // A length rejection would survive the allowlist being deleted, so a set
      // that only trips the character budget is the same blind spot in a
      // different costume.
      const byDigits = [...fixtures.values()].filter((fx) =>
        gradeVerdictNarration(fx.raw ?? "", facts, VERDICT_CASES[0].expect)
          .failures.some((f) => f.includes("never computed")),
      )
      expect(byDigits.length).toBeGreaterThanOrEqual(2)
    })
  })
})
