# Chat reads Harri actual labor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the chat assistant from saying "labor is budgeted" when `HarriDailyLabor.actualCost` is available. Wire Harri actuals into `getPnlSummary` with coverage-aware caveats, and update the system prompt so the model reports the right source.

**Architecture:** The pure function `computeStorePnL` ([src/lib/pnl.ts:332](../../../src/lib/pnl.ts#L332)) already handles coverage-aware fallback (`"Labor (actual)"` ≥80% covered, `"Labor (partial)"` some, `"Labor (fixed)"` none). The dashboard P&L action ([src/app/actions/store/pnl-actions.ts:267-293](../../../src/app/actions/store/pnl-actions.ts#L267-L293)) already fetches `HarriDailyLabor` and passes it in. The chat tool is the only consumer that skips the fetch. We copy that exact fetch/bucket pattern into `computeWindow` in [src/lib/chat/tools/pnl.ts:337](../../../src/lib/chat/tools/pnl.ts#L337), replace the unconditional "budgeted" caveat with a coverage-aware one (extracted as a tiny pure helper so we can unit-test it), and rewrite the system-prompt rule that hardcoded the wrong disclaimer.

**Tech Stack:** TypeScript, Next.js 15, Prisma, vitest (config: [vitest.config.ts](../../../vitest.config.ts), tests live in [tests/lib/](../../../tests/lib/)).

**Spec:** [docs/superpowers/specs/2026-05-17-chat-labor-actuals-design.md](../specs/2026-05-17-chat-labor-actuals-design.md)

---

## File map

- **Modify** [src/lib/chat/tools/pnl.ts](../../../src/lib/chat/tools/pnl.ts)
  - Add `harriDailyLabor.findMany` query to the existing `Promise.all` (around line 366-401).
  - Bucket Harri rows per store; build `harriLaborByPeriod` per store; pass to `computeStorePnL`.
  - Track per-store coverage `{ storeName, totalDays, coveredDays }`.
  - Extract new pure helper `buildLaborCaveats(coverage[])` returning `string[]`.
  - Replace the unconditional caveat block at line 525-529 with `buildLaborCaveats(coverageByStore)`.
  - Rewrite the tool `description` string at line 551.
- **Modify** [src/lib/chat/system-prompt.ts](../../../src/lib/chat/system-prompt.ts) line 123 — rewrite the rule.
- **Create** [tests/lib/chat-pnl-labor.test.ts](../../../tests/lib/) — vitest tests for `buildLaborCaveats`.

No new files except the test. No new abstractions beyond `buildLaborCaveats` (the only piece worth unit-testing in isolation).

---

## Task 1: Extract `buildLaborCaveats` pure helper + tests

**Files:**
- Modify: [src/lib/chat/tools/pnl.ts](../../../src/lib/chat/tools/pnl.ts) — add helper before `computeWindow` (around line 335).
- Create: [tests/lib/chat-pnl-labor.test.ts](../../../tests/lib/)

The helper takes per-store coverage and returns the caveat strings. Pure function, no I/O, easy to test.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/chat-pnl-labor.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { buildLaborCaveats, type LaborCoverage } from "@/lib/chat/tools/pnl"

const cov = (overrides: Partial<LaborCoverage>): LaborCoverage => ({
  storeName: "Hollywood",
  totalDays: 30,
  coveredDays: 0,
  hasFixedMonthlyLabor: true,
  ...overrides,
})

describe("buildLaborCaveats", () => {
  it("returns no caveat when single store is fully covered", () => {
    expect(buildLaborCaveats([cov({ coveredDays: 30 })])).toEqual([])
  })

  it("returns no caveat when coverage >= 80%", () => {
    // 80% of 30 = 24
    expect(buildLaborCaveats([cov({ coveredDays: 24 })])).toEqual([])
  })

  it("emits per-store partial caveat when 0 < coverage < 80%", () => {
    const caveats = buildLaborCaveats([cov({ coveredDays: 18 })])
    expect(caveats).toHaveLength(1)
    expect(caveats[0]).toBe(
      "Labor for Hollywood: actual for 18/30 days, budgeted estimate for remainder.",
    )
  })

  it("emits combined no-actual caveat when coverage == 0 and fixed budget configured", () => {
    const caveats = buildLaborCaveats([cov({ coveredDays: 0 })])
    expect(caveats).toHaveLength(1)
    expect(caveats[0]).toBe(
      "Labor for Hollywood: fixed-monthly budget pro-rated by days, not actuals (no Harri data in this window).",
    )
  })

  it("combines multiple no-actual stores into one caveat", () => {
    const caveats = buildLaborCaveats([
      cov({ storeName: "GLN", coveredDays: 0 }),
      cov({ storeName: "VNYS", coveredDays: 0 }),
    ])
    expect(caveats).toHaveLength(1)
    expect(caveats[0]).toBe(
      "Labor for GLN, VNYS: fixed-monthly budget pro-rated by days, not actuals (no Harri data in this window).",
    )
  })

  it("multi-store mixed: only mentions stores that need a caveat", () => {
    // A fully covered, B partial, C no actuals
    const caveats = buildLaborCaveats([
      cov({ storeName: "Hollywood", coveredDays: 30 }),
      cov({ storeName: "GLN", coveredDays: 10 }),
      cov({ storeName: "VNYS", coveredDays: 0 }),
    ])
    expect(caveats).toHaveLength(2)
    expect(caveats).toContain(
      "Labor for GLN: actual for 10/30 days, budgeted estimate for remainder.",
    )
    expect(caveats).toContain(
      "Labor for VNYS: fixed-monthly budget pro-rated by days, not actuals (no Harri data in this window).",
    )
    // Hollywood (fully covered) is not mentioned.
    for (const c of caveats) expect(c).not.toContain("Hollywood")
  })

  it("skips no-actual stores that have no fixed budget configured (handled by existing laborMissing caveat)", () => {
    const caveats = buildLaborCaveats([
      cov({ storeName: "GLN", coveredDays: 0, hasFixedMonthlyLabor: false }),
    ])
    expect(caveats).toEqual([])
  })

  it("treats totalDays==0 as not-needing-caveat (defensive)", () => {
    expect(buildLaborCaveats([cov({ totalDays: 0, coveredDays: 0 })])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/lib/chat-pnl-labor.test.ts`
Expected: FAIL with `buildLaborCaveats` / `LaborCoverage` is not exported from `@/lib/chat/tools/pnl`.

- [ ] **Step 3: Implement the helper**

In [src/lib/chat/tools/pnl.ts](../../../src/lib/chat/tools/pnl.ts), insert above the `computeWindow` function (currently at line 337), and export both:

```ts
/** Per-store labor coverage summary used to write caveats. */
export interface LaborCoverage {
  storeName: string
  /** Total days in the requested window for this store. */
  totalDays: number
  /** Number of days that had a HarriDailyLabor row with actualCost. */
  coveredDays: number
  /** Whether the store has a fixedMonthlyLabor configured. Stores with no
   *  fixed-budget config are flagged by the separate `laborMissing` caveat
   *  and should NOT be mentioned in the no-actuals caveat. */
  hasFixedMonthlyLabor: boolean
}

/** Build per-store labor caveats based on Harri coverage.
 *
 *  - Stores with coverage >= 80%: no caveat (the row label "Labor (actual)"
 *    carries the meaning).
 *  - Stores with 0 < coverage < 80%: emit a per-store partial caveat.
 *  - Stores with coverage == 0 AND a fixed budget configured: combined into
 *    one caveat naming all the affected stores.
 *  - Stores with no fixed budget configured: skipped (already flagged by the
 *    existing `laborMissing` caveat path in computeWindow).
 */
export function buildLaborCaveats(coverage: LaborCoverage[]): string[] {
  const caveats: string[] = []
  const noActualStores: string[] = []
  for (const c of coverage) {
    if (c.totalDays <= 0) continue
    const pct = c.coveredDays / c.totalDays
    if (pct >= 0.8) continue
    if (c.coveredDays === 0) {
      if (c.hasFixedMonthlyLabor) noActualStores.push(c.storeName)
      continue
    }
    caveats.push(
      `Labor for ${c.storeName}: actual for ${c.coveredDays}/${c.totalDays} days, budgeted estimate for remainder.`,
    )
  }
  if (noActualStores.length > 0) {
    caveats.push(
      `Labor for ${noActualStores.join(", ")}: fixed-monthly budget pro-rated by days, not actuals (no Harri data in this window).`,
    )
  }
  return caveats
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/lib/chat-pnl-labor.test.ts`
Expected: all 8 cases PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/lib/chat-pnl-labor.test.ts src/lib/chat/tools/pnl.ts
git commit -m "chat(pnl): add buildLaborCaveats helper + tests"
```

---

## Task 2: Fetch Harri actuals in `computeWindow` and pass to `computeStorePnL`

**Files:**
- Modify: [src/lib/chat/tools/pnl.ts:337-546](../../../src/lib/chat/tools/pnl.ts#L337-L546) — `computeWindow` function body.

Mirror the pattern at [src/app/actions/store/pnl-actions.ts:267-293](../../../src/app/actions/store/pnl-actions.ts#L267-L293). No new test — this is plumbing; correctness of the downstream label/caveats is covered by Task 1's tests + manual verification in Task 5.

- [ ] **Step 1: Add the Harri query to the existing `Promise.all`**

Inside `computeWindow`, the current `Promise.all` ([pnl.ts:366-401](../../../src/lib/chat/tools/pnl.ts#L366-L401)) destructures into `[summaries, cogsRows]`. Extend it to `[summaries, cogsRows, harriRows]`:

```ts
const [summaries, cogsRows, harriRows] = await Promise.all([
  ctx.prisma.otterDailySummary.findMany({
    where: {
      storeId: { in: storeIds },
      date: { gte: overallStart, lte: overallEnd },
    },
    select: {
      storeId: true,
      date: true,
      platform: true,
      paymentMethod: true,
      fpGrossSales: true,
      tpGrossSales: true,
      fpTaxCollected: true,
      tpTaxCollected: true,
      fpDiscounts: true,
      tpDiscounts: true,
      fpServiceCharges: true,
      tpServiceCharges: true,
      fpOrderCount: true,
      tpOrderCount: true,
    },
  }),
  ctx.prisma.dailyCogsItem.findMany({
    where: {
      storeId: { in: storeIds },
      date: { gte: overallStart, lte: overallEnd },
    },
    select: {
      storeId: true,
      date: true,
      lineCost: true,
      status: true,
    },
  }),
  ctx.prisma.harriDailyLabor.findMany({
    where: {
      storeId: { in: storeIds },
      date: { gte: overallStart, lte: overallEnd },
      actualCost: { not: null },
    },
    select: { storeId: true, date: true, actualCost: true },
  }),
])
```

- [ ] **Step 2: Bucket Harri rows by store**

Immediately after the existing `summariesByStore` / `cogsByStore` map-building loops ([pnl.ts:403-414](../../../src/lib/chat/tools/pnl.ts#L403-L414)), add a third map:

```ts
const harriByStore = new Map<string, { date: Date; actualCost: number | null }[]>()
for (const r of harriRows as { storeId: string; date: Date; actualCost: number | null }[]) {
  const arr = harriByStore.get(r.storeId) ?? []
  arr.push({ date: r.date, actualCost: r.actualCost })
  harriByStore.set(r.storeId, arr)
}
```

- [ ] **Step 3: Track per-store coverage and pass `harriLaborByPeriod` to `computeStorePnL`**

The per-store loop is at [pnl.ts:420-480](../../../src/lib/chat/tools/pnl.ts#L420-L480). Add a coverage list above the loop and per-store bucketing inside:

```ts
const laborCoverage: LaborCoverage[] = []

for (const store of stores) {
  const storeSummaries = summariesByStore.get(store.id) ?? []
  const storeCogs = cogsByStore.get(store.id) ?? []
  const bucketed = bucketSummariesByPeriod(storeSummaries, periods)
  const { cogsValues, rowCountPerPeriod } = bucketCogs(storeCogs, periods)
  const orderCounts = bucketOrderCount(storeSummaries, periods)
  const orderCount = sum(orderCounts)

  // Build per-period Harri labor actuals for this store.
  const storeHarri = harriByStore.get(store.id) ?? []
  const harriLaborByPeriod = periods.map((p) => {
    let actualUsd = 0
    let coveredDays = 0
    for (const r of storeHarri) {
      if (r.date >= p.startDate && r.date <= p.endDate && r.actualCost != null) {
        actualUsd += r.actualCost
        coveredDays += 1
      }
    }
    return { actualUsd, coveredDays }
  })

  const totalDays = periods.reduce((a, p) => a + p.days, 0)
  const totalCovered = harriLaborByPeriod.reduce((a, h) => a + h.coveredDays, 0)
  laborCoverage.push({
    storeName: store.name,
    totalDays,
    coveredDays: totalCovered,
    hasFixedMonthlyLabor: store.fixedMonthlyLabor != null,
  })

  const computed = computeStorePnL({
    bucketed,
    periods,
    store,
    cogsValues,
    harriLaborByPeriod,
  })

  // ... rest of loop body unchanged (refill-gap detection, etc.) ...
}
```

(Keep the rest of the loop body — `refillCaveats`, `laborMissing` push, `fixedCostsTotal`, channel mix, `perStore.push` — exactly as it is.)

- [ ] **Step 4: Replace the unconditional caveat block with `buildLaborCaveats`**

Current code at [pnl.ts:519-534](../../../src/lib/chat/tools/pnl.ts#L519-L534):

```ts
const caveats: string[] = []
if (laborMissing.length > 0) {
  caveats.push(
    `Labor not configured for: ${laborMissing.join(", ")} — labor totals exclude these stores.`,
  )
}
if (totals.laborDollars > 0) {
  caveats.push(
    "Labor figures are budgeted (fixed monthly amount pro-rated by days), not actual hours worked.",
  )
}
if (refillCaveats.size > 0) { ... }
```

Replace with:

```ts
const caveats: string[] = []
if (laborMissing.length > 0) {
  caveats.push(
    `Labor not configured for: ${laborMissing.join(", ")} — labor totals exclude these stores.`,
  )
}
// Coverage-aware labor caveats (replaces the old unconditional "budgeted" caveat).
caveats.push(...buildLaborCaveats(laborCoverage))
if (refillCaveats.size > 0) {
  const sample = Array.from(refillCaveats).slice(0, 3).join("; ")
  const more = refillCaveats.size > 3 ? ` (+${refillCaveats.size - 3} more)` : ""
  caveats.push(`COGS not yet refilled for: ${sample}${more}.`)
}
```

(The `refillCaveats` block stays unchanged — just shown here for context so the engineer doesn't accidentally drop it.)

- [ ] **Step 5: Run the test suite to verify no regressions**

Run: `npm run test`
Expected: PASS (Task 1's 8 cases plus all existing tests; nothing new should break).

- [ ] **Step 6: Type-check the change**

Run: `npx tsc --noEmit`
Expected: no errors. If `harriRows` type inference fails, it's likely the `as` cast on the bucketing step — adjust the inline type annotation.

- [ ] **Step 7: Commit**

```bash
git add src/lib/chat/tools/pnl.ts
git commit -m "chat(pnl): fetch HarriDailyLabor.actualCost and pass to computeStorePnL with per-store coverage caveats"
```

---

## Task 3: Update tool description string

**Files:**
- Modify: [src/lib/chat/tools/pnl.ts:551](../../../src/lib/chat/tools/pnl.ts#L551)

- [ ] **Step 1: Rewrite the description**

Current:
> "Full P&L for an owner-scoped slice of stores and a date range. ... The totals block returns positive magnitudes for cost fields. **Labor is a fixed monthly budget pro-rated by days, not actual hours.**"

Replace the bolded trailing sentence with:

> "Labor uses Harri actuals when available with coverage-aware fallback to the fixed monthly budget; read the labor row's `label` ('Labor (actual)' / 'Labor (partial)' / 'Labor (fixed)') and any `caveats[]` entries to know which."

The full new description string for line 551:

```ts
description:
  "Full P&L for an owner-scoped slice of stores and a date range. Returns the complete row matrix (every GL sales line, commissions, COGS, gross profit, labor, rent, cleaning, towels, bottom line) plus pre-rolled totals (cogsPct, laborPct, marginPct, breakEvenSales, avgTicket, cashSales/cardSales, vsTargetPp), perStore breakdown, channelMix, and an optional comparePrevious window. ONE call answers most P&L questions — pick the right field/row from the result, do not call again per line item. Sign convention: in rows[].values[], sales are positive; commissions/COGS/labor/rent/cleaning/towels are negative. The totals block returns positive magnitudes for cost fields. Labor uses Harri actuals when available with coverage-aware fallback to the fixed monthly budget; read the labor row's `label` ('Labor (actual)' / 'Labor (partial)' / 'Labor (fixed)') and any `caveats[]` entries to know which.",
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/chat/tools/pnl.ts
git commit -m "chat(pnl): update tool description to reflect Harri actuals"
```

---

## Task 4: Rewrite the system-prompt rule

**Files:**
- Modify: [src/lib/chat/system-prompt.ts:123](../../../src/lib/chat/system-prompt.ts#L123)

- [ ] **Step 1: Replace the labor-caveat rule**

Current line 123:

```ts
When a `getPnlSummary` result includes labor figures, note the labor caveat once: "(labor is budgeted, not actual hours)". Always surface every entry from `caveats[]` the tool returns — they flag missing config or stale COGS that would otherwise mislead the answer.
```

Replace with:

```ts
Labor figures come from Harri actuals when available. Read the labor row's `label` to know the source: `'Labor (actual)'` means real clocked hours (no caveat needed), `'Labor (partial)'` means a mix (cite the per-store coverage caveat verbatim from `caveats[]`), `'Labor (fixed)'` means budgeted estimate only (say so). Never claim "budgeted" unless the label says fixed. Always surface every entry from `caveats[]` the tool returns — they flag missing config, stale COGS, or labor-source nuance.
```

(Note: the surrounding lines 121-122 and 124+ stay unchanged. Only the single paragraph at line 123 is rewritten.)

- [ ] **Step 2: Commit**

```bash
git add src/lib/chat/system-prompt.ts
git commit -m "chat(prompt): teach the model to read labor row label instead of always saying 'budgeted'"
```

---

## Task 5: End-to-end verification

No code changes. Run the verification checklist from the spec.

- [ ] **Step 1: Test suite green**

Run: `npm run test`
Expected: all tests pass, including the 8 `buildLaborCaveats` cases.

- [ ] **Step 2: Type-check the full codebase**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Build succeeds**

Run: `npm run build`
Expected: build completes without errors. (Catches any Next.js / RSC-boundary surprises.)

- [ ] **Step 4: Manual smoke — labor (actual) path**

Run: `npm run dev`. Sign in as `chris@chrisneddys.com`. Open `/dashboard/chat`. Ask: *"How much did we spend on labor at Hollywood last week?"*

Expected:
- Response cites a real dollar number.
- **No** "budgeted, not actual" disclaimer in the reply.
- If you inspect the structured tool result (e.g. via the chat-eval harness `npm run eval:chat` or the network tab), the labor row's `label` is `"Labor (actual)"` and `caveats[]` does not contain any "Labor for Hollywood:" entry.

- [ ] **Step 5: Manual smoke — labor (partial) path**

Same dev server. Ask: *"What was labor at Hollywood for the last 30 days?"*

Expected:
- If Harri sync is up to date through today, this also shows `"Labor (actual)"` (≥80% covered).
- If there is a sync gap (e.g. Harri last synced 3 days ago in a 30-day window), the response should mention "actual for X/30 days, budgeted estimate for remainder" with a real day count.

(If you cannot reproduce a partial state organically, temporarily ask about a wider window like "last 90 days" — Harri history typically starts later than Otter history, so the early portion of the window should be uncovered.)

- [ ] **Step 6: Manual smoke — labor (fixed) path**

Pre-open stores (GLN, VNYS) have no Harri data yet. Ask: *"What's our labor at GLN right now?"* (or any window that pre-dates Harri sync entirely).

Expected:
- Response says labor is the fixed-monthly budget pro-rated by days.
- `caveats[]` contains: `"Labor for GLN: fixed-monthly budget pro-rated by days, not actuals (no Harri data in this window)."`

- [ ] **Step 7: Cross-check against the dashboard P&L**

Open `/dashboard/forecasts/labor` (or whichever store P&L page surfaces Harri labor — see [pnl-actions.ts:287-293](../../../src/app/actions/store/pnl-actions.ts#L287-L293)). Compare the labor total to the chat answer for the same store + window.

Expected: numbers match to the cent. (Both paths now feed `computeStorePnL` with identical `harriLaborByPeriod`.)

- [ ] **Step 8: Final commit (if any cleanup needed)**

If verification surfaced anything (e.g. a follow-up tweak), commit it. Otherwise: nothing to do.

---

## Self-review checklist

**1. Spec coverage:**
- ✅ Fetch HarriDailyLabor in chat's `getPnlSummary` → Task 2 Step 1.
- ✅ Pass `harriLaborByPeriod` to `computeStorePnL` → Task 2 Step 3.
- ✅ Coverage-aware caveat (per-store, three buckets) → Task 1 (helper) + Task 2 Step 4 (wiring).
- ✅ Tool description update → Task 3.
- ✅ System-prompt rewrite → Task 4.
- ✅ Test file at `tests/lib/chat-pnl-labor.test.ts` with 4 spec-named cases → Task 1 covers all 4 (full / partial / zero / multi-store mixed) plus 4 defensive cases.
- ✅ Verification covers all 5 spec steps → Task 5 Steps 1-7.

**2. Placeholder scan:** No TBDs, no "implement later", every step has the actual code or command to run.

**3. Type consistency:**
- `LaborCoverage` interface defined in Task 1 Step 3, imported in Task 1 Step 1's test, used in Task 2 Step 3's `laborCoverage` array. Field names (`storeName`, `totalDays`, `coveredDays`, `hasFixedMonthlyLabor`) match across both tasks.
- `buildLaborCaveats(coverage[])` signature matches in both test and implementation.
- `harriLaborByPeriod` shape `{ actualUsd, coveredDays }` matches `HarriLaborByPeriod` type already exported from `@/lib/pnl` ([pnl.ts:321](../../../src/lib/pnl.ts#L321)).
