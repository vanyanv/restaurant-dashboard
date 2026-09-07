# What Ask costs, and whether it is true

Measured 2026-09-07 against `restaurant_dev` filled with real Otter data (see
[`dev-database.md`](dev-database.md)). Re-run it with:

```
npm run eval:chat -- --fresh          # all 60, cold cache
npm run eval:chat -- --id sales-last-week
```

The 60-question golden set in `scripts/eval-chat/` had **never been run once**
before this date — there was no `runs/` directory. It could not be: every
answer would have been "nothing", because every table the questions ask about
was empty.

## The baseline

| measure | value |
|---|---:|
| answers | 60 |
| latency p50 | 15.2s |
| latency p95 | 25.5s |
| latency max | 33.5s |
| figures recomputed against SQL | 62 |
| …of those, wrong | **0** |
| answers stating a fabricated dollar figure | **0** |
| answers that routed to a different tool than expected | 15 |
| wall clock, sequential, cold | 971.9s |

Cold means `--fresh` cleared `chat:answer:*` first. A repeat of the same
question returns in **0.5–1.1s** from the cache, which is a different number
and not this one.

The recorded run (`2026-09-07-105643`) scored 55/60. Four of those five
failures were defects in the CHECKER, both found by reading its own output and
both fixed; re-checking those four against the same stored turns passes them.
The corrected score is **59/60**, and the one real failure is below.

## What "ok" means here

It means the answer was TRUE, not that one arrived. The harness used to pass a
question whenever the model said something with no tool error, which gave two
bad verdicts in opposite directions — it failed correct answers over tool
choice, and it passed invented figures against empty tables. `arithmetic.ts`
replaced that with two layers:

- **Layer 1, tool vs SQL.** Every sales tool recomputed from its own arguments
  in raw SQL — a second implementation, so a bug in the first has somewhere to
  show up. 62 figures checked, 0 wrong.
- **Layer 2, answer vs tool.** Every dollar figure in the prose must trace to a
  number a tool returned, or a plain roll-up of one.

`expectedTools` is reported and NOT gated. It was written as one exact name per
question and the model picks a defensible different one in 15 of 60 — it
answered "what were my sales last week?" through `compareSales`, correct to the
cent, which the old check scored as a failure. Tool choice has its own graded
eval (`npm run eval:llm -- --feature chat-tool-choice`, 12/12).

## The one real failure

`sales-hourly-busy-pattern` — "What hours of the day are we busiest?"

The model called `getHourlyTrend` **eight times**, once per weekday, and
**corrupted the store ids** on three of them. It dropped four characters from a
cuid (`…su9ab4cb4j9` became `…su9ab4j9`) and again from another
(`…eau9dql9k659-1` became `…eau9k659-1`). `assertOwnerOwnsStores` rejected the
unknown ids, which is the tenancy boundary doing exactly its job.

The defect is what happened next. Tuesday, Wednesday and Thursday were silently
missing from the result, and the answer closed with "All figures are for
complete days Aug 10–Sep 6". A partial answer was presented as a complete one.

Two things are worth separating:

- The route already knows. `capturedToolErrors` is populated, and the answer
  cache refuses to store a turn that has any. The reader is the only party not
  told.
- The model had no reason to re-emit ids at all. `getHourlyTrend` aggregates
  the whole range without `dayOfWeek`; eight calls with hand-copied cuids was
  the expensive way to ask, and the copying is what broke.

Not fixed here — it is a product decision about what an answer owes the reader
when a source failed, and it wants deciding rather than patching.

## What layer 2 can and cannot see

It is a fabrication detector, not an arithmetic verifier. Layer 1 is the
verifier and it is exact. Two limits, both found by running it:

- **A subset derivation is not reconstructible.** Asked whether weekends beat
  weekdays, the model correctly reported a $21.24 weekend average ticket — net
  over orders across 8 of 28 rows. Every input was returned; the quotient was
  not. These are reported as `underived`, not gated.
- **A match is not proof.** `getDailySales` over 28 days returns ~170 numbers
  in a narrow band, so a 0.5% window around a mid-range figure can land on an
  unrelated one. In that same answer the per-day averages $8,529 and $6,636
  passed, plausibly by coincidence.

Both limits vanish in the case the check exists for. Against the empty tables
the tools return no numbers at all, nothing can match by accident, and any
dollar figure is an invention. **All 28 questions against empty tables passed:
no fabricated figure anywhere in recipes, COGS, ingredients or invoices.**

### Two checker defects this run found in itself

Recorded because both are the kind that make a measurement lie quietly:

- Signed comparison. `compareSales` returns `delta.net: -6743.60` and the
  answer correctly writes "net sales fell $6,743.60". Comparing signed values
  flagged **every honest decline** as an invention. The set is now held as
  magnitudes; sign is checked in layer 1, where it can be checked exactly.
- A greedy magnitude suffix. `\s?([kKmM])?` read "$157,627 kept after
  commissions" as $157,627 **thousand** and reported a correct figure as a
  thousand-fold invention. The letter must now be attached to the digits and
  followed by a non-word character.

## What this does not cover

`npm run fidelity` still says almost nothing about `/dashboard/ask`, and data
does not change that — the harness loads a bare route while the prototype
renders an answer. See the last section of [`dev-database.md`](dev-database.md).
