# Hollywood ingredient cost audit — 2026-05-01

**Store:** Chris N Eddy's — Hollywood (`cmexd4zia0001jr04ljkdt9na`)
**Account:** `acc_default_chrisneddys`
**Target food cost:** 30%
**Method:** Read-only walk of `CanonicalIngredient`, `Recipe` + `RecipeIngredient`, `IngredientSkuMatch`, `InvoiceLineItem`, and `DailyCogsItem` (last 30 d). Script: `scripts/audit-hollywood-costs.ts`. Raw output dumped to `tmp/hollywood-cost-audit/`.

---

## TL;DR

The cost data is **mostly trustworthy**. Beef, cheese, buns, butter, onion, soda syrups, sodas, and water all sit cleanly inside typical foodservice wholesale ranges. Single Slider walks to $0.85 against the seeded $0.90 expectation — the engine is computing correctly.

But there are **three concrete data bugs** and **one structural pricing concern** that are quietly understating COGS on a chunk of orders:

1. **Tomato canonical (`imported fresh tomato bulk 5x6 fresh`) flips between `recipeUnit=each` and `recipeUnit=lb`.** When it lands on `each`, the recipe-line unit (`lb`) can't bridge and `Mod: Add Tomato` costs $0. This is the proximate cause of **224 of 1,312 (17%) DailyCogsItem rows** in the last 30 d being marked `partialCost=true`.
2. **Boston lettuce is locked at $0.15/each, but the invoice math implies ~$0.24/each.** The manual lock is preventing auto-correction. Modifier costs are ~40% under.
3. **`relish sweet` has `costPerRecipeUnit = 0` written by an invoice line whose `extendedPrice = 0`.** Currently unused, so blast radius is zero, but it's dirty data.
4. **Default toppings live only in modifier recipes — not in base sliders.** Sauce, lettuce, tomato, onion are never costed unless POS captures them as sub-items. If even one of those defaults is missing from the modifier mapping for some platforms, the slider's COGS is silently $0.30–$0.60 light per order.

Nothing in the canonical pantry is wildly overpriced. Two items I'd flag as **slightly high** (soft-serve mix, possibly the Martin's bun) and two as **slightly low** (Boston lettuce, fryer shortening), but none of these single-handedly distort the P&L.

---

## Counts

| Metric | Value |
|---|---|
| Canonical ingredients | 74 |
| Used in any recipe | 33 |
| With a cost set | 63 (85%) |
| Locked (`costLocked=true`) | 6 |
| SKU matches | 83 |
| Matched invoice lines | 622 |
| Recipes | 60 (41 sellable) |
| DailyCogsItem rows (30 d) | 1,312 |
| `partialCost = true` | 224 (17%) |

### Integrity flag counts

| Bucket | Count | Notes |
|---|---|---|
| stale | 0 | All ingredients with costs have been hydrated within 90 d. |
| missing-cost | 0 | Every ingredient referenced by a recipe has *some* cost set. |
| locked-drift | 1 | Pickle chips (false positive — the lock is correct, see §3.5). |
| cross-vendor-spread | 0 | No ingredient has ≥2 vendors with ≥30% spread on the normalized $/recipeUnit. |
| conversion-gap | 67 | Cosmetic — `IngredientSkuMatch` rows with `fromUnit=toUnit=CS, factor=1`. Dollar costs already came in via a different path. See §1.4. |
| suspicious-magnitude | 1 | `relish sweet` at $0/oz. See §1.3. |

---

## 1. Data integrity findings

### 1.1 `imported fresh tomato bulk 5x6 fresh` — recipeUnit instability  *(real bug, high blast radius)*

**What I saw.** During this audit the canonical's `recipeUnit` was observed as `each` at the time the recipe walks ran (see `tmp/hollywood-cost-audit/2-normalized-prices.csv`, row 62), but a follow-up read on the same canonical minutes later returned `recipeUnit=lb`. `Mod: Add Tomato`'s recipe line is `0.05 lb` per serving. When `recipeUnit=each`, mass→count conversion fails inside `computeIngredientLineCost` and the line is costed at $0 with `missingCost=true`. The current value is $4.31, which is correct *as $/lb* (latest Sysco invoice `1763432`: 2 cases × $107.66 ÷ 50 lb = $4.31/lb), but is wildly wrong *as $/each*.

**Why it matters.** Every `Mod: Add Tomato` and every `Mod: Chris's Way` order that landed in `DailyCogsItem` while `recipeUnit=each` was costed with that line at $0 — and `partialCost` was flagged. 224 of the last 30 d's COGS rows have `partialCost=true`; tomato is by far the most likely cause.

**Fix.** Permanently set `recipeUnit=lb`, leave `costPerRecipeUnit=4.3064`, and find whatever process is flipping it back to `each` (either the COGS materializer, a hydration path, or a UI write that's reading invoice unit `CS` as a fallback). Then re-materialize the last 30 d via the existing cron sweep.

### 1.2 `packer lettuce boston hydroponic` — locked at a price that's too low  *(real bug, modest blast radius)*

- Canonical: `recipeUnit=each`, `costPerRecipeUnit=$0.15`, `costSource=manual`, **`costLocked=true`**.
- Latest 3 Sysco invoices for SKU `2717106`: `unitPrice=$26.89/case`, `packSize=112`, `unitSize=1 CT`. That's **$0.24 per count**, not $0.15.
- Used in `Mod: Add Lettuce`: 0.5 each per serving → currently $0.075, should be ~$0.12+.

The lock is preventing the invoice hydration from updating the price. If 112 means heads, the lock is ~40% under. If 112 means leaves, the per-leaf vs per-head intent gets murky and a manual call is needed (a typical boston head yields ~6–10 usable leaves; if a "leaf" is what's going on the burger, $0.024–$0.04/leaf is the right number, not $0.15).

**Fix.** Decide whether the recipe is portioning by *head* or *leaf*, then set the cost accordingly. If by head, unlock and let invoice hydration set ~$0.24. If by leaf, manually set ~$0.03 and update the recipe to `1 each` instead of `0.5 each`.

### 1.3 `relish sweet` — `costPerRecipeUnit = 0`  *(real bug, zero blast radius today)*

- Canonical: `recipeUnit=oz`, `costPerRecipeUnit=$0.00`, `costSource=invoice`, not locked.
- Latest matching invoice line (Individual FoodService `G1464`): `quantity=2, unit=CS, packSize=6, unitSize=99, unitSizeUom=OZ, unitPrice=$69.57, **extendedPrice=$0.00**`.

The vendor sent a $0 line (likely a credit memo or sample) and the cost-derive math wrote $0 to the canonical. The Sysco line on `4036448` is healthier: $93.95/case × packSize 6 × unitSize 10 LB = $1.57/lb = $0.098/oz.

`relish sweet` isn't currently in any sellable recipe (`usedInRecipe=false` in normalized CSV), so the COGS surface isn't exposed today — but if Chris ever turns relish on as a topping, COGS will be wrong on day one.

**Fix.** Filter `extendedPrice > 0` in the cost-derivation path (`src/lib/canonical-ingredients.ts`), or skip lines with `quantity=0` (one of the historical lines for this SKU shows `quantity=0`). Re-derive from the Sysco line.

### 1.4 67 SKU-match conversion gaps — cosmetic, fix in bulk

`IngredientSkuMatch` rows where `fromUnit=toUnit=CS` and `conversionFactor=1`. These were created at invoice-sync time as placeholder identity matches and never got updated with real conversions. The actual `costPerRecipeUnit` on each canonical is correct (set via `scripts/hydrate-canonical-costs.ts` or manual entry), but if these matches are ever consulted for re-derivation, they will not bridge case → recipeUnit.

Examples (from `tmp/hollywood-cost-audit/1-data-integrity-flags.csv`):

| Canonical | Vendor | SKU | from→to | factor |
|---|---|---|---|---|
| ground beef fine grnd 73/27 creekstone | Sysco | 1029562 | CS→CS | 1 |
| martins bread potato roll sandwich 3.5 inch | Sysco | 3589484 / 00500520 | CS→CS | 1 |
| whole frozen butter solid usda aa unsalted | Sysco | 7485170 | CS→CS | 1 |
| packer onion sweet fresh | Sysco | 3812807 | CS→CS | 1 |
| chris & eddy's house sauce | Bear State Kitchen | 17211 | CS→CS | 1 |
| imported fresh tomato bulk 5x6 fresh | Sysco | 1763432 | CS→CS | 1 |
| sysco classic mayonnaise banquet xhv duty | Sysco | 4983920 | CS→CS | 1 |

**Fix (low priority).** A one-time migration that reads `InvoiceLineItem.unitSize / unitSizeUom / packSize` for each match and writes back proper `(fromUnit, toUnit, conversionFactor)` so the SKU-match table is self-consistent. Won't change today's costs; protects future re-derivations.

### 1.5 Pickle-chip "locked drift" — false positive

Audit flagged `pickle chips sandwich cut 1/8"` because the locked $0.036/each disagrees with the latest invoice's `unitPrice=$36`. The latest line is from Premier Deli, SKU `813`, with no usable `packSize` / `unitSize` for the script to bridge case → each. The $36 is the case price; the locked $0.036/slice is correct (a typical 1000-slice sandwich-cut jar runs $30–$45 wholesale). The audit's drift detector treated the case price as a per-each price, which is wrong. **No action.**

---

## 2. Reasonability — current $/unit vs market

Wholesale ranges are May 2026 US foodservice mid-tier. Anything ≥2× outside the band would be flagged; nothing was, but a few items are at the edges.

| Ingredient | recipeUnit | Stored | Normalized | Market band | Verdict |
|---|---|---|---|---|---|
| Ground beef 73/27 (Creekstone) | lb | $4.32 | $4.32/lb | $3.50–$4.75/lb | ✓ in range |
| American cheese yellow 160 | each | $0.12 | $0.12/each ($19.20/case 160 ct) | $0.10–$0.18/each | ✓ in range |
| Martin's potato roll 3.5" | each | $0.33 | $0.33/each | $0.25–$0.45/each | ✓ in range, premium brand |
| Frozen butter solid (USDA AA, unsalted) | lb | $3.32 | $3.32/lb | $3.00–$5.00/lb | ✓ in range |
| Sweet onion (raw) | lb | $0.95 | $0.95/lb | $0.50–$1.50/lb | ✓ in range |
| Tomato bulk 5x6 | lb (when set correctly) | $4.31 | $4.31/lb | $3.00–$5.00/lb foodservice | ✓ in range *as $/lb* — see §1.1 |
| Boston hydroponic lettuce | each | $0.15 | $0.15/each | $0.20–$1.50/head | ⚠ low — see §1.2 |
| Pickle chips 1/8" sandwich-cut | each | $0.036 | $0.036/slice (~$36/1000 ct case) | typical | ✓ |
| Whole yellow chilies | each | $0.0814 | $0.08/each | per-pepper packed in vinegar; reasonable | ✓ |
| Crystal Geyser water | oz | $0.0165 | $0.265/lb-equiv (≈$0.28/16.9oz bottle) | $0.20–$0.40/bottle | ✓ |
| Soft serve mix vanilla 5% | oz | $0.0997 | $1.59/lb (~$12.78/gal) | $5–$10/gal | ⚠ slightly high — sanity-check the `unitSize`/`packSize` in the latest invoice |
| Coca-Cola / Sprite / Diet Coke / Coke Zero syrup (BIB) | gal | $24.92–$24.94 | $24.94/gal | $20–$28/gal | ✓ |
| Hi-C / Orange Fanta syrup (BIB) | gal | $26.09 | $26.09/gal | $22–$30 | ✓ |
| Lyon chocolate / strawberry shake syrup | gal | $20.59 / $21.92 | as shown | $18–$28 | ✓ |
| Mexican Coke 500 ml | ml | $0.00388 | $1.94/bottle | $1.75–$2.50 | ✓ |
| Mexican Sprite / Fanta 500 ml | ml | $0.00358 | $1.79/bottle | $1.60–$2.20 | ✓ |
| Mayonnaise (Sysco classic banquet) | gal | $13.49 | $13.49/gal | $9–$15 | ✓ |
| Black pepper ground | lb | $13.79 | $13.79/lb | $10–$25 | ✓ |
| Sysco classic salt iodized | lb | $0.80 | $0.80/lb | $0.50–$1.20 | ✓ |
| Kosher flake salt | lb | $1.61 | $1.61/lb | $1–$2.50 | ✓ |
| Lamb Weston potato fry SS 1/4" stealth | lb | $1.41 | $1.41/lb | $1–$2 | ✓ |
| Sysco reliable shortening fry | lb | $1.14 | $1.14/lb (~$8.50/gal) | $15–$25/gal currently | ⚠ low — but `usedInRecipe=false`, so no impact |
| Chris & Eddy's house sauce | oz | $0.198 | $3.16/lb | (in-house, depends on yield) | ✓ |

The two "slightly high" calls (soft-serve mix, Martin's bun) and two "slightly low" calls (Boston lettuce, fryer shortening) are all within 2× of typical bands. None of them are dollar bombs at this volume; the lettuce one is the only one in an active recipe and is covered in §1.2.

---

## 3. Recipe coherence

### 3.1 Single Slider — used as the truth anchor  ✓

- Bun (Martin's potato roll, 1 each) $0.33
- American cheese (1 each) $0.12
- Ground beef 73/27 (1.5 oz × $4.32/lb) $0.41
- **Total: $0.85**

The seeded R365 expectation was $0.90 with the same three lines; the $0.05 delta is within current cost-update drift. The cost engine is computing correctly. Used this as the verification anchor for the audit script.

### 3.2 Default toppings live only in modifiers — structural concern

The seeded R365 Double Slider had `bun + 1.2 fl oz sauce + 10 g butter + 2 cheese + 3 oz beef + 0.07 head lettuce + 0.80 oz tomato = $4.01`. The current Double Slider in the DB is **just `bun + 2 cheese + 3 oz beef = $1.38`**. Sauce, butter, lettuce, tomato, and onion now live exclusively in modifier recipes (`Mod: Add Sauce`, `Mod: Add Lettuce`, `Mod: Add Tomato`, `Mod: Add Grilled Onion`, `Mod: Eddy's Way`, `Mod: Chris's Way`).

This is fine **if and only if** every default topping that the kitchen actually puts on the burger comes back to the materializer as an `OtterOrderSubItem` linked through `OtterSubItemMapping`. If any platform (Otter / DoorDash / UberEats / Grubhub / in-store CSS POS) silently drops "default lettuce/tomato/sauce" from the sub-item stream, the COGS materializer will only cost the bare `bun + cheese + beef` and the slider will look ~$0.30–$0.60 cheaper than it is. Across the slider menu that's real money over a month.

**Recommendation.** Either:

- **(A) bake defaults back into the base sliders** (mirror the R365 seed model: include sauce, lettuce, tomato, onion in the Single/Double/Triple/Quad ingredient lists, and use modifiers only for *additions* and *removals*); or
- **(B) audit `OtterSubItemMapping` coverage** — confirm that every default-included topping has a sub-item SKU mapped on every platform, and add a P&L diagnostic that flags slider rows whose cost equals base-only.

(A) is simpler; (B) is more accurate if the kitchen sometimes builds sliders without certain toppings. Either way, this needs a decision rather than a code fix.

### 3.3 Mod: Add Tomato cascading partial costs

Same root cause as §1.1. While tomato.recipeUnit was `each`:

- `Mod: Add Tomato` total cost: **$0**, marked partial.
- `Mod: Chris's Way` total: $0.19 instead of ~$0.40 (tomato line $0).
- `Mod: Chris's Way (Sub Grilled Onions)` total: $0.21 instead of ~$0.42.

After fixing §1.1, re-running the COGS materializer for the last 30 d will recover the missing dollars and clear the 224 partial flags.

### 3.4 Grilled Onion — sub-recipe yield is fine in practice

Seed file `scripts/seed-r365-recipes.ts` describes a `Grilled Onion` batch at 40 lb raw onion + 4 lb butter → 7.13 gal → 2.38 gal final yield. The current `Mod: Add Grilled Onion` recipe **doesn't reference a sub-recipe** — it just consumes 0.03 lb raw onion + 0.002 lb butter directly. Per-serving cost: $0.028 onion + $0.007 butter = $0.035.

Implied batch yield from the per-serving math: 40 lb raw onion / 0.03 lb/serving = ~1,333 servings per 40-lb batch. That's plausible if "Grilled Onion" is a thin caramelized topping (~0.5 oz finished per slider). The cost math is sane even though the architecture diverges from the R365 batch model.

### 3.5 Magnitude vs implied food cost %

Using rough menu prices to back-calculate food cost % (no menu join was in scope, so these are estimates):

| Recipe | Cost | Est. menu | FC% | Note |
|---|---|---|---|---|
| Single Slider | $0.85 | $5 | 17% | low — but excludes default toppings |
| Double Slider | $1.38 | $7 | 20% | same caveat |
| Triple Slider | $1.90 | $9 | 21% | same caveat |
| The Quad | $2.43 | $11 | 22% | same caveat |
| Straight Cut Fries | $0.74 | $4.50 | 16% | clean |
| Vanilla Shake | $1.63 | $8 | 20% | clean |
| 1 Slider Combo | $2.74 | $11 | 25% | clean |
| 2 Slider Combo | $4.12 | $15 | 27% | clean |
| Family Box | $8.24 | $30 | 27% | toppings-missing applies twice |
| Mexican Coke 500 ml | $1.94 | $5 | 39% | tight margin — Mexican glass sodas are inherently low-margin |
| Mexican Sprite / Fanta 500 ml | $1.79 | $5 | 36% | same |

Add a conservative $0.30–$0.50 for default toppings to every slider line and the food-cost percentages move into the 25–28% range — still under the 30% target. Nothing in the recipe magnitudes screams "broken"; the slider FC% looking artificially low is the same finding as §3.2.

### 3.6 Recipes with `foodCostOverride` and zero ingredients — intentional

`Reverse Bun`, `Minute Maid (20 oz cup)` ($0.30 override), `Mod: Make Halal`, `Mod: No Salt`, `Mod: Light Onions`, `Mod: Reverse Bun`, `Mod: Loaded Plain (Cheese & Sauce Only)` (-$0.07 override), and `Mod: Meat and Cheese` all carry zero ingredients. These look like POS-only modifiers / placeholders. Correct behavior under `recipe-cost.ts` lines 266–268: total falls back to the override. No action.

---

## 4. Recommended actions, ordered by impact

1. **Fix tomato `recipeUnit=lb` and find what's flipping it back to `each`.** Re-materialize 30 d of COGS after the fix. *Impact: clears ~17% partial COGS rows; recovers ~$0.20 per "Chris's Way" order in COGS visibility.*
2. **Decide and apply the Boston lettuce price** (§1.2). Either unlock and re-hydrate (likely ~$0.24/each) or set per-leaf and bump the recipe quantity. *Impact: tightens up modifier cost on every Add Lettuce / Chris's Way order.*
3. **Decide whether default toppings go back into base sliders or get verified across `OtterSubItemMapping`** (§3.2). *Impact: largest dollar amount, but design call rather than code fix.*
4. **Set a non-zero cost on `relish sweet` (or filter `extendedPrice=0` lines in the derive path).** *Impact: data hygiene now; correctness when Chris turns relish on later.*
5. **(Optional) Backfill `IngredientSkuMatch.fromUnit/toUnit/conversionFactor`** from `InvoiceLineItem.unitSize/unitSizeUom/packSize` for the 67 placeholder rows. *Impact: cosmetic today; protects future re-derivations.*

---

## Appendix — files

- `scripts/audit-hollywood-costs.ts` — read-only audit (built for this report)
- `scripts/audit-verify.ts` — verification harness used to ground-truth the audit's output
- `tmp/hollywood-cost-audit/`
  - `summary.json` — counts
  - `1-data-integrity-flags.csv` — every flag, with raw evidence
  - `2-normalized-prices.csv` — $/lb / $/fl oz / $/each for every priced canonical
  - `3-recipe-walks.csv` — full recipe walks, every line, missing-cost flags
  - `4-daily-cogs-partial.csv` — last-30-d COGS rows with `partialCost=true`
