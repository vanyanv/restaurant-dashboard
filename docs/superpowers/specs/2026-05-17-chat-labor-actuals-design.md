# Chat reads Harri actual labor (narrow fix)

**Date:** 2026-05-17
**Author:** Vardan + Claude
**Status:** Approved, ready for implementation plan

## Context

The chat assistant answered "labor is budgeted" to a real operator question even though `HarriDailyLabor.actualCost` has been syncing nightly since W10 (commit `3e50911`, ~early May 2026). The phrasing is not a hallucination — it is hardcoded in two places:

1. [src/lib/chat/system-prompt.ts:123](../../../src/lib/chat/system-prompt.ts#L123) — a rule that *instructs* the model to append "(labor is budgeted, not actual hours)" to every P&L answer that touches labor.
2. [src/lib/chat/tools/pnl.ts:525-529](../../../src/lib/chat/tools/pnl.ts#L525-L529) — an unconditional caveat appended to every `getPnlSummary` result whose total labor > 0: *"Labor figures are budgeted (fixed monthly amount pro-rated by days), not actual hours worked."*

Meanwhile, the underlying pure function [`computeStorePnL`](../../../src/lib/pnl.ts#L332) **already** accepts an optional `harriLaborByPeriod` parameter and **already** implements coverage-aware fallback at [pnl.ts:428-457](../../../src/lib/pnl.ts#L428-L457): it returns the row label `"Labor (actual)"` when ≥80% of days in the window have Harri data, `"Labor (partial)"` when some but <80%, and `"Labor (fixed)"` when none. The dashboard's P&L action [`pnl-actions.ts:267-293`](../../../src/app/actions/store/pnl-actions.ts#L267-L293) already fetches `HarriDailyLabor` and passes it in. **The chat tool is the only consumer that skips the fetch.**

Scope confirmed with user: narrow fix only — wire actuals into `getPnlSummary`, replace the hardcoded caveat with coverage-aware caveats, update the system prompt. Coverage strategy is "report actual + note coverage" (mix actuals with budgeted estimate for uncovered days, label with day counts). No new `getLaborActuals` tool. Growth Opportunities, Quality Panel, and lifecycle-aware answers are explicitly out of scope for this spec.

Intended outcome: when an operator asks the assistant "how much did we spend on labor at Hollywood last week?", the answer cites real clocked-hour cost with no "budgeted" disclaimer; when the window has partial Harri coverage, the answer is honest about how many days are actual vs. estimated.

## Recommended approach

Three files change. No new files except a test.

### 1. [src/lib/chat/tools/pnl.ts](../../../src/lib/chat/tools/pnl.ts) — fetch & pass actuals, rewrite caveat

Inside `computeWindow` ([pnl.ts:337-546](../../../src/lib/chat/tools/pnl.ts#L337)):

- Add a third query to the existing `Promise.all` ([pnl.ts:366-401](../../../src/lib/chat/tools/pnl.ts#L366-L401)):
  ```ts
  ctx.prisma.harriDailyLabor.findMany({
    where: {
      storeId: { in: storeIds },
      date: { gte: overallStart, lte: overallEnd },
      actualCost: { not: null },
    },
    select: { storeId: true, date: true, actualCost: true },
  }),
  ```
- Bucket by store into `harriByStore: Map<storeId, harriRows[]>`, then per store build `harriLaborByPeriod` exactly as in [pnl-actions.ts:275-285](../../../src/app/actions/store/pnl-actions.ts#L275-L285) (sum `actualCost`, count `coveredDays` per period).
- Pass `harriLaborByPeriod` as the 5th field into `computeStorePnL` at [pnl.ts:428-433](../../../src/lib/chat/tools/pnl.ts#L428-L433).
- Track per-store coverage `{ storeName, totalDays, coveredDays }` while looping over `stores`, for caveat generation.

Replace the unconditional caveat block at [pnl.ts:525-529](../../../src/lib/chat/tools/pnl.ts#L525-L529) with coverage-aware logic:

- **Bucket the per-store coverage results** into three groups:
  - `fullActual`: stores with `coveredDays / totalDays ≥ 0.8` → no caveat (row label `"Labor (actual)"` already carries it).
  - `partial`: stores with `0 < coveredDays / totalDays < 0.8` → emit `"Labor for {storeName}: actual for {coveredDays}/{totalDays} days, budgeted estimate for remainder."` per store.
  - `noActual`: stores with `coveredDays == 0` AND `fixedMonthlyLabor != null` → emit one combined caveat `"Labor for {storeA, storeB}: fixed-monthly budget pro-rated by days, not actuals (no Harri data in this window)."`
- Keep the existing `laborMissing` caveat ([pnl.ts:520-523](../../../src/lib/chat/tools/pnl.ts#L520-L523)) untouched — that's about missing `fixedMonthlyLabor` config, a different problem.

Update the tool description string at [pnl.ts:551](../../../src/lib/chat/tools/pnl.ts#L551):

- Drop the trailing sentence: *"Labor is a fixed monthly budget pro-rated by days, not actual hours."*
- Append: *"Labor uses Harri actuals when available with coverage-aware fallback to the fixed monthly budget; read the labor row's `label` ('Labor (actual)' / 'Labor (partial)' / 'Labor (fixed)') and any `caveats[]` entries to know which."*

### 2. [src/lib/chat/system-prompt.ts:123](../../../src/lib/chat/system-prompt.ts#L123) — rewrite the rule

Replace the current line:

> *"When a `getPnlSummary` result includes labor figures, note the labor caveat once: '(labor is budgeted, not actual hours)'. Always surface every entry from `caveats[]` the tool returns — they flag missing config or stale COGS that would otherwise mislead the answer."*

With:

> *"Labor figures come from Harri actuals when available. Read the labor row's `label` to know the source: `'Labor (actual)'` means real clocked hours (no caveat needed), `'Labor (partial)'` means a mix (cite the per-store coverage caveat verbatim from `caveats[]`), `'Labor (fixed)'` means budgeted estimate only (say so). Never claim 'budgeted' unless the label says fixed. Always surface every entry from `caveats[]` the tool returns — they flag missing config, stale COGS, or labor-source nuance."*

### 3. [tests/lib/chat-pnl-labor.test.ts](../../../tests/lib/chat-pnl-labor.test.ts) — new contract test

Vitest, mocked `ctx.prisma` (follow the pattern in existing `tests/lib/*.test.ts` like `otter-analytics-aggregation.test.ts`). Four cases:

1. **Full coverage, single store** — 30 days requested, 30 days of `actualCost` rows → assert labor row `label === "Labor (actual)"` and caveats contain no `"budgeted"` or `"actual for"` string.
2. **Partial coverage** — 30 days requested, 18 days of `actualCost` rows → assert label `=== "Labor (partial)"` and caveats contain `"actual for 18/30 days"`.
3. **Zero coverage, fixed budget configured** — 30 days requested, no `actualCost` rows, `store.fixedMonthlyLabor = 30000` → assert label `=== "Labor (fixed)"` and caveats contain `"no Harri data in this window"` naming the store.
4. **Multi-store mixed** — store A fully covered, store B has no Harri data → assert caveats contain store B by name but not store A; total labor figure equals A's actual + B's pro-rated fixed.

## Critical files to modify

- [src/lib/chat/tools/pnl.ts](../../../src/lib/chat/tools/pnl.ts) — the only chat-side P&L tool; `computeWindow` (line 337) and tool `description` (line 551).
- [src/lib/chat/system-prompt.ts](../../../src/lib/chat/system-prompt.ts) — line 123 rule.
- [tests/lib/chat-pnl-labor.test.ts](../../../tests/lib/) — new file.

## Existing functions/patterns reused (do not reinvent)

- [`computeStorePnL`](../../../src/lib/pnl.ts#L332) — already returns coverage-aware `"Labor (actual|partial|fixed)"` label. Do **not** add new label logic.
- [`HarriLaborByPeriod`](../../../src/lib/pnl.ts#L321) type — already exported. Reuse.
- [`pnl-actions.ts:267-293`](../../../src/app/actions/store/pnl-actions.ts#L267-L293) — exact query shape and per-period bucketing logic to copy. Do **not** create a shared helper unless a third call site lands; two callers ≠ premature abstraction.
- Test pattern in [tests/lib/](../../../tests/lib/) — vitest with `vi.mock` of Prisma, following the style of `otter-analytics-aggregation.test.ts`.

## Verification

1. `npm run test -- chat-pnl-labor` → all four cases pass.
2. `npm run dev`, sign in as `chris@chrisneddys.com`, open `/dashboard/chat`, ask: *"How much did we spend on labor at Hollywood last week?"* → response cites a real dollar number, **no** "budgeted, not actual" caveat, labor row label in the structured response = `"Labor (actual)"`.
3. Same dashboard, ask: *"What was labor at Hollywood for the last 30 days?"* — if Harri sync gap exists, response should mention "actual for X/30 days, budgeted for remainder" with real day counts.
4. Open `/dashboard/forecasts/labor` and confirm visible numbers match the chat answer for the same window (cross-check against the existing dashboard, which already uses `computeStorePnL` with the same Harri input).
5. (When GLN/VNYS exist) ask the chat about labor at a pre-open store — response should say "fixed-monthly budget … no Harri data in this window" naming that store.

## Out of scope (deferred)

- New dedicated `getLaborActuals` tool (user picked "pnl only").
- Growth Opportunities, Quality Panel, lifecycle-aware answers (user picked "narrow").
- Forward-looking labor in P&L (period extending into future) — `getLaborStaffingForecast` covers that path; this spec only changes historical P&L behavior.
- Variance ("actual vs budget" delta in same response) — operator can compute from existing fields if needed; would be a Phase 2 enhancement.
