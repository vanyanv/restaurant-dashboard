// The tripwire that makes the paid gate honest.
//
// The golden-set run costs money and needs an API key, so it cannot sit in
// `npm test` on every push. That leaves an obvious hole: someone edits a prompt,
// never re-runs the eval, and the recorded scorecard silently describes a
// prompt that no longer exists.
//
// This closes it for free. Each prompt is fingerprinted by rendering it from a
// frozen input and hashing the result together with the model it is sent to.
// The hash is committed next to the scorecard. Edit a prompt — or swap the
// model — and this fails on the next `npm test` with instructions to re-run the
// eval and commit the new number.
//
// Rendered, not read off disk: hashing the source file would fire on a comment
// edit and stay quiet on a constant change that reaches the model through
// interpolation. VERDICT_MAX_CHARS is exactly that case — it is a number in one
// file and an instruction in the prompt.

import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import {
  FINGERPRINTED_FEATURES,
  promptFingerprints,
  recordedFingerprints,
} from "../../scripts/eval-llm/fingerprint"

describe("prompt fingerprints", () => {
  it("covers every feature the golden set grades", () => {
    expect(Object.keys(promptFingerprints()).sort()).toEqual([...FINGERPRINTED_FEATURES].sort())
  })

  it("is stable across calls — the canonical inputs carry no clock or randomness", () => {
    expect(promptFingerprints()).toEqual(promptFingerprints())
  })

  it("gives different prompts different fingerprints", () => {
    const f = promptFingerprints()
    expect(new Set(Object.values(f)).size).toBe(Object.keys(f).length)
  })

  it("matches what was recorded the last time the golden set was actually run", () => {
    const current = promptFingerprints()
    const recorded = recordedFingerprints()

    for (const feature of FINGERPRINTED_FEATURES) {
      expect(
        current[feature],
        `The "${feature}" prompt (or its model) has changed since the golden set ` +
          `was last run, so the recorded scorecard no longer describes what ships. ` +
          `Re-run \`npm run eval:llm -- --feature ${feature}\` and commit the ` +
          `updated scripts/eval-llm/fingerprints.json.`,
      ).toBe(recorded[feature]?.sha256)
    }
  })

  it("carries the evidence, not just the hash — a scorecard with no numbers is a rubber stamp", () => {
    const recorded = recordedFingerprints()
    for (const feature of FINGERPRINTED_FEATURES) {
      const r = recorded[feature]
      expect(r, `no record for ${feature}`).toBeTruthy()
      expect(r.cases).toBeGreaterThan(0)
      expect(r.passRate).toBeGreaterThanOrEqual(0)
      expect(r.evaluatedAt).toMatch(/^\d{4}-\d{2}-\d{2}/)
      expect(r.model.length).toBeGreaterThan(0)
    }
  })
})
