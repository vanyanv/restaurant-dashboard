# LLM golden set

The LLM layer was the only part of this product with no regression gate.

There are ~1560 unit tests around the three response parsers — `parseVerdictLine`,
`parseProposalDrafts`, `parseAdjudicatorDrafts`. Every one of them is fed a string a
human wrote, chosen because someone already suspected it mattered. None of them
had ever seen what a model actually emits. So a prompt edit that changed the
shape of the output, or that started tripping a guard on every call, went green
through the whole suite, and the only production symptom was a page quietly
rendering its deterministic fallback with a `logger.warn` nobody reads.

## Two gates, one of them free

**The free one runs on every push, inside `npm test`.**

- `tests/scripts/eval-llm-replay.test.ts` re-grades the committed fixtures —
  real completions from `gpt-4.1-mini`, `gpt-5.4-nano` and `gpt-5-mini` — through
  the current guards, and fails if any verdict moved.
- `tests/scripts/eval-llm-fingerprint.test.ts` hashes every rendered prompt
  together with the model it is sent to, and fails when either changes without
  the recorded scorecard being refreshed.

The fingerprint is what makes the whole thing hold together. Without it you could
edit a prompt, never re-run the live eval, and the committed scorecard would go on
describing a prompt that no longer exists.

It is taken over the **rendered** prompt, not the source file: hashing the file
would fire on a comment edit and stay silent when a constant reaches the model
through interpolation. `VERDICT_MAX_CHARS` is exactly that — a number in one
module and a sentence in the prompt.

**The paid one is `npm run eval:llm`.** ~29 cases, about $0.04 a pass. It answers
the one question no fixture can: does the *current* prompt still get the *current*
model to behave.

```
npm run eval:llm                          # everything
npm run eval:llm -- --feature verdict     # one feature
npm run eval:llm -- --case sales-last-week
npm run eval:llm -- --record              # refresh fixtures + fingerprints.json
npm run eval:llm -- --adversarial         # harvest completions the guard must reject
```

Exits non-zero when a feature falls below its floor in `DEFAULT_FLOORS`.

## What it grades

| feature | model | how it is graded |
|---|---|---|
| `verdict` | gpt-4.1-mini | the production guard `parseVerdictLine`, plus a required lead figure |
| `proposal` | gpt-4.1-mini | `parseProposalDrafts`, then kind + composition |
| `adjudicator` | gpt-5.4-nano | `parseAdjudicatorDrafts`, then per-case shortlist membership |
| `chat-tool-choice` | gpt-5-mini | which data tool the agent reached for, real schemas, stubbed `execute` |

Pass/fail is decided by the **production** parser wherever one exists. The graders
never re-implement a shipped rule — an eval that grades against its own copy stops
measuring the shipped one the first time they drift, and does it silently. What the
graders add is a readable reason: production only needs "reject", a report needs
"quoted $9,999, which the page never computed".

There is no LLM judge. Every one of these questions has a mechanical answer, and a
judge would only add a second model's opinion to grade the first model's.

## Why there are negative fixtures

`fixtures/verdict-adversarial/` holds real completions the guard must **reject**.

They exist because a suite of nothing but passing fixtures cannot notice a guard
getting *looser*. Measured, not assumed: deleting the digit allowlist from
`parseVerdictLine` outright left the replay suite green at 33/33. With the
negative set in place the same mutation fails six tests.

They are harvested by appending an instruction that invites the arithmetic the
guard exists to stop ("in that same single sentence, state the average revenue per
day"). The completions are genuine model output; only the nudge is synthetic, and
it is synthetic because a well-behaved prompt does not reliably produce the thing
we need to prove we can catch.

An earlier set of nudges asked for a *second line*, and the model complied there —
which the guard discards before the allowlist ever runs, so those fixtures proved
nothing about the check they were meant to exercise. The nudges now force the
invented figure into the first sentence.

## Everything here is frozen

No database, no clock, no `new Date()`. Not tidiness — a case whose input moves
cannot tell you whether a change in the score came from your prompt edit or from
Tuesday being slow. The chat system prompt is built from a fixed store list and a
fixed situation snapshot, via the same `composeSystemPrompt` the route uses.

## What it found on the first run

- **The verdict prompt quoted the guard's own 170-character limit**, so the model
  aimed at the limit and landed over it — 171 and 172 characters on two of eight
  cases, both silently rejected. `VERDICT_PROMPT_MAX_CHARS = 150` gives the
  overshoot somewhere to go. The guard did not move.
- **`gpt-5-mini` had no row in `PRICING_PER_MTOK`**, so every chat turn — the
  heaviest LLM call in the product — had been recording $0 in `AiUsageEvent` since
  the feature shipped. `tests/lib/ai-usage.test.ts` now fails on any shipped model
  constant without a rate.
- **Four of the first twelve tool-choice "failures" were the harness**, not the
  model: it filed a decline through `fileReturn` for the out-of-scope question and
  resolved a store name before pulling that store's numbers, and both counted as
  wrong. Orientation tools are excluded from routing now, and the step budget is 2.
- **One golden label was wrong.** "2 Slider Combo" was pinned to one Double Slider;
  the model returned two Single Sliders. The name is ambiguous and the label was
  the thing at fault. That case now grades the rule the prompt actually states —
  compose from recipes, don't flatten to ingredients — and a second case with an
  unambiguous name carries the exact-composition check.

## Reading the current scorecard honestly

Every feature is at 100%. That means the set has no discriminating power right
now: it can detect a regression, it cannot tell you the prompt got better. The
sample sizes are also small enough that run-to-run variance is real — the verdict
feature scored 88% and then 100% on the same eight cases with no code change
between them. Treat the floors as regression gates, not as quality measurements.
