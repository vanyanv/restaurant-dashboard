// Design principle #7 — "the LLM narrates; it never predicts" — is only worth
// the paper it's written on if something enforces it. `parseVerdictLine` is
// that something: it rebuilds its allowlist from the same fact block the prompt
// was built from, so a figure the page never computed cannot reach the masthead
// of the page. Everything the model returns is untrusted.

import { describe, it, expect } from "vitest"
import {
  VERDICT_MAX_CHARS,
  VERDICT_PROMPT_MAX_CHARS,
  buildVerdictPrompt,
  parseVerdictLine,
} from "@/lib/decision-verdict-llm"
import {
  composeVerdict,
  type VerdictFacts,
} from "@/app/dashboard/decisions/lib/verdict-copy"

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

describe("buildVerdictPrompt", () => {
  it("sends the formatted figures, not raw floats", () => {
    const p = buildVerdictPrompt(facts())
    expect(p).toContain("$9,240")
    expect(p).not.toContain("0.064")
  })

  it("forbids arithmetic in the instructions", () => {
    expect(buildVerdictPrompt(facts()).toLowerCase()).toContain("do not compute")
  })
})

describe("parseVerdictLine — shape", () => {
  it("accepts a clean sentence built from the given figures", () => {
    const out = parseVerdictLine("SAT is the biggest day at $9,240.", facts())
    expect(out).toBe("SAT is the biggest day at $9,240.")
  })

  it("strips surrounding quotes and stray markdown", () => {
    const out = parseVerdictLine('"**SAT carries $9,240.**"', facts())
    expect(out).toBe("SAT carries $9,240.")
  })

  it("collapses whitespace and keeps only the first line", () => {
    const out = parseVerdictLine("SAT   carries  $9,240.\n\nLet me know!", facts())
    expect(out).toBe("SAT carries $9,240.")
  })

  it("rejects an empty answer", () => {
    expect(parseVerdictLine("   ", facts())).toBeNull()
    expect(parseVerdictLine("", facts())).toBeNull()
  })

  it("rejects a line too long for the masthead", () => {
    const long = `SAT carries $9,240 ${"and then some more words ".repeat(20)}.`
    expect(long.length).toBeGreaterThan(VERDICT_MAX_CHARS)
    expect(parseVerdictLine(long, facts())).toBeNull()
  })

  it("rejects a refusal or a meta-answer", () => {
    expect(parseVerdictLine("I'm sorry, I can't help with that.", facts())).toBeNull()
    expect(parseVerdictLine("As an AI language model, I cannot.", facts())).toBeNull()
  })
})

describe("parseVerdictLine — the anti-hallucination guard", () => {
  it("rejects a dollar figure the page never computed", () => {
    // $12,500 appears nowhere in the fact block.
    expect(parseVerdictLine("SAT is tracking to $12,500.", facts())).toBeNull()
  })

  it("rejects an invented hour count", () => {
    expect(parseVerdictLine("You are 40 hours short on SAT.", facts())).toBeNull()
  })

  it("rejects a plausible-looking year", () => {
    expect(parseVerdictLine("Best week of 2026 at $56,000.", facts())).toBeNull()
  })

  it("accepts figures that are in the block, in any comma formatting", () => {
    expect(parseVerdictLine("The week runs $56000 with SAT at $9,240.", facts())).not.toBeNull()
  })

  it("accepts a sentence carrying no figures at all", () => {
    expect(parseVerdictLine("The schedule is thinner than the week deserves.", facts())).toBe(
      "The schedule is thinner than the week deserves.",
    )
  })

  it("rejects a number that was true last week but is absent today", () => {
    // 11 hours is in the block; 14 is not, however reasonable it looks.
    expect(parseVerdictLine("You are 14 hours short.", facts())).toBeNull()
    expect(parseVerdictLine("You are 11 hours short.", facts())).not.toBeNull()
  })

  // The fallback and the narration are held to one standard. If the composer's
  // own sentence could not survive the guard, the guard is wrong.
  it("accepts the deterministic composer's output for every branch", () => {
    for (const f of [
      facts(),
      facts({ laborStatus: "heavy", laborGapHours: 22, shortDays: 0 }),
      facts({ laborStatus: "level", laborGapHours: -3, shortDays: 0 }),
      facts({ laborStatus: "unknown", laborGapHours: null, unscheduledDays: 7 }),
      facts({ weekTotal: null, peakDay: null, topAction: null, potUsdPerWeek: 0 }),
    ]) {
      expect(parseVerdictLine(composeVerdict(f), f)).toBe(composeVerdict(f))
    }
  })
})

describe("the budget the prompt asks for, versus the budget the guard enforces", () => {
  // Found by the golden-set run, not by reasoning: with the prompt quoting the
  // guard's own 170-character limit, gpt-4.1-mini came back at 171 and 172 on
  // two of eight cases. Both were rejected and both pages silently rendered the
  // composed sentence instead. Nothing in production reports that — the only
  // trace is a logger.warn nobody reads.
  //
  // A model cannot count characters. Asking it for the exact limit therefore
  // puts the distribution's mean on the limit and roughly half its mass over
  // it. The prompt has to ask for less than the guard will accept.
  it("asks the model for a budget below the one it will be judged against", () => {
    expect(VERDICT_PROMPT_MAX_CHARS).toBeLessThan(VERDICT_MAX_CHARS)
  })

  it("leaves enough headroom to absorb a sentence the model misjudged", () => {
    // 1-2 characters was the observed overshoot when it was aiming at the
    // limit. That is the error when it is trying; the margin has to cover the
    // case where it is not.
    expect(VERDICT_MAX_CHARS - VERDICT_PROMPT_MAX_CHARS).toBeGreaterThanOrEqual(15)
  })

  it("quotes the asked-for budget in the prompt, not the enforced one", () => {
    const p = buildVerdictPrompt(facts())
    expect(p).toContain(`${VERDICT_PROMPT_MAX_CHARS} characters`)
    expect(p).not.toContain(`${VERDICT_MAX_CHARS} characters`)
  })

  it("still accepts a sentence between the two limits — the guard did not move", () => {
    // The point is headroom, not a tighter product. A good sentence at 165
    // characters must still reach the page.
    const f = facts()
    const long = `SAT is the week's biggest day at $9,240, and you are 11 hours short on the schedule across 2 days, with $2,140 a week sitting in actions you have not called.`
    expect(long.length).toBeGreaterThan(VERDICT_PROMPT_MAX_CHARS)
    expect(long.length).toBeLessThanOrEqual(VERDICT_MAX_CHARS)
    expect(parseVerdictLine(long, f)).toBe(long)
  })
})
