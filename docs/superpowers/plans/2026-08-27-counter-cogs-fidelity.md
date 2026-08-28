# Counter COGS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Rebuild `/dashboard/cogs` and `/dashboard/cogs/[storeId]` on Counter,
both surfaces, streaming, and gate them.

**Architecture:** `DailyCogsItem` holds the cost; the statement holds the
denominator. The page divides one by the other and by nothing else — see C-R1,
which is the whole plan.

**Spec:** [`docs/superpowers/specs/2026-08-26-counter-streaming-architecture-design.md`](../specs/2026-08-26-counter-streaming-architecture-design.md), [`DESIGN.md`](../../../DESIGN.md).

**Measurements:** [`docs/counter/measurements/2026-08-27-cogs.md`](../../counter/measurements/2026-08-27-cogs.md) — read it first; it decides three of the rulings below.

**Prototype:** `P.cogs` at `docs/counter/counter-prototype.html:5384`,
`P.cogsstore` at 7744.

**Precedent:** the Analytics and Labor plans did this shape on 2026-08-27.
Their rulings carry unchanged: A-R12 (never a shell over zero rows), A-R13
(one daily statement, folded), A-R15 (the service day), A-R20 (dollars drift,
ratios hold), L-R20 (a trend's denominator is the headline's).

---

## Working mode: BUILD VELOCITY

No tests except money arithmetic — here, Task 1 only. Gates:
`npm test && npm run tokens && npx tsc --noEmit && npm run build`, **`npm test`
first**, plus `npm run fidelity`, baseline **63 passed / 84 skipped**.

## Global Constraints

1. Never `prisma migrate dev`; no schema change.
2. Colour only from `ct-` tokens. `counter-components.css` is GENERATED —
   never hand-edit. **`.donut` already has rules there (line 594) and nothing
   renders them**, so the new primitive needs no CSS.
3. A page never imports Prisma or a server action directly, never branches on a
   `SectionData` status, never imports `framer-motion`, never renders
   `AppShell`/`PhoneShell`.
4. A `loading.tsx` beside every `page.tsx`; pages call the not-awaited
   `get*SectionPromises(...)`.
5. A figure shown on two pages comes from one function in `src/lib/counter/`.
6. Commits carry no `Co-Authored-By: Claude` line.
7. Nine lint rules run on `npm run tokens`.

---

## Rulings

**C-R1 — food cost is the statement's number, not the table's.** Measured, the
same $14,008 of cost gives **20.91%** over `DailyCogsItem.salesRevenue` and
**28.36%** over the statement's Total Sales. The Analytics store page already
ships **27.8%**. A COGS page printing 20.9% would sit seven and a half points
from a page three clicks away, both labelled "food cost".

**The page divides by the statement's Total Sales.** `DailyCogsItem` is read
for the COST and for the breakdowns; its own `salesRevenue` column is never a
denominator on this page. Say that in the adapter docblock — it is the single
most likely thing for a future edit to undo.

*Cost if wrong:* every percentage on the page is seven points off and looks
plausible.

**C-R2 — the restaurant is UNDER plan, and the prototype's copy inverts.**
`Store.targetCogsPct` is 30; measured food cost runs 20.7–22.6%. The prototype
is built around an overshoot: *"the red is the overshoot, not the measure"*, a
cell reading "N pts over plan", a table of "the items costing the most against
plan". **Derive every sentence; port none of them.** The chart's `fillFrom:
PLAN` still works and fills the other way.

**C-R3 — "Waste" is dropped.** `InventoryAdjustment` has **0 rows in the whole
table** and `StockCount` has 4. There is no waste series and no honest way to
invent one. The desk strip is three cells, not four → a `data-n` difference,
declared through `styleAllowances`, the mechanism the Analytics plan added.

**C-R4 — "Theoretical" needs its own decision before it is drawn.** 60 recipes
carry 129 `RecipeIngredient` rows between them — about two ingredients each. A
theoretical food cost computed from that is a line the page cannot defend, and
drawing it beside the actual invites the reader to trust the gap. **Task 3
measures the recipe coverage per menu item and decides**: draw it only over
items whose recipes are complete, and say how many that is, or resolve the
series `not_computed` and declare the absence. Either is defensible; silently
drawing a thin line is not.

**C-R5 — the donut asks a question our column does not answer.** The
prototype's slices are INGREDIENT categories (Proteins, Produce, Dry goods,
Dairy, Packaging). `DailyCogsItem.category` holds MENU categories (On The Side
29.0%, NFL Promo 23.0%, Combos 21.6%, …). Two different questions.

**Draw the menu categories and title the section for what it shows** — "By
menu category" — rather than relabelling menu data with an ingredient word.
Ingredient-category spend would come from the invoice-line → canonical-
ingredient path, which is a second query and a second plan.

**C-R6 — "Unposted invoices" is real and bigger than the fixture.** 13 invoices
in `REVIEW` worth **$19,627**, against the prototype's invented "3 · $2,140".

**C-R7 — `Donut` is a new primitive and needs no CSS.** `.donut`, `.donut svg`
and `.donut .lg` are already in the generated sheet with nothing rendering
them. Port the prototype's `donut()` markup exactly.

**C-R8 — one store trades.** Van Nuys and Glendale are `pre_open`. Every
section resolves a reasoned refusal, never a shell over zero rows (A-R12).

---

## The data, measured 2026-08-27 (window 2026-08-20 … 26)

Read [`the measurement note`](../../counter/measurements/2026-08-27-cogs.md)
for the full table. The figures the tasks assert:

- cost **$14,008**; Total Sales **$49,389**; food cost **28.36%**
- weekly food cost 20.7–22.6% of menu revenue over twelve weeks
- categories: On The Side $4,063 (29.0%), NFL Promo $3,227 (23.0%), Combos
  $3,033 (21.6%), Slider and Fries Combos $1,644 (11.7%), Drinks $993 (7.1%),
  Packaging $370 (2.6%), Secret Menu $366 (2.6%), A La Carte $313 (2.2%)
- invoices: 193 MATCHED, 19 APPROVED, **13 REVIEW / $19,627**
- `DailyCogsItem` 14,018 rows over 306 days; in-window 334 lines, **0
  unmapped**, provenance 228 invoice / 94 mixed / 5 override / 7 null
- `InventoryAdjustment` **0**, `StockCount` **4**
- `Recipe` 60, `RecipeIngredient` 129, `CanonicalIngredient` 76

---

## Task 1: the cost module

**Files:** create `src/lib/counter/cogs.ts`, `tests/lib/counter/cogs.test.ts`.

Money arithmetic — assertions required.

```ts
export interface CogsCategory { category: string; cost: number; share: number }
export interface CogsItem {
  itemName: string
  cost: number
  revenue: number
  units: number
  /** This item's cost over ITS OWN revenue, 0..100. `null` with no revenue. */
  foodPct: number | null
  /** Points above the plan, or `null` where either side is unknown. */
  againstPlan: number | null
  /** What the overshoot costs, in dollars. `null` when inside plan. */
  lost: number | null
}
export interface CogsWindow {
  cost: number
  /** THE STATEMENT'S Total Sales. Never `DailyCogsItem.salesRevenue` (C-R1). */
  sales: number
  /** `cost / sales * 100`. `null` with no sales — never `0`. */
  foodPct: number | null
  plan: number | null
  /** `foodPct - plan`; negative is inside plan, which is where this store sits. */
  againstPlan: number | null
  categories: CogsCategory[]
  /** Lines whose cost is an understatement — `partialCost`. */
  partialLines: number
  unmappedLines: number
}
export function cogsWindow(input: {...}): CogsWindow
export function rankByLoss(items: CogsItem[], plan: number): CogsItem[]
export async function loadCogs(input: {
  range: DateRange
  storeId: string | null
  accountId: string
  /** Total Sales from the statement the adapter already loaded (C-R1). */
  sales: number
}): Promise<{ window: CogsWindow; items: CogsItem[] }>
```

**`sales` is passed in.** Same contract as `loadLaborWeek`'s `salesByDay` and
`loadLaborTrend`'s `weeklyTotalSales` — a loader that fetched its own sales
would be a second answer to a question the page already answered.

Scope stores through `accountId` first, as `channel-mix.ts` does.

- [ ] **Step 1: write it.**
- [ ] **Step 2: assertions.**
  1. `foodPct` over the measured window is **28.36** to two decimals on
     $14,008 and $49,389.
  2. **Assert the wrong answer is not returned**: feeding menu revenue
     ($66,985) must NOT be what `sales` means — a fixture using it yields
     20.91, and the test names that number as the one C-R1 forbids.
  3. `againstPlan` on a plan of 30 is **−1.64** — negative, inside plan.
  4. Category shares sum to 100 within 0.01, and ordering is by cost
     descending: On The Side first at 29.0%.
  5. An item with revenue and no cost yields `foodPct: null`, never `0`.
  6. `rankByLoss` puts the largest `lost` first and drops items inside plan
     (`lost: null`), rather than ranking them as zero.
  7. A window with no sales yields `foodPct: null` and no `NaN` anywhere.
- [ ] **Step 3: run.** `npx vitest run tests/lib/counter/cogs.test.ts`
- [ ] **Step 4: mutation-check C-R1.** Swap the denominator to the table's own
  `salesRevenue`, confirm assertion 1 fails with 20.91 against 28.36, restore,
  report the exact output.
- [ ] **Step 5: commit.**

---

## Task 2: the Donut primitive

**Files:** create `src/components/counter/surface/donut.tsx`; export it from
`src/components/counter/index.ts`.

Port `donut()` from the prototype. `.donut`, `.donut svg` (118×118) and
`.donut .lg` already carry rules — **write no CSS**. If a rule seems missing,
report it rather than adding one.

Slice colours come from `ct-` tokens only. The prototype hands each slice a
colour; the caller supplies them from the token set.

- [ ] Build it, gate, commit.

---

## Task 3: the theoretical decision, then the adapter

**Files:** create `src/lib/counter/adapters/cogs.ts`.

**Step 0 is a measurement, and it decides C-R4.** Count, per menu item sold in
the window, whether its recipe has a complete ingredient walk. Report the
number. Then either draw the theoretical series over the complete subset and
say how many items that is, or resolve it `not_computed` with the count as the
reason. **Do not draw a line over 129 ingredient rows without saying so.**

Sections — group page: `headline` (three cells, C-R3), `plan` (the chart with
its rule), `moved` (ingredient price movement), `categories` (the donut),
`items` (ranked by loss). Store page: `headline` (four cells), `plan`,
`moved`, `worst`.

ONE `loadStatement` at daily granularity, folded here (A-R13). Its Total Sales
is what `loadCogs` divides by.

- [ ] Measure, decide, build, gate, commit.

---

## Tasks 4–7: the four surfaces

Desk group, phone group, desk store, phone store — same shape as the Analytics
and Labor plans. Each: build, delete the editorial route it replaces, gate,
**browser-check with a screenshot**, commit.

Watch the caption-versus-delta trap, which has bitten this project five times:
on the desk a `caption` with no `reference` renders an EXTRA landmark; on the
phone the same prop renders NOTHING. Qualifiers go in the delta slot, with an
explicit neutral tone — an untoned `.strip .d` is `var(--good)`.

Delete `src/app/dashboard/(editorial)/cogs/**`. There is no mobile COGS route
today and the middleware has no entry; add one.

---

## Task 8: measure the fidelity, then gate

Report first, gate second. Expected absences: the Waste cell and its `data-n`
(C-R3), and whatever C-R4 decides. An EXTRA landmark is never forgiven;
`.empty` must be 0 on all four surfaces. `tests/e2e/landmarks.test.ts` asserts
the gated roster in manifest order and will fail until `cogs` and `cogsstore`
are added — expected.

---

## Carried, not fixed here

- `hasOwnerAccess` returns true for every role the enum holds.
- Ask answers without calling a tool roughly 8% of the time (K-R2 forbids it).
- Changing the range on `/dashboard/ask` re-asks, spending a model call.
- `?q=` is shared between Ask and the orders list's free-text search.
- The Otter sync's `adjusted_commission` coverage collapse.
