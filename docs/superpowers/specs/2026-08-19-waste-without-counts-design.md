# Waste & Ordering Without Stock Counts — Design

**Date:** 2026-08-19
**Status:** design approved; increment 1 unstarted
**Decision (owner, 2026-08-19):** no further work on stock counts. Waste and
ordering must be derived from invoices, sales and recipes alone.

---

## Problem

The owner wants two numbers: *how much am I losing to waste*, and *what should
I order*. The repo already contains an inventory engine that answers both —
`running-on-hand.ts`, `depletion-rate.ts`, `reorder-recommendation.ts`,
`calibration.ts`, `waste-clustering.ts` — but every one of them is anchored on
a physical stock count, and **there has never been a completed stock count.**

Production, as of 2026-08-19:

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

### What this method cannot do

Stated plainly, because increment 2 will publish these numbers:

- **It cannot separate waste from inventory drift in a short window.** A week
  where the walk-in was stocked up reads as waste; the week it is drawn down
  reads as negative waste. Only the long-run rate is meaningful. Windows are
  28 days minimum, and λ is reported with a confidence band, never as a
  point estimate on one week.
- **It cannot isolate theft** from over-portioning, trim loss, or spoilage.
  It measures total unexplained shrink. `waste-clustering.ts` can suggest a
  dominant pattern from the residual shape; it cannot prove a cause.
- **It cannot measure anything with no recipe path.** Fryer oil and packaging
  are consumed per order, not per recipe line. They need a separate model and
  are excluded by name rather than silently read as zero waste.

## Data findings that drive the design

Hollywood (`cmexd4zia0001jr04ljkdt9na`), measured 2026-08-19. 180-day window
unless stated.

### The inputs are healthy

- **100%** of $836,858 in 90-day sales maps to a recipe (56 of 74 menu items
  mapped; the unmapped 18 carry no revenue).
- **91.2%** of 90-day purchase dollars are on ingredients that appear in a
  recipe. Only **0.3%** of spend is unmatched to a canonical ingredient.
- `ForecastMenuItem` is live: **1,039 rows, 15 days ahead**, per Otter SKU.
  The ordering model in increment 3 needs no new forecasting work.

### The blocker: 64.7% of delivered dollars are silently dropped

`sumDeliveries` (`src/lib/inventory/usage-math.ts`) converts invoice quantity to
recipe units using `convertQty` alone. Invoices bill in **cases**; recipes
consume `each` / `lb` / `oz` / `leaf`. `convertQty` has no case→unit knowledge,
returns `null`, and the line is skipped — contributing zero delivered quantity
while setting a `partial` flag that no surface acts on.

Only **35.1%** of 180-day delivered dollars ($123,027 of $350,807) convert by
the path in use today. Top failing unit pairs by dollars: `CS → each`
($93,594), `CS → lb` ($63,059), `CS → oz` ($25,235), `CS → gal` ($19,625),
`CS → leaf` ($6,255).

**`IngredientSkuMatch.conversionFactor` is mostly a placeholder: 113 of its
118 rows are identity** (`fromUnit == toUnit`, factor 1) — encoding "unknown",
not "1:1". Only **5 rows carry a real factor.** For the bun SKUs it stores
`CS → CS, ×1`, while the true factor lives on
`CanonicalIngredient.recipeUnitsPerCase` (buns = **72**), which nothing in the
delivery path consults. Correcting the ladder in a probe moved buns from
λ = 0.01 to λ = 0.91.

Measured against the corrected ladder specified below, the same 180 days
resolve as:

| Ladder step | Lines | 180-day spend | Share |
|---|---|---|---|
| 1. Case factor (`recipeUnitsPerCase`) | 978 | $165,164 | 47.1% |
| 2. Real SKU factor (non-identity) | 121 | $40,349 | 11.5% |
| 3. Direct unit conversion | 74 | $123,027 | 35.1% |
| 4. **Unconvertible** | 372 | $22,267 | **6.3%** |

So the ladder alone recovers **93.7%** of delivered dollars. The residual 6.3%
is the pack-metadata backfill target below.

### With conversion fixed, the signal is real

λ per 28-day window, six most recent windows:

| Ingredient | λ | CV | 180-day excess |
|---|---|---|---|
| Ground beef | **1.26** | 0.30 | **+$15,928** |
| Ice cream mix | 1.07 | 0.33 | +$1,135 |
| Buns | 0.91 | 0.36 | −$3,604 |
| Fries | 0.77 | 0.57 | −$10,112 |
| Onion | 13.3 | — | pack metadata wrong |
| Butter | 22.5 | — | pack metadata wrong |

Ground beef is the headline: **~26% more beef purchased than recipes account
for, ≈$16k per half-year**, stable across all six windows. That is the target
finding, obtained with no stock count.

Fries at λ = 0.77 with CV 0.57 is the counter-example — either the recipe
overstates the portion or a large stock drawdown is in the window. It is not
yet a publishable number, which is what the confidence band is for.

### The three failure classes are distinct

Ingredients currently reading theoretical usage of zero are not one problem:

| Class | Ingredients | Cause | Fix |
|---|---|---|---|
| **Modifier-driven** | tomato ($8,357), lettuce ($6,255) | 0 `OtterItemMapping` but **6 and 9 `OtterSubItemMapping`** rows. `loadStoreInventoryContext` loads only `otterItemMapping` — it never walks modifiers, despite **264,466 `OtterOrderSubItem`** rows | Walk sub-items |
| **Conversion only** | house sauce cup ($30,002) | Recipe path is fine (component of 6 recipes); the `CS` conversion is missing | Pack metadata |
| **No recipe path, ever** | fryer oil ($4,156), foam containers ($5,067) | 0 recipes, 0 mappings. Consumed per order, not per recipe | Exclude by name |

`buildModifierUsage` (`src/lib/cogs-materializer.ts:256`) already performs the
correct traversal — sub-item → mapped recipe, `uses = subItem.quantity ×
orderItem.quantity` — and was verified exact across 46/46 rows. It produces
*cost*, not per-ingredient quantity, so a quantity-producing sibling is needed;
the traversal itself is proven and must not be reimplemented differently.

### The pack-metadata gap is small and enumerable

14 ingredients with >$500 of 180-day spend have no `recipeUnitsPerCase`,
totalling **$62,756** of purchases. Not all of that is unconvertible — some
resolves through one of the 5 real SKU factors or through direct unit
conversion — but this is the set that has to be filled in before the residual
6.3% closes. All bill in `CS` with `caseUnit = null`:

| Spend | Ingredient | recipeUnit | Invoice unit |
|---|---|---|---|
| $30,002 | house sauce cup 1.5 oz | each | CS |
| $6,281 | lettuce boston hydroponic | leaf | CS |
| $6,102 | house sauce | oz | CS |
| $3,812 | coke mexican glass | ml | CS |
| $3,562 | hellmann mayonnaise | **null** | CS |
| $2,948 | greeno cup pet 20 oz | each | CS |
| $2,888 | american cheese yellow 160 | each | **LB** |

Overall **50 of 76** canonical ingredients have `recipeUnitsPerCase`. American
cheese is the one case needing a weight→count factor rather than a case factor.

## Decisions

1. **No stock-count work.** Owner decision, 2026-08-19. The count surfaces
   (`/m/count`, `operations/inventory/count/**`) are left in place and
   untouched; nothing new depends on them.
2. **Data integrity ships before any waste number.** λ computed on today's
   data would teach a model the conversion bug. Increment 1 is correctness
   only.
3. **One delivered-quantity converter, with an explicit ladder and no silent
   zero.** An unconvertible line is a reported outcome, never a 0.
4. **One theoretical-usage engine**, walking items *and* sub-items, shared by
   inventory and COGS. Two engines that disagree is the current state and is
   the root of the tomato/lettuce gap.
5. **λ outside a plausibility band flags the ingredient rather than
   publishing.** Mirrors the existing `selectNonSpikeCostIndex` guard.
6. **Non-recipe consumables are excluded by name, not by silence.** Their
   spend is reported as excluded so the waste total is honestly bounded.
7. **λ is reported with a confidence band and a minimum window.** No
   single-week waste dollar figure is published.

## Scope — increments

| # | Increment | Ships |
|---|---|---|
| **1** | **Correct the math.** Conversion ladder, modifier-inclusive usage engine, pack sanity guard, pack metadata for the 14 named ingredients, coverage panel on `/operations/inventory` | Fixes existing wrong numbers + one panel |
| 2 | **Waste ledger.** λ per ingredient with confidence band, dollars, ranked by money | New surface |
| 3 | **Order sheet.** `ForecastMenuItem` → recipes → demand × λ → minus implied on-hand → order qty timed to `VendorLeadTime` | New surface |
| 4 | **Anomaly detection** on window residuals, labelled via `waste-clustering.ts` | Alerts |

**This document covers increment 1.**

### Increment 1 — components

Each unit is independently testable and has one job.

**`src/lib/inventory/delivered-qty.ts`** (new)
`deliveredQtyInRecipeUnit(line, ingredient, skuMatch) → { qty, path }` where
`path` is one of `case_factor | sku_factor | unit_convert | unconvertible`.
Ladder, in order:
1. `line.unit` matches `ingredient.caseUnit` and `recipeUnitsPerCase > 0`
   → `qty × recipeUnitsPerCase`
2. a `IngredientSkuMatch` whose `fromUnit ≠ toUnit` → `qty × conversionFactor`
   (identity matches are treated as absent — they encode "unknown")
3. `convertQty` succeeds → its result
4. otherwise `unconvertible`, qty `null`

`sumDeliveries` is reimplemented over this and returns per-path totals instead
of a bare `partial` boolean. Its current signature is consumed by
`running-on-hand.ts` and `store-inventory-context.ts`; both are updated.

**`src/lib/inventory/theoretical-usage.ts`** (new)
`computeTheoreticalUsage({ storeId, from, to }) → Map<ingredientId, qty>` in
recipe units, walking:
- `OtterOrderItem` → `OtterItemMapping` → recipe
- `OtterOrderSubItem` → `OtterSubItemMapping` → recipe, with
  `uses = subItem.quantity × orderItem.quantity`

Both branches resolve through `walkRecipeForIngredientSync`, so sub-recipes
(house sauce) traverse correctly. The sub-item traversal mirrors
`buildModifierUsage` exactly; any divergence is a bug in one of the two.

**`src/lib/inventory/pack-sanity.ts`** (new)
`classifyPackPlausibility({ lambda, spend, sampleWindows })` → `ok |
pack_suspect`. λ outside `[0.2, 5.0]` on an ingredient with sufficient windows
is `pack_suspect`. Catches onion (13.3) and butter (22.5).

**Pack metadata backfill** — a reviewed migration setting `caseUnit` and
`recipeUnitsPerCase` for the 14 enumerated ingredients. Values are read off
invoice `packSize` / `unitSize` where reliable and confirmed by the owner
otherwise; this is data entry, not inference, and each value is recorded with
its source.

**Coverage panel** on `/operations/inventory` — every ingredient in exactly one
bucket, with spend:

| Bucket | Meaning |
|---|---|
| `measurable` | conversion resolves and a recipe path exists |
| `pack_suspect` | conversion resolves but λ is implausible |
| `no_recipe_path` | purchased, but no mapped recipe or modifier consumes it |
| `non_recipe_consumable` | oil, packaging — excluded by design |

Built with `.inv-panel` and editorial tokens per `DESIGN.md`; no new page, no
nav change.

### Testing

- Unit fixtures on the conversion ladder, one per path. The bun case is the
  canonical fixture: `20 CS × 72 = 1,440 each`. An identity SKU match must
  *not* short-circuit the case factor — that is the specific bug being fixed.
- A modifier-inclusive usage fixture: an order with 2× a parent item and 1×
  "Add Tomato" must yield 2 tomato uses.
- Guard fixtures pinning onion and butter as `pack_suspect`.
- A reconciliation script pinning the λ table above as a regression fixture,
  so a future pack-metadata regression fails a test rather than quietly
  inflating waste.
- Whole-project gate: `npm test && npx tsc --noEmit && npm run build`.

## Out of scope

- Any change to stock counts, `/m/count`, or the count routes.
- The waste ledger surface, order sheet, and anomaly alerts (increments 2–4).
- A consumption model for fryer oil and packaging. They are classified and
  excluded in increment 1; modelling them per-order is its own change.
- `Fuel Surcharge` ($1,326, 180d) — a delivery fee carried as a canonical
  ingredient. Already flagged in the pantry ledger design; excluded here too.
- Van Nuys and Glendale. Both are `pre_open`; λ needs trading history.

## Non-goals for increment 1

No waste dollar figure is published. No new page or nav entry. The existing
inventory dashboard keeps its current shape — its numbers simply become
correct, and the coverage panel states how much of the pantry it can actually
see.
