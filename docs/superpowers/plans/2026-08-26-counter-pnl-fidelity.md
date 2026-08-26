# Counter P&L: Fidelity Implementation Plan (Phase C, page 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/dashboard/pnl` on Counter to the prototype's own `P.pnl.desk()` and `P.pnl.phone()`, and flip its fidelity manifest entry to `"counter"` with a regression floor — zero extras, every absence recorded.

**Architecture:** The shared statement reduction is extracted out of the Overview adapter first, so the two pages cannot print different prime costs; the Overview's own gate is the regression check for that extraction. Then the one primitive the P&L needs and nobody has built — the eight-week table — then the adapter, then both compositions.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 7, Prisma 7, Vitest 4 + RTL 16, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-25-counter-fidelity-addendum.md`, amending `docs/superpowers/specs/2026-08-23-counter-design-system-design.md`.

**Source of truth:** `P.pnl.desk()` (line 5245) and `P.pnl.phone()` in `docs/counter/counter-prototype.html`, with helpers `pnl()` 5098, `pnlCmp()` 5123, `cascadeOf()` 5039, `weekRows()` 5066, `weekTable()` 5141, `stmtTable()` 5177, `trustPanel()` 5216. When this plan and the prototype disagree, the prototype wins and the plan gets fixed — that happened in **every task** of Phase B and most of Phase C.

## Why the P&L is second

Note 60 is about this page. Prime cost read 56.2% on the Overview and 57.9% on
the P&L for the same range, because one counted hourly wages and the other
counted hourly plus salaried. `src/lib/counter/prime-cost.ts` already exists and
already owns the definition. This plan makes the *loading* shared too, so the
two pages cannot diverge upstream of it either.

## Global Constraints

- Branch is `dashboardv2`. No rebase.
- Gate: `rm -rf .next && npm test && npm run tokens && npx tsc --noEmit && npm run build`.
  **Stop any dev server before clearing `.next`** or the next sign-in returns 500.
- Tests live in a top-level `tests/` tree mirroring `src/`, never `__tests__/`.
- **A test that passes before the fix is not a test.** Break it, watch it red, restore, report both. Eleven such tests have been caught in this project; the last four were caught by implementers on themselves.
- `Section` is the sole state renderer. Every other primitive takes plain data.
- **No page inspects `SectionData.status`, imports Prisma, imports a server action directly, or imports `framer-motion`.**
- **Never fabricate a figure to close a gate.** Five of the Overview's six strip figures ship with no meter because the schema publishes no target; the same rule binds here. An absence goes in the manifest's `absentLandmarks` with a reason, and it fails as **stale** the day the data arrives.
- **Zero extras** (ruling F-R8) — an extra silently leaves the rendering comparison and shrinks what is checked.
- Under React 19 + RTL 16, only `fireEvent` commits state.
- `npm run shot -- <route> <out.png> <width> [light|dark]`. **The phone is `/m/...`, not the desk route at 390** — middleware maps `/dashboard/*` to `/m/*` for phone user agents, and a desktop UA at 390 photographs the desk squeezed. That mistake cost Phase C a task.
- A dev server can serve **stale modules**, and a first sign-in against a cold server fails then passes on retry. Both are recorded false alarms.

---

## Task 1: Extract `statement.ts`, with the Overview's gate as the net

`src/lib/counter/adapters/overview.ts` is **1,346 lines** and its module comment
already states the rule this task makes structural: *every dollar printed as
sales comes from ONE `getAllStoresPnL` call*. The P&L prints the same dollars.
If it loads them itself, note 60 comes back — not as a formula difference, which
`prime-cost.ts` now prevents, but as a *bounds* or *rollup* difference upstream
of it.

**Files:**
- Create: `src/lib/counter/statement.ts`
- Modify: `src/lib/counter/adapters/overview.ts` (consume it)
- Test: `tests/lib/counter/statement.test.ts`

**This is a >400-line file being restructured, which is a project tripwire.
Read `docs/refactor-playbook.md` before you start** — it mandates a re-export
shim at the original path (and that shim must NOT carry `"use server"`, which
breaks Next.js re-exports), contract tests with mocked Prisma, and an explicit
mobile-import check.

**Interfaces produced:**

```ts
export interface StatementLines {
  grossSales: number
  commissions: number      // gross less net-after-commissions, positive
  cogsValue: number
  laborValue: number       // the whole blended wage bill — see prime-cost.ts
  occupancy: number
  otherOperating: number
  bottomLine: number
  marginPct: number | null // null with no sales, never 0
}
export interface StoreStatement extends StatementLines {
  storeId: string
  storeName: string
  fixedCostsConfigured: boolean
  prime: PrimeCost
}
export interface Statement extends StatementLines {
  days: number
  prime: PrimeCost
  perStore: StoreStatement[]
  storeNotFound: boolean
}
export async function loadStatement(input: {
  range: DateRange
  storeId: string | null
  accountId: string
  granularity?: Granularity
}): Promise<Statement>
export function granularityFor(range: DateRange): Granularity
```

Three things this must preserve, all learned the hard way:

- **A single store is read out of the all-stores call.** `getStorePnL` returns
  no labour *total* — labour is one `PnLRow` among twenty — while
  `getAllStoresPnL` returns `cogsValue` and `laborValue` per store and combined,
  from one already-cached query. One call shape is the only way the group total
  and the single-store figure cannot use different denominators.
- **`marginPct` is `null` with no sales, never 0.** Zero reads as break-even.
- **`otherOperating` is clamped at zero.** It is a remainder
  (`fixedCosts − labour − rent`) and float drift lands it at `-1e-12`, which a
  cascade of positive subtractions prints as `-$0.00`.

- [ ] **Step 1: Write the contract tests first, against mocked `getAllStoresPnL`**
- [ ] **Step 2: Extract, keeping `overview.ts`'s behaviour byte-identical**
- [ ] **Step 3: The regression check that matters**

`npm run fidelity -- --grep overview` must still report **desk 76 matched /
0 extra / 0 rendering differences, phone 44 / 0 / 0**. The gate turned on for
Overview yesterday is this refactor's safety net — that is what it was for.
If any number moves, the extraction changed behaviour; find out why before
continuing.

- [ ] **Step 4: Gate and commit**

---

## Task 2: `.wkt` — the eight pressable weeks

The one landmark class with CSS and no emitter anywhere in the tree
(`counter-components.css:660-667`). Phase B's Task 8 identified it and
correctly left it, because it belongs to this page.

**Files:**
- Create: `src/components/counter/surface/week-table.tsx`
- Test: `tests/components/counter/week-table.test.tsx`

**Prototype source:** `weekTable()` line 5141, `weekRows()` line 5066.

Note 53: *"Weekly is the cadence the trade runs on: a prime-cost variance found
in week one can be fixed in week two, and the same variance found in a monthly
close has already run for four weeks."* Each row is **the same statement over
that week**, and pressing one moves the date control.

Four things the prototype does that are easy to miss:

1. **The weeks are anchored on TODAY, not on the selected range**, so the list
   does not slide out from under the finger that pressed it. The marker moves;
   the rows stay put.
2. **A part-week is drawn short and labelled short** — "4 of 7 days" — and is
   never annualised up to look like a full one. Its dollars are smaller for that
   reason alone, and the caption says so.
3. **Pressing a row sets a custom range**, which is exactly what
   `writeCounterParams({ range })` writes as `?from=…&to=…` and `rangeLabel`
   names. That work landed in the withdrawn Plan 8 and survives for this.
4. **The row hook is `tr[data-ln].is-on`** — both the attribute and the class.
   `is-sel` exists in the sheet and paints no accent rail; a Phase B review
   caught that exact mistake. Setting `is-on` without `data-ln` styles nothing.

- [ ] **Steps:** failing test → red → emit the prototype's DOM → green → prove
  the `data-ln`/`is-on` pair by dropping each half → commit.

---

## Task 3: `adapters/pnl.ts`

**Files:**
- Create: `src/lib/counter/adapters/pnl.ts`
- Test: `tests/lib/counter/adapters/pnl.test.ts`

Sections, each shaped as its component renders it: `headline` (the strip),
`cascade`, `weeks`, `statement` (the line-by-line table with a change column),
`byStore`, `trust`, `foodCause`.

**Two things this adapter must not do:**

- **It must not re-derive prime cost.** It comes from `statement.ts`, which
  gets it from `prime-cost.ts`. `tests/lib/counter/note-60.test.ts` — written in
  the withdrawn plan and still in the tree — asserts both adapters agree to the
  digit. **Extend it to cover this adapter** rather than writing a second test.
- **It must not invent the trust panel.** Note 44's measured / prorated / rate /
  unposted breakdown needs a per-line provenance model and an "unposted food
  inside this range" query, and neither exists. That is `not_computed` with a
  reason, and an `absentLandmarks` entry.

**Empty is two different states here** (note 23): a store the account does not
own is `no_match`; an account where nothing has traded is `pre_open`.
`classify` carries one `emptyReason`, so decide it in the adapter rather than
widening `classify`, which four other adapters depend on.

---

## Task 4: The desk composition

**Files:**
- Create: `src/app/dashboard/pnl/page.tsx`, `counter-pnl-client.tsx`
- Create: `src/app/dashboard/pnl/[storeId]/page.tsx` (redirect shim)
- Delete: `src/app/dashboard/(editorial)/pnl/`

The page graduates by moving **out** of the `(editorial)` route group. The
store switcher deletes `pnl/[storeId]`, but it survives as a shim because it is
a URL owners have bookmarked and the mobile P&L links to it; Phase F removes the
shims together.

Compose from `P.pnl.desk()`, in its order: strip → the reading paragraph →
`.wf` cascade → the eight weeks → the statement table → the split of
food-cause and trust → by-store.

**The owner gate goes on this page**, as on Overview: `getAllStoresPnL` gates
on owner access, so a non-owner would otherwise get a page of failed sections.
A page that looks broken is worse than one that was never theirs.

**The cascade must reconcile**: start, minus every subtraction, equals the end.
`Cascade` already computes the end from the cuts rather than taking it as a
parameter, so this holds by construction — assert it on the rendered DOM.

---

## Task 5: The phone composition

`P.pnl.phone()`. Uses `mstrip`, `mlist`, `money` — all built in Phase C Task 4 —
plus `.mtop` for the store and range controls.

**The phone route is `/m/pnl`.** Check what is there now before you build.

---

## Task 6: Flip the gate on

Both surfaces clean, zero extras, every absence in `absentLandmarks` with a
reason. Flip `pnl` and `pnlstore` to `"counter"` with baselines. Run twice, the
second time against a cold `npm run build && npm run start`. Commit the report
and the manifest **together** — the commit that flips a page is the commit that
turns its gate on.

---

## Self-review

**Spec coverage.** Structure, light rendering and dark assertion on both device
projects — Task 6. Baseline and zero extras — Tasks 4, 5, 6. Numbers from the
database with absences recorded — Tasks 3 and 6.

**Placeholders.** Task 4 points at `P.pnl.desk()` rather than transcribing it.
The prototype is in the repo at a known line, and copying it into a plan makes a
second copy that drifts — the failure this whole phase corrects.

**Type consistency.** `Statement`/`StoreStatement` (Task 1) are consumed by the
adapter (Task 3). `PrimeCost` comes from `prime-cost.ts` unchanged. The week
table's row type is produced in Task 2 and consumed in Task 3.

**Known gaps carried forward.**
1. The trust panel (note 44) stays owed — it needs a provenance model.
2. `modelCall` is loaded by the Overview adapter and rendered by nothing; it
   needs a home or deletion.
3. The phone shell still stops dark mode at the Counter root, and `.mtop`
   renders inset by the editorial gutter.
