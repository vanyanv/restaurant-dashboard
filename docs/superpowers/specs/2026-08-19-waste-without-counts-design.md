# Waste & Ordering Without Stock Counts — Design

**Date:** 2026-08-19
**Status:** design approved; increment 1 unstarted
**Decision (owner, 2026-08-19):** no further work on stock counts. Waste and
ordering must be derived from invoices, sales and recipes alone.

**Measurement window.** Every figure in this document is Hollywood
(`cmexd4zia0001jr04ljkdt9na`), **2026-03-03 → 2026-08-18 (168 days = six
28-day windows), 205 invoices**, measured 2026-08-19. One window throughout, so
figures are directly comparable.

---

## Problem

The owner wants two numbers: *how much am I losing to waste*, and *what should
I order*. The repo already contains an inventory engine that answers both —
`running-on-hand.ts`, `depletion-rate.ts`, `reorder-recommendation.ts`,
`calibration.ts`, `waste-clustering.ts` — but every one of them is anchored on
a physical stock count, and **there has never been a completed stock count.**

| Fact | Value |
|---|---|
| `StockCount` rows | 4 — two `ABANDONED`, two `IN_PROGRESS` (the older stuck since **2026-05-12**) |
| `StockCountLine` rows | 10 |
| `InventoryAdjustment` rows | **0** |
| `IngredientModelState` rows | **0** |

So `runningOnHandFromContext` runs with `baseQty = 0` and `baseAt = null` for
every ingredient, `computeReorderRecommendation` scores against that, and the
Bayesian calibration loop has never executed. The inventory dashboard renders
numbers derived from an anchor that does not exist.

Counts are off the table. This document specifies what replaces them.

## The method

Over a window long enough that opening and closing inventory are comparable,
everything purchased is either sold or lost. So for each ingredient:

> **λ = delivered ÷ theoretical usage**, where theoretical usage is sales
> walked through recipes. λ > 1 means more was bought than the recipes can
> explain. Waste in dollars is `(λ − 1) × theoretical × costPerRecipeUnit`.

λ is the same quantity `calibration.ts` learns from counts (`calibrationFactor`,
a multiplier on theoretical depletion). The only change is the anchor: delivery
history instead of a physical count. Every input already exists.

**λ is reported as a ratio of sums** (`Σdelivered ÷ Σtheoretical`), not as a
mean of per-window ratios — the mean of ratios is upward-biased. Per-window
ratios are computed only to derive the coefficient of variation.

### What this method cannot do

Stated plainly, because increment 2 will publish these numbers:

- **It cannot separate waste from inventory drift in a short window.** A week
  where the walk-in was stocked up reads as waste; the week it is drawn down
  reads as negative waste. Only the long-run rate is meaningful. Windows are
  28 days minimum, and λ carries a confidence band — never a point estimate on
  one week.
- **It cannot isolate theft** from over-portioning, trim loss, or spoilage. It
  measures total unexplained shrink. `waste-clustering.ts` can suggest a
  dominant pattern from the residual shape; it cannot prove a cause.
- **It cannot distinguish "waste" from "the recipe is wrong"** on its own. A
  λ of 21 means the recipes do not describe how the ingredient is used — see
  butter below. Increment 1 exists so that λ, when published, has one
  plausible reading.
- **It cannot measure anything with no recipe path.** Fryer oil and packaging
  are consumed per order, not per recipe line. They are excluded by name
  rather than silently read as zero waste.

## Data findings

### The inputs are healthy

- **Sales mapping is effectively complete.** Of 74 menu items sold in the last
  90 days, 20 are unmapped — and those 20 carry **$99.43 of $843,875**
  (**0.012%**) of revenue.
- **91.2%** of 90-day purchase dollars are on ingredients that appear in a
  recipe; only **0.3%** of spend is unmatched to a canonical ingredient.
- `ForecastMenuItem` is live: **1,039 rows, 15 days ahead**, per Otter SKU.
  The ordering model in increment 3 needs no new forecasting work.

### Blocker 1: only 36.6% of delivered dollars convert to recipe units

`sumDeliveries` (`src/lib/inventory/usage-math.ts`) converts invoice quantity to
recipe units using `convertQty` alone. Invoices bill in **cases**; recipes
consume `each` / `lb` / `oz` / `leaf`. `convertQty` has no case→unit knowledge,
returns `null`, and the line is skipped — contributing zero delivered quantity
while setting a `partial` flag that no surface acts on. That path resolves
**$122,649 of $334,871 (36.6%)**.

**`IngredientSkuMatch.conversionFactor` is mostly a placeholder: 113 of its 118
rows are identity** (`fromUnit == toUnit`, factor 1) — encoding "unknown", not
"1:1". Only **5 rows carry a real factor.** For the bun SKUs it stores
`CS → CS ×1`, while the true factor sits unused on
`CanonicalIngredient.recipeUnitsPerCase` (buns = **72**). Correcting the ladder
in a probe moved buns from λ = 0.01 to λ = 0.92.

Measured against the corrected ladder specified below, the same window resolves:

| Ladder step | Lines | Spend | Share |
|---|---|---|---|
| 1. Case factor (`recipeUnitsPerCase`) | 909 | $151,152 | 45.1% |
| 2. Real SKU factor (non-identity) | 113 | $39,713 | 11.9% |
| 3. Direct unit conversion | 71 | $122,649 | 36.6% |
| 4. **Unconvertible** | 351 | $21,357 | **6.4%** |

The ladder alone recovers **93.6%** of delivered dollars. The residual 6.4% is
the pack-metadata backfill target below.

### Blocker 2: modifier consumption is invisible

`loadStoreInventoryContext` loads only `otterItemMapping`. It never walks
`OtterSubItemMapping` — despite **264,466 `OtterOrderSubItem` rows** and 150
sub-item mappings. Every "Add Tomato" is therefore absent from theoretical
usage.

`buildModifierUsage` (`src/lib/cogs-materializer.ts:256`) already performs the
correct traversal — sub-item → mapped recipe, `uses = subItem.quantity ×
orderItem.quantity` — and was verified exact across 46/46 rows. It produces
*cost*, not per-ingredient quantity, so a quantity-producing sibling is needed;
the traversal itself is proven and must not be reimplemented differently.

### With both blockers fixed, the signal is real

λ over the 168-day window, for the ingredients whose conversion is sound:

| Ingredient | Spend | λ (ratio of sums) | CV | Excess $ |
|---|---|---|---|---|
| Ground beef | $120,500 | **1.25** | 0.30 | **+$24,136** |
| Ice cream mix | $16,499 | 1.07 | 0.35 | +$1,177 |
| Buns | $35,438 | 0.92 | 0.37 | −$3,032 |
| Fries | $33,112 | 0.78 | 0.57 | −$11,604 |

Ground beef is the headline: **~25% more beef purchased than recipes account
for — $24,136 over 168 days, ≈$52k/year** — stable across all six windows
(CV 0.30). That is the target finding, obtained with no stock count.

Fries at λ = 0.78 with CV 0.57 is the counter-example: either the recipe
overstates the portion or a large stock drawdown sits in the window. It is not
yet publishable, which is what the confidence band is for.

### Two independent guards, measuring different things

A cross-check that needs **no recipe coverage at all**: implied unit cost
(`spend ÷ deliveredQty`) must agree with the stored `costPerRecipeUnit`.
Disagreement means the delivery conversion is wrong. Applied to the 41
ingredients with >$300 of spend, it flags 6:

| Ratio | Spend | Ingredient | Reading |
|---|---|---|---|
| ×113 | $30,002 | house sauce cup 1.5 oz | pack factor missing |
| ×12.6 | $5,744 | lettuce boston hydroponic | pack factor missing |
| ×6.6 | $532 | cup plastic 10 oz | pack factor missing |
| ×5.0 | $1,221 | peppers whole yellow | `TUB` unit unmapped |
| ×0.08 | $2,597 | logo t-shirt bags | pack factor wrong |
| ×0.01 | $2,154 | paper patty paper | pack factor wrong |

Crucially it catches patty paper and t-shirt bags, which **λ can never check**
because they appear in no recipe.

It does **not** flag onion or butter — their conversions are sound. So a high λ
on those two means something else entirely:

| Ingredient | λ | Pack | Diagnosis |
|---|---|---|---|
| Onion | 10.8 | `CS`, 40/case, cost consistent | **Modifier gap.** Recipes are `Mod: Add Grilled Onion` / `Mod: Add Raw Onion` — **0 item mappings, 15 sub-item mappings.** Nearly all usage is invisible until modifiers are walked |
| Butter | 21.8 | `CS`, 30/case, cost consistent | **Recipe completeness.** Only recipe credit is Grilled Cheese (70 lb theoretical vs 1,530 lb bought). Griddle and toasting use is in no recipe |

This is why the two guards are separate and ordered: **cost-consistency detects
a broken conversion; λ is only interpretable once it passes.** An earlier draft
of this document misclassified onion and butter as pack-metadata errors; the
cost check disproved that.

### Failure classes

Every ingredient reading theoretical usage of zero, or an implausible λ, falls
into exactly one class:

| Class | Examples | Fix | Increment |
|---|---|---|---|
| **Conversion broken** | house sauce cup ($30,002), lettuce ($5,744), patty paper, t-shirt bags | Pack metadata + ladder | 1 |
| **Modifier gap** | tomato ($8,023), onion ($7,680), lettuce | Walk sub-items | 1 |
| **Recipe incomplete** | butter ($4,770) | Owner-confirmed recipe edit | 1 (flag) / 2 (resolve) |
| **No recipe path, ever** | fryer oil ($3,914), foam containers ($4,594) | Exclude by name; per-order model later | 1 (exclude) |

### The pack-metadata gap is small and enumerable

14 ingredients with >$500 of spend have no `recipeUnitsPerCase`, totalling
**$61,271**. Overall **50 of 76** canonical ingredients have one.

| Spend | Ingredient | recipeUnit | Invoice unit |
|---|---|---|---|
| $30,002 | house sauce cup 1.5 oz | each | CS |
| $6,102 | house sauce | oz | CS |
| $5,744 | lettuce boston hydroponic | leaf | CS |
| $3,562 | hellmann mayonnaise | **null** | CS |
| $3,486 | coke mexican glass | ml | CS |
| $2,888 | american cheese yellow 160 | each | **LB** |
| $2,755 | greeno cup pet 20 oz | each | CS |
| $1,333 | sprite mexican glass | ml | CS |
| $1,254 | fuel surcharge | null | null |
| $1,221 | peppers whole yellow | each | **TUB** |
| $946 | fanta orange mexican glass | ml | CS |
| $767 | ketchup packets foil | g | CS |
| $615 | container bagasse 9x9x3 | null | CS |
| $596 | can liner 40x46 | null | CS |

American cheese needs a weight→count factor and peppers a `TUB` factor, not
case factors. `hellmann mayonnaise` has no `recipeUnit` at all and needs one
before it can be converted to anything.

## Decisions

1. **No stock-count work.** Owner decision, 2026-08-19. The count surfaces
   (`/m/count`, `operations/inventory/count/**`) are left in place and
   untouched; nothing new depends on them.
2. **Data integrity ships before any waste number.** λ computed on today's
   data would teach a model the conversion bug.
3. **One delivered-quantity converter, with an explicit ladder and no silent
   zero.** An unconvertible line is a reported outcome, never a 0.
4. **One theoretical-usage engine**, walking items *and* sub-items, shared by
   inventory and COGS. Two engines that disagree is the current state and is
   the root of the tomato/onion gap.
5. **Cost-consistency is the first guard; λ plausibility is the second.** λ is
   not interpreted for an ingredient whose cost check fails.
6. **Non-recipe consumables are excluded by name, not by silence.** Their spend
   is reported as excluded so the waste total is honestly bounded.
7. **λ is reported as a ratio of sums with a confidence band**, over a minimum
   28-day window. No single-week waste dollar figure is published.

## Scope — increments

| # | Increment | Ships |
|---|---|---|
| **1** | **Correct the math.** Conversion ladder, modifier-inclusive usage engine, both guards, pack metadata for the 14 named ingredients, coverage panel on `/operations/inventory` | Fixes existing wrong numbers + one panel |
| 2 | **Waste ledger.** λ per ingredient with confidence band, dollars, ranked by money | New surface |
| 3 | **Order sheet.** `ForecastMenuItem` → recipes → demand × λ → minus implied on-hand → order qty timed to `VendorLeadTime` | New surface |
| 4 | **Anomaly detection** on window residuals, labelled via `waste-clustering.ts` | Alerts |

**This document covers increment 1.**

### Increment 1 — components

**`src/lib/inventory/delivered-qty.ts`** (new)
`deliveredQtyInRecipeUnit(line, ingredient, skuMatch) → { qty, path }` where
`path ∈ case_factor | sku_factor | unit_convert | unconvertible`. Ladder:
1. `line.unit` matches `ingredient.caseUnit` and `recipeUnitsPerCase > 0`
   → `qty × recipeUnitsPerCase`
2. an `IngredientSkuMatch` whose `fromUnit ≠ toUnit` → `qty × conversionFactor`
   (**identity matches are treated as absent** — they encode "unknown")
3. `convertQty` succeeds → its result
4. otherwise `unconvertible`, qty `null`

`sumDeliveries` is reimplemented over this and returns per-path totals instead
of a bare `partial` boolean. Its callers — `running-on-hand.ts` and
`store-inventory-context.ts` — are updated.

**`src/lib/inventory/theoretical-usage.ts`** (new)
`computeTheoreticalUsage({ storeId, from, to }) → Map<ingredientId, qty>` in
recipe units, walking both:
- `OtterOrderItem` → `OtterItemMapping` → recipe
- `OtterOrderSubItem` → `OtterSubItemMapping` → recipe, with
  `uses = subItem.quantity × orderItem.quantity`

Both branches resolve via `walkRecipeForIngredientSync`, so sub-recipes (house
sauce) traverse correctly. The sub-item traversal mirrors `buildModifierUsage`
exactly; any divergence is a bug in one of the two.

**`src/lib/inventory/conversion-guards.ts`** (new)
- `checkCostConsistency({ spend, deliveredQty, costPerRecipeUnit })` →
  `ok | conversion_suspect`, flagging ratio outside `[0.33, 3.0]`.
- `classifyLambdaPlausibility({ lambda, windows })` → `ok | recipe_suspect`,
  applied **only** when the cost check passes.

**Pack metadata backfill** — a reviewed migration setting `caseUnit`,
`recipeUnitsPerCase` (and `recipeUnit` where null) for the 14 enumerated
ingredients, per the repo's `db push` + hand-written
`prisma/manual-migrations/` convention. Values are read off invoice `packSize` /
`unitSize` where reliable and **confirmed by the owner otherwise** — this is
data entry, not inference, and each value is recorded with its source. A wrong
factor produces a confident wrong waste number.

**Coverage panel** on `/operations/inventory` — every ingredient in exactly one
bucket, with spend:

| Bucket | Meaning |
|---|---|
| `measurable` | conversion resolves, cost check passes, recipe path exists |
| `conversion_suspect` | cost check fails — pack metadata wrong or missing |
| `recipe_suspect` | conversion sound but λ implausible (butter) |
| `no_recipe_path` | purchased, but no mapped recipe or modifier consumes it |
| `non_recipe_consumable` | oil, packaging — excluded by design |

Built with `.inv-panel` and editorial tokens per `DESIGN.md`; no new page, no
nav change.

### Testing

- Unit fixtures on the conversion ladder, one per path. The bun case is
  canonical: `20 CS × 72 = 1,440 each`. **An identity SKU match must not
  short-circuit the case factor** — that is the specific bug being fixed.
- A modifier-inclusive usage fixture: an order with 2× a parent item and 1×
  "Add Tomato" must yield 2 tomato uses.
- Guard fixtures pinning house sauce cup and lettuce as `conversion_suspect`,
  and butter as `recipe_suspect` — asserting the two guards do not collapse
  into one.
- A reconciliation script pinning the λ table above as a regression fixture, so
  a future pack-metadata regression fails a test rather than quietly inflating
  waste.
- Whole-project gate: `npm test && npx tsc --noEmit && npm run build`.

## Out of scope

- Any change to stock counts, `/m/count`, or the count routes.
- The waste ledger, order sheet, and anomaly alerts (increments 2–4).
- A consumption model for fryer oil and packaging. Classified and excluded in
  increment 1; modelling them per-order is its own change.
- Editing recipes to close the butter gap. Increment 1 flags it; the recipe
  change is the owner's call and lands in increment 2.
- `Fuel Surcharge` ($1,254) — a delivery fee carried as a canonical ingredient.
  Already flagged in the pantry ledger design; excluded here too.
- Van Nuys and Glendale. Both are `pre_open`; λ needs trading history.

## Non-goals for increment 1

No waste dollar figure is published. No new page or nav entry. The existing
inventory dashboard keeps its shape — its numbers simply become correct, and
the coverage panel states how much of the pantry it can actually see.
