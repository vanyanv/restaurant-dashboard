// F11 — the LLM layer is the only part of this system with no regression gate.
//
// 1562 unit tests cover the *parsers*: `parseVerdictLine`, `parseProposalDrafts`,
// `parseAdjudicatorDrafts`. Every one of them is fed a string a human wrote.
// Not one of them has ever seen what the model actually emits. So a prompt edit
// that makes gpt-4.1-mini start returning a different shape — or start quoting
// a figure the guard rejects on every single call — passes the entire suite
// green, and the only symptom in production is a page quietly rendering its
// deterministic fallback forever.
//
// These are the graders for a frozen golden set that closes that hole. They are
// deliberately pure: input string in, verdict out, no network. That is what
// makes the harness itself testable, and it is why the recorded-fixture replay
// in the sibling test can run in CI with no API key and no spend.
//
// The grading rule that matters: for the narrated verdict, pass/fail is decided
// by calling the PRODUCTION guard, not by a reimplementation of it. An eval
// that grades against its own copy of the rule stops measuring the shipped one
// the first time they drift.

import { describe, it, expect, vi } from "vitest"

// The graders reach the production parsers, and two of those modules import
// recordAiUsage at the top level, which constructs a Prisma client. The graders
// themselves never touch a database; this keeps CI from needing DATABASE_URL to
// run a pure-function suite. Matches tests/lib/proposal-llm.test.ts.
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import {
  gradeToolChoice,
  gradeVerdictNarration,
  gradeProposalDrafts,
  gradeAdjudicatorDrafts,
  summarise,
  checkFloors,
  type GradedCase,
} from "../../scripts/eval-llm/graders"
import { composeVerdict, type VerdictFacts } from "@/app/dashboard/decisions/lib/verdict-copy"

const facts = (over: Partial<VerdictFacts> = {}): VerdictFacts => ({
  storeName: "Hollywood",
  isAggregate: false,
  weekTotal: 56000,
  weekP10: 49000,
  weekP90: 63000,
  peakDay: { weekdayShort: "SAT", predictedRevenue: 9240 },
  laborGapHours: -11,
  laborStatus: "short",
  shortDays: 2,
  unscheduledDays: 0,
  topAction: { title: "Reprice the Double Slider", impactUsdPerWeek: 640 },
  potUsdPerWeek: 2140,
  accuracyWape: 0.064,
  accuracySample: 26,
  topBriefing: null,
  ...over,
})

// --- tool choice ---------------------------------------------------------------

describe("gradeToolChoice", () => {
  it("passes when the model reached for one of the acceptable tools", () => {
    expect(gradeToolChoice(["getDailySales"], ["getDailySales"]).pass).toBe(true)
  })

  it("passes when any one of several acceptable tools was used", () => {
    expect(gradeToolChoice(["getDailySales"], ["compareSales", "getDailySales"]).pass).toBe(true)
  })

  it("passes when the model chained an extra tool alongside the expected one", () => {
    // Chaining is normal and often better. Only the absence of the right tool
    // is a regression.
    expect(gradeToolChoice(["listStores", "getDailySales"], ["getDailySales"]).pass).toBe(true)
  })

  it("fails, and names the tool it wanted, when the model answered from nothing", () => {
    const g = gradeToolChoice([], ["getDailySales"])
    expect(g.pass).toBe(false)
    expect(g.failures.join(" ")).toContain("getDailySales")
  })

  it("fails when the model queried something unrelated", () => {
    const g = gradeToolChoice(["getRefunds"], ["getDailySales"])
    expect(g.pass).toBe(false)
    expect(g.failures.join(" ")).toContain("getRefunds")
  })

  it("treats an empty expectation as 'must not call a tool at all'", () => {
    // The should-refuse cases: asked something outside the data, the model must
    // say so rather than fishing through the warehouse.
    expect(gradeToolChoice([], []).pass).toBe(true)
    expect(gradeToolChoice(["getDailySales"], []).pass).toBe(false)
  })
})

// --- narrated verdict ----------------------------------------------------------

describe("gradeVerdictNarration", () => {
  it("passes a sentence built only from the page's own figures", () => {
    const f = facts()
    const g = gradeVerdictNarration("SAT is the week's biggest day at $9,240.", f)
    expect(g.pass).toBe(true)
    expect(g.failures).toEqual([])
  })

  it("fails a sentence carrying a figure the page never computed", () => {
    const g = gradeVerdictNarration("SAT is the biggest day at $9,999.", facts())
    expect(g.pass).toBe(false)
  })

  it("says WHICH figure was invented, because a bare reject cannot be debugged", () => {
    // parseVerdictLine returns null and nothing else — correct for production,
    // useless in a report. The grader owes the reader the offending digits.
    const g = gradeVerdictNarration("SAT is the biggest day at $9,999.", facts())
    expect(g.failures.join(" ")).toContain("9999")
  })

  it("reports the length budget by name when the model runs long", () => {
    const g = gradeVerdictNarration("x".repeat(400), facts())
    expect(g.pass).toBe(false)
    expect(g.failures.join(" ").toLowerCase()).toContain("long")
  })

  it("reports a refusal distinctly from a hallucination", () => {
    const g = gradeVerdictNarration("I'm sorry, I can't help with that.", facts())
    expect(g.pass).toBe(false)
    expect(g.failures.join(" ").toLowerCase()).toContain("refus")
  })

  it("fails when the model buried the fact the case says it must lead with", () => {
    // Faithfulness is not the whole job. A sentence about forecast accuracy is
    // perfectly faithful and completely useless at the top of the page.
    const g = gradeVerdictNarration(
      "Forecast accuracy is 6.4% over 26 reconciled days.",
      facts(),
      { mustContain: ["$9,240"] },
    )
    expect(g.pass).toBe(false)
    expect(g.failures.join(" ")).toContain("$9,240")
  })

  it("accepts the required fact in any comma formatting the model chose", () => {
    const g = gradeVerdictNarration("SAT tops the week at $9,240.", facts(), {
      mustContain: ["$9,240"],
    })
    expect(g.pass).toBe(true)
  })

  it("grades through the production guard, not a copy of it", () => {
    // The composer's own output is by construction acceptable. If the grader
    // ever disagrees with the shipped guard, this is where it shows.
    const f = facts()
    expect(gradeVerdictNarration(composeVerdict(f), f).pass).toBe(true)
  })
})

// --- structured: recipe proposals ----------------------------------------------

const PROPOSAL_JSON = JSON.stringify({
  proposals: [
    {
      itemName: "2 Slider Combo",
      kind: "COMBO_DECOMPOSITION",
      suggestedName: "2 Slider Combo",
      suggestedCategory: "Combos",
      components: [
        { type: "recipe", name: "Double Slider", quantity: 2, unit: "each" },
        { type: "recipe", name: "Fries", quantity: 1, unit: "each" },
      ],
      reasoning: "Two sliders and a side.",
      confidence: 0.9,
    },
  ],
})

describe("gradeProposalDrafts", () => {
  it("passes when kind and composition both match", () => {
    const g = gradeProposalDrafts(PROPOSAL_JSON, [
      {
        itemName: "2 Slider Combo",
        kind: "COMBO_DECOMPOSITION",
        componentNames: ["Double Slider", "Fries"],
      },
    ])
    expect(g.pass).toBe(true)
  })

  it("ignores the order the model listed components in", () => {
    const g = gradeProposalDrafts(PROPOSAL_JSON, [
      { itemName: "2 Slider Combo", kind: "COMBO_DECOMPOSITION", componentNames: ["Fries", "Double Slider"] },
    ])
    expect(g.pass).toBe(true)
  })

  it("fails when the model flattened a combo into raw ingredients", () => {
    // The prompt's load-bearing rule. Flattening is exactly the seed-data bug
    // the compose-by-name instruction exists to prevent, and it is silent: the
    // JSON is well-formed and the parser accepts it.
    const flat = JSON.stringify({
      proposals: [
        {
          itemName: "2 Slider Combo",
          kind: "COMBO_DECOMPOSITION",
          components: [
            { type: "ingredient", name: "Beef Patty", quantity: 4, unit: "each" },
            { type: "ingredient", name: "Slider Bun", quantity: 4, unit: "each" },
          ],
          reasoning: "",
          confidence: 0.8,
        },
      ],
    })
    const g = gradeProposalDrafts(flat, [
      { itemName: "2 Slider Combo", kind: "COMBO_DECOMPOSITION", componentNames: ["Double Slider", "Fries"] },
    ])
    expect(g.pass).toBe(false)
    expect(g.failures.join(" ")).toContain("Double Slider")
  })

  it("fails when the model proposed the wrong kind", () => {
    const g = gradeProposalDrafts(PROPOSAL_JSON, [
      { itemName: "2 Slider Combo", kind: "MATCH", matchRecipeName: "Double Slider" },
    ])
    expect(g.pass).toBe(false)
    expect(g.failures.join(" ")).toContain("MATCH")
  })

  it("fails when an item the case asked about is missing entirely", () => {
    const g = gradeProposalDrafts(PROPOSAL_JSON, [
      { itemName: "2 Slider Combo", kind: "COMBO_DECOMPOSITION" },
      { itemName: "Cheese Fries", kind: "NEW_RECIPE" },
    ])
    expect(g.pass).toBe(false)
    expect(g.failures.join(" ")).toContain("Cheese Fries")
  })

  it("fails when the model invented a proposal for an item nobody asked about", () => {
    const g = gradeProposalDrafts(PROPOSAL_JSON, [])
    expect(g.pass).toBe(false)
    expect(g.failures.join(" ")).toContain("2 Slider Combo")
  })

  it("can require composition from recipes without pinning which recipes", () => {
    // "2 Slider Combo" taught this: the model composed it from two Single
    // Sliders where the label said one Double Slider, and the label was the
    // thing that was wrong — the name is genuinely ambiguous. Both answers obey
    // the rule the prompt actually states, which is compose from existing
    // recipes rather than flatten to raw ingredients. A grader that can only
    // express an exact bill of materials cannot express that rule, so it grades
    // the labeller's reading instead of the model's behaviour.
    const twoSingles = JSON.stringify({
      proposals: [
        {
          itemName: "2 Slider Combo",
          kind: "COMBO_DECOMPOSITION",
          components: [
            { type: "recipe", name: "Single Slider", quantity: 2, unit: "each" },
            { type: "recipe", name: "Fries", quantity: 1, unit: "each" },
          ],
          reasoning: "",
          confidence: 0.9,
        },
      ],
    })
    const g = gradeProposalDrafts(twoSingles, [
      { itemName: "2 Slider Combo", kind: "COMBO_DECOMPOSITION", allComponentsAreRecipes: true },
    ])
    expect(g.pass).toBe(true)
  })

  it("fails a flattened composition under the same expectation", () => {
    const flat = JSON.stringify({
      proposals: [
        {
          itemName: "2 Slider Combo",
          kind: "COMBO_DECOMPOSITION",
          components: [
            { type: "ingredient", name: "Beef Patty", quantity: 2, unit: "each" },
            { type: "recipe", name: "Fries", quantity: 1, unit: "each" },
          ],
          reasoning: "",
          confidence: 0.9,
        },
      ],
    })
    const g = gradeProposalDrafts(flat, [
      { itemName: "2 Slider Combo", kind: "COMBO_DECOMPOSITION", allComponentsAreRecipes: true },
    ])
    expect(g.pass).toBe(false)
    expect(g.failures.join(" ")).toContain("Beef Patty")
  })

  it("fails a combo with no components at all rather than vacuously passing", () => {
    const empty = JSON.stringify({
      proposals: [
        { itemName: "2 Slider Combo", kind: "COMBO_DECOMPOSITION", components: [], reasoning: "", confidence: 0.9 },
      ],
    })
    const g = gradeProposalDrafts(empty, [
      { itemName: "2 Slider Combo", kind: "COMBO_DECOMPOSITION", allComponentsAreRecipes: true },
    ])
    expect(g.pass).toBe(false)
  })

  it("fails on unparseable output rather than scoring it as a pass with no drafts", () => {
    const g = gradeProposalDrafts("Sure! Here are the proposals:", [
      { itemName: "2 Slider Combo", kind: "COMBO_DECOMPOSITION" },
    ])
    expect(g.pass).toBe(false)
  })
})

// --- structured: invoice-line adjudication -------------------------------------

const ADJ_CASES = [
  {
    caseId: "c1",
    productName: "TOMATO ROMA 25#",
    vendorName: "Sysco",
    unit: "case",
    candidates: [{ name: "Roma Tomato", score: 0.91 }, { name: "Tomato Paste", score: 0.62 }],
  },
  {
    caseId: "c2",
    productName: "GLOVE NITRILE LG",
    vendorName: "Sysco",
    unit: "case",
    candidates: [{ name: "Roma Tomato", score: 0.11 }],
  },
]

describe("gradeAdjudicatorDrafts", () => {
  it("passes when each case picked the expected candidate", () => {
    const raw = JSON.stringify({
      drafts: [
        { caseId: "c1", matchName: "Roma Tomato", confidence: 0.95, reasoning: "" },
        {
          caseId: "c2",
          matchName: null,
          confidence: 0.9,
          reasoning: "",
          newIngredient: { name: "Nitrile Glove", category: "Supplies", recipeUnit: "each" },
        },
      ],
    })
    const g = gradeAdjudicatorDrafts(raw, ADJ_CASES, [
      { caseId: "c1", matchName: "Roma Tomato" },
      { caseId: "c2", matchName: null },
    ])
    expect(g.pass).toBe(true)
  })

  it("fails when the model borrowed a candidate from a different case", () => {
    // The one rule the prompt states twice. Nothing downstream re-checks which
    // case a name came from, so this ships a wrong link at full confidence.
    const raw = JSON.stringify({
      drafts: [
        { caseId: "c1", matchName: "Roma Tomato", confidence: 0.95, reasoning: "" },
        { caseId: "c2", matchName: "Tomato Paste", confidence: 0.8, reasoning: "" },
      ],
    })
    const g = gradeAdjudicatorDrafts(raw, ADJ_CASES, [
      { caseId: "c1", matchName: "Roma Tomato" },
      { caseId: "c2", matchName: null },
    ])
    expect(g.pass).toBe(false)
    expect(g.failures.join(" ").toLowerCase()).toContain("shortlist")
  })

  it("fails when the model invented a name that is in no shortlist at all", () => {
    const raw = JSON.stringify({
      drafts: [{ caseId: "c1", matchName: "Vine Tomato", confidence: 0.95, reasoning: "" }],
    })
    const g = gradeAdjudicatorDrafts(raw, ADJ_CASES, [{ caseId: "c1", matchName: "Roma Tomato" }])
    expect(g.pass).toBe(false)
  })

  it("fails when a case the batch asked about came back with no draft", () => {
    const raw = JSON.stringify({
      drafts: [{ caseId: "c1", matchName: "Roma Tomato", confidence: 0.95, reasoning: "" }],
    })
    const g = gradeAdjudicatorDrafts(raw, ADJ_CASES, [
      { caseId: "c1", matchName: "Roma Tomato" },
      { caseId: "c2", matchName: null },
    ])
    expect(g.pass).toBe(false)
    expect(g.failures.join(" ")).toContain("c2")
  })

  it("fails a 'none of these' where the shortlist plainly held the answer", () => {
    const raw = JSON.stringify({
      drafts: [{ caseId: "c1", matchName: null, confidence: 0.9, reasoning: "" }],
    })
    const g = gradeAdjudicatorDrafts(raw, ADJ_CASES, [{ caseId: "c1", matchName: "Roma Tomato" }])
    expect(g.pass).toBe(false)
  })
})

// --- the scorecard -------------------------------------------------------------

const cases = (rows: [string, string, boolean][]): GradedCase[] =>
  rows.map(([feature, id, pass]) => ({
    feature,
    id,
    pass,
    failures: pass ? [] : ["nope"],
    costUsd: 0.001,
    durationMs: 100,
  }))

describe("summarise", () => {
  it("reports a pass rate per feature, not only overall", () => {
    const s = summarise(
      cases([
        ["verdict", "a", true],
        ["verdict", "b", true],
        ["proposal", "c", false],
      ]),
    )
    expect(s.passRate).toBeCloseTo(2 / 3)
    expect(s.byFeature.verdict.passRate).toBe(1)
    expect(s.byFeature.proposal.passRate).toBe(0)
  })

  it("totals the measured spend so a run can be judged against the budget", () => {
    const s = summarise(cases([["verdict", "a", true], ["verdict", "b", true]]))
    expect(s.costUsd).toBeCloseTo(0.002)
  })

  it("scores an empty run as zero rather than NaN", () => {
    expect(summarise([]).passRate).toBe(0)
  })
})

describe("checkFloors", () => {
  it("fails the feature that fell below its floor and passes the one that held", () => {
    const s = summarise(
      cases([
        ["verdict", "a", true],
        ["verdict", "b", false],
        ["proposal", "c", true],
      ]),
    )
    const checks = checkFloors(s, { verdict: 0.9, proposal: 0.75 })
    expect(checks.find((c) => c.feature === "verdict")!.ok).toBe(false)
    expect(checks.find((c) => c.feature === "proposal")!.ok).toBe(true)
  })

  it("treats a feature that produced no cases at all as a failure", () => {
    // A run that silently skipped a whole feature must not report green. This
    // is how an eval quietly stops testing something.
    const s = summarise(cases([["verdict", "a", true]]))
    const checks = checkFloors(s, { verdict: 0.9, proposal: 0.75 })
    expect(checks.find((c) => c.feature === "proposal")!.ok).toBe(false)
  })

  it("holds a floor exactly met", () => {
    const s = summarise(cases([["verdict", "a", true], ["verdict", "b", false]]))
    expect(checkFloors(s, { verdict: 0.5 })[0].ok).toBe(true)
  })
})
