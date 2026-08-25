# Counter Overview: Fidelity Implementation Plan (Phase C, page 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take `/dashboard` from 23 of 86 desk landmarks to **86 of 86, zero missing, zero extra, zero rendering differences**, on both surfaces, and flip its fidelity manifest entry to `"counter"` with a regression floor.

**Architecture:** Four server gaps close first, because 24 of the 67 missing landmarks cannot render without them. Then one adapter fetches everything the page shows — the current one asks for four numbers where the design shows more than twenty. Then the page composes the primitives Phase B built, in the prototype's own order. Nothing new is invented: every missing landmark already has a component.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 7, Prisma 7, Vitest 4 + RTL 16, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-25-counter-fidelity-addendum.md`, amending `docs/superpowers/specs/2026-08-23-counter-design-system-design.md`.

**Source of truth:** `P.overview.desk()` and `P.overview.phone()` in `docs/counter/counter-prototype.html`. When this plan and the prototype disagree, the prototype wins and the plan gets fixed. In Phase B that happened in every single task — four times in one, eleven in another.

## Global Constraints

- Branch is `dashboardv2`. No rebase.
- Gate: `rm -rf .next && npm test && npm run tokens && npx tsc --noEmit && npm run build`.
  **Stop any dev server before clearing `.next`** or the next sign-in returns 500.
- Tests live in a top-level `tests/` tree mirroring `src/`, never `__tests__/`.
- **A test that passes before the fix is not a test.** Break it, watch it red, restore, report both. Nine such tests have been caught in this project; the last three were caught by implementers on themselves.
- `Section` is the sole state renderer. Every other primitive takes plain data.
- **No page inspects `SectionData.status`, imports Prisma, imports a server action directly, or imports `framer-motion`.** `npm run tokens` fails the build on each.
- **Never fabricate a figure to close a gate.** A number the database cannot produce is `not_computed`, in the cell where it belongs — never a grey box swallowing the section around it.
- Under React 19 + RTL 16, only `fireEvent` commits state.
- `npm run shot -- <route> <out.png> <width> [light|dark]` waits for `#ct-main` and hides Next's dev indicator.
- **A dev server can serve stale modules.** If a browser check contradicts the source, restart it before believing either.

## What Phase B measured, and this plan spends

Task 8's report contains a per-landmark table: all 67 missing desk landmarks,
each mapped to the component that supplies it and the composition step that
mounts it. **Read `.superpowers/sdd/2026-08-25-counter-fidelity-foundation/task-8-report.md`,
section "Phase C input", before starting Task 3.** This plan does not restate
that table — restating it would create a second copy that drifts.

Four prerequisites fall out of it, and they are Task 1:

| # | Gap | Landmarks blocked |
|---|---|---|
| 1 | `getSplhSeries` takes no date range | `.fig` (1 of 2), `.hfloor`, `.blt` (1 of 7), `.ch` (1 of 2) |
| 2 | No adapter returns per-channel net + orders | `.chan` ×3, `.chan__row` ×4, `.cbar` ×4 |
| 3 | `alerts/inbox-actions` is not wired | `.queue`, `.qitem` ×3 |
| 4 | Six strip figures have no published band or target | `.blt` ×6, `.band` ×6, `.sp` ×4 |

---

## Task 1: The four server gaps

**Files:**
- Modify: `src/app/actions/splh-actions.ts`
- Create: `src/lib/counter/channel-mix.ts`
- Create: `src/lib/counter/targets.ts`
- Test: `tests/lib/counter/channel-mix.test.ts`, `tests/lib/counter/targets.test.ts`,
  `tests/app/actions/splh-actions.test.ts` (extend if it exists)

**Interfaces produced:**

```ts
// splh-actions.ts — ADD a range, do not replace the existing signature's callers
export async function getSplhSeries(
  granularity: SplhGranularity,
  range?: { startDate: Date; endDate: Date },
): Promise<SplhSeries>
```

```ts
// src/lib/counter/channel-mix.ts
export interface ChannelReading {
  channel: ChannelId          // from src/lib/counter/channels.ts — do NOT invent ids
  net: number
  orders: number
  commission: number          // what the marketplace kept; 0 for in-house
  ticket: number | null       // net / orders, null when orders === 0
}
export async function loadChannelMix(input: {
  range: DateRange
  storeId: string | null
}): Promise<ChannelReading[]>
```

```ts
// src/lib/counter/targets.ts
/** A figure's published reference — the thing a bullet meter judges it against. */
export type Target =
  | { kind: "target"; value: number; better: "low" | "high" }
  | { kind: "band"; lo: number; hi: number; better: "low" | "high" }
  | null
export interface StripTargets {
  orders: Target
  ticket: Target
  foodCost: Target
  labor: Target
  prime: Target
  marketplaceFees: Target
}
export async function loadStripTargets(storeId: string | null): Promise<StripTargets>
```

- [ ] **Step 1: Give `getSplhSeries` a range, without breaking its callers**

Read it first (`src/app/actions/splh-actions.ts:51`). It derives its own
trailing 14-day / 12-week window internally, which is exactly why Plan 7 marked
Overview's SPLH `not_computed` (ruling R1) rather than showing a trailing figure
beside range-scoped ones — note 60's defect class.

`range` is **optional**. Existing callers keep their trailing window; Counter
passes a range and gets that range. Grep for callers before you change
anything and list them in your report.

- [ ] **Step 2: Test the range actually scopes the query**

The assertion that matters is not "it returns data" but "it returns data for
the range asked for". Mock Prisma and assert the `where.date` bounds equal
`toQueryBounds(range)`. `toQueryBounds` exists in `src/lib/counter/date-range.ts`
precisely because Counter's `end` is a local midnight and existing queries treat
`endDate` as inclusive — hand the raw `end` to a query and you silently drop the
last day of every range.

Prove it red: pass a range, assert the bounds, and confirm the test fails
against the unmodified function.

- [ ] **Step 3: `channel-mix.ts`**

`getAllStoresPnL` already returns `channelMix: Array<{channel, amount}>` per
store — read `src/app/actions/store/pnl-types.ts`. That gives net per channel
but not orders and not commission. Orders come from the Otter order data; the
commission rates are `Store.uberCommissionRate` and
`Store.doordashCommissionRate` (defaults 0.21 and 0.25).

Channel ids come from `src/lib/counter/channels.ts`, which already carries the
CVD-safe scale (notes 36, 41). **Do not invent ids or colours.**

`ticket` is `null` when `orders === 0`, never `0`. A channel with no orders has
no average ticket; zero is a claim that every order was free.

- [ ] **Step 4: `targets.ts`**

`Store.targetCogsPct` exists and is nullable. The other five have no column.
**Do not invent numbers, and do not hardcode the prototype's.** A figure with
no published reference returns `null`, and `Figure` renders it with no bullet
and no band — which is the honest rendering and is already how the primitive
behaves.

Return `null` for anything the schema cannot answer, and say in your report
exactly which of the six are `null`, so Task 3 knows which cells will carry a
meter and which will not. If that is five of six, that is the true answer and
the page shows five bare figures; a page that invents five targets to fill its
meters is worse than one that admits it has one.

- [ ] **Step 5: Gate and commit**

```bash
rm -rf .next && npm test && npm run tokens && npx tsc --noEmit && npm run build
git commit -m "feat(counter): the four figures Overview could not ask for"
```

---

## Task 2: The Overview adapter

**Files:**
- Rewrite: `src/lib/counter/adapters/overview.ts`
- Test: `tests/lib/counter/adapters/overview.test.ts`

The current adapter asks for four numbers. The page shows more than twenty. It
also marks `needsYou` and `modelCall` as owed **against code that already
exists** — `src/app/actions/alerts/inbox-actions.ts:68` (`getAlertInbox`) and
`src/app/actions/forecasts/`. That was not a data problem; it was never asking.

**`OverviewSections` gains**, each already shaped the way its component renders it:

```ts
splh: SectionData<{ value: number; floor: number | null; series: number[] }>
strip: SectionData<StripCell[]>          // six cells, each with optional reference
verdict: SectionData<{ tone: "good" | "warn" | "bad"; headline: string; body: ReactNode; href?: string }>
moving: SectionData<MovingCell[]>        // three cells
needsYou: SectionData<QueueItem[]>       // from getAlertInbox — NO LONGER owed
salesChart: SectionData<ChartData>
splhChart: SectionData<ChartData>
stores: SectionData<StoreCard[]>         // trading and pre-open are DIFFERENT shapes
channels: SectionData<ChannelReading[]>
invoices: SectionData<MoneyLine[]>       // four lines, not four figures
modelCall: SectionData<…>                // from forecasts/ — NO LONGER owed by default
```

- [ ] **Step 1: Write the failing tests first**

One per section, mocking the underlying action. The load-bearing cases:

```ts
it("asks getSplhSeries for the SELECTED range, not a trailing window", …)
it("marks needsYou owed ONLY when getAlertInbox itself has nothing", …)
it("gives a pre-open store a card shape with no net-sales field at all", …)
it("renders a channel with zero orders as a null ticket, never $0.00", …)
it("keeps a figure with no published target free of a bullet reference", …)
it("fails ONE section without taking the others down", …)
```

That third one is a type-level guarantee, not a runtime check: a trading card
and a pre-open card are different shapes, so a pre-open store *cannot* be given
a null net-sales figure. Note 33 is the reason — em-dashes are what the design
deleted.

- [ ] **Step 2: Run them red, then implement**

Every section loads concurrently. One slow rollup must not hold up the rest,
and one failure must not take the page down — `classify` never throws.

- [ ] **Step 3: The verdict sentence**

`.say` names the ONE thing that is wrong and links to it. Derive it; do not
hardcode it. The prototype's own logic is in `P.overview.desk()` — it compares
each figure to its target, picks the worst breach, and writes the sentence
around it. **If no figure has a published target (see Task 1 Step 4), there is
no verdict to write** — return `not_computed` with a reason naming what is
missing, rather than a cheerful sentence with no evidence behind it.

- [ ] **Step 4: Gate and commit**

---

## Task 3: The desk composition

**Files:**
- Rewrite: `src/app/dashboard/counter-overview-client.tsx`
- Modify: `src/app/dashboard/page.tsx` (pass what the adapter now returns)
- Test: `tests/app/counter-overview.test.tsx`

**Read `.superpowers/sdd/2026-08-25-counter-fidelity-foundation/task-8-report.md`,
section "Phase C input", before you start.** It maps all 67 missing landmarks
to their component and their mounting step. Follow it row by row.

- [ ] **Step 1: Compose in the prototype's order**

`.dispatch` → `.headline--duo` (two `.fig` + `.say` + `.hfloor`) → `.strip`
(six cells) → `.moving` → `.askbar` + `.sugs` → the `.split` chart pair →
`.drill` holding the comparison `.tbl` → `.queue` → `.stores` with
`.chan` panels → the invoices `.moneyline` block.

Two ordering constraints from Phase B, both of which break the layout if missed:
- **Cards must all precede all drawers** inside `.stores`, because
  `.stores > .ldrawer` is `grid-column: 1/-1`.
- The head block sits at **page level**, above every section. Our four current
  "extra" landmarks are `.headline`/`.fig`/`.strip`/`.tbl` at the wrong index
  because everything above them is missing; composing in this order clears all
  four. **If extras are not 0 at the end of this task, say which and why** —
  a page cannot be marked `"counter"` with any extra (ruling F-R8), because an
  extra silently leaves the rendering comparison and shrinks what is checked.

- [ ] **Step 2: The ledger section stops passing `pad={false}`**

A card grid is not a table and wants its gutter back. That restores `.sec__body`.

- [ ] **Step 3: Map the two stage vocabularies in ONE place**

`StoreSwitcher` speaks `warming_up`; `StoreCards` speaks `fit_out`. Overview
holds both. One mapping function, one place — two vocabularies that each page
translates for itself is how note 60's two labour figures happened.

- [ ] **Step 4: Run the gate, then the fidelity suite**

```bash
npm run fidelity -- --grep overview
```

Report desk landmarks, matched, extra, and rendering differences **with their
denominator**. A bare "0 differences" is never enough (ruling F-R8).

- [ ] **Step 5: Render it and look at it**

1440 and 390, both themes. Zero console errors. Then check the things a
screenshot cannot show: open the date popover **after scrolling** (the
containment hazard), tab through the queue's actions, and confirm the strip's
six cells reflow 6→3→2 rather than staying at six.

- [ ] **Step 6: Commit**

---

## Task 4: The phone surface

**Files:**
- Create: `src/components/counter/shell/m-head.tsx`, `m-strip.tsx`, `m-list.tsx`
- Modify: `src/app/dashboard/counter-overview-client.tsx` (phone composition)
- Test: `tests/components/counter/shell/m-*.test.tsx`

**Three landmark classes still have no emitter anywhere in the tree** —
`.mhead`, `.mstrip`, `.mlist`. They are the phone's own, Task 5 of Phase B
deferred them explicitly, and **no mobile fidelity number can move until they
exist**. Phone is currently 0 of 51.

Prototype source: `mstrip()` line 3093, `mlist()` line 3116, `money()` line
3087, and `P.overview.phone()`.

- [ ] **Step 1: Build the three primitives against the prototype's DOM**
- [ ] **Step 2: Compose the phone Overview**

One instruction carried from Task 6, which would otherwise be got wrong:
**`.moving` on the phone is ONE cell, not three.** The sheet rules its cells off
with `border-right` and has no stacked-column rule, so three cells wrap into a
seam-less block. The prototype's phone Overview passes one.

- [ ] **Step 3: Fidelity on the mobile project**

`npm run fidelity` runs `fidelity-mobile` against the prototype's `phone()`
composition. Report the count against 51.

- [ ] **Step 4: Gate and commit**

---

## Task 5: Flip the gate on

**Files:**
- Modify: `e2e/fidelity/manifest.ts`
- Modify: `docs/counter/fidelity/overview.md`

- [ ] **Step 1: Both surfaces clean**

Desk 86/86 and phone 51/51, zero missing, zero extra, zero rendering
differences, both themes.

- [ ] **Step 2: Flip the manifest entry to `"counter"` with its `baseline`**

`FidelityPage` is a discriminated union: `status: "counter"` **requires**
`baseline` (ruling F-R4). If you have not measured the counts, `tsc` will not
let you claim the page is done.

- [ ] **Step 3: Run the check twice, the second time cold**

Once against the dev server, once against `npm run build && npm run start`.
Dev-mode has hidden real fidelity defects on this project three times: the
doubled shell, the dead `border-ct-*` utilities, and a stale-module server that
served a page without its portal.

- [ ] **Step 4: Commit the report and the manifest together**

The commit that flips a page to `"counter"` is the commit that turns its gate
on. They must not be separable.

---

## Self-review

**Spec coverage.** The addendum requires every page to pass structure, light
rendering and dark assertion on both device projects before it is done — Task 5.
It requires a page marked `"counter"` to carry a baseline and zero extras —
Tasks 3 and 5. It requires numbers to come from the database with owed work
landing in its own cell — Tasks 1, 2 and the "never fabricate" constraint.

**Placeholders.** Task 3 deliberately points at Task 8's report rather than
restating its 22-row table. Restating it would put a second, drifting copy of a
measured artifact into the repo, which is the failure this whole phase corrects.

**Type consistency.** `Target`/`StripTargets` (Task 1) are consumed by the
adapter (Task 2) and reach `Figure.reference` (Phase B Task 3).
`ChannelReading` (Task 1) is consumed by `ChannelRows` (Phase B Task 8).
`StoreCard`'s trading and pre-open variants stay distinct shapes end to end.

**Known gaps carried forward.**
1. `.wkt` — the eight-weeks table — has no emitter and belongs to the P&L page's
   own Phase C task, which must build it.
2. `askSuggestions` is empty on every page; `.cmdk__pane` needs an answer
   surface; "Open a view" needs a sub-view model in `nav.ts`.
3. `.linkact` is emitted as a plain action button on Forecasts and Labor; `Say`
   takes `href` only and owes an action variant.
