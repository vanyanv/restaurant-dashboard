# Product usage, measured before it was built

`P.usage` (`docs/counter/counter-prototype.html`, the `P.usage` block) against
the live account, 2026-08-28. 90-day window.

"What the recipes say you should have used against what you actually bought."

That comparison IS computable here — and every naive way of computing it is
wrong by between 2.7× and 6.6×. This document is mostly about which way is
right.

---

## 1. The aggregate comparison holds

| | 90 days |
|---|---:|
| Theoretical (`DailyCogsItem.lineCost`) | **$175,553** |
| Purchased (invoice lines) | **$179,918** |
| Gap | $4,365, 2.5% over |

Both sides are money and neither needs a unit conversion, so this pair is
trustworthy. The prototype's strip works.

## 2. The per-ingredient comparison in QUANTITY does not

The prototype's table is `Ground beef · 412 lb theoretical · 448 lb purchased`.
Written as SQL that is `SUM(RecipeIngredient.quantity × units sold)` against
`SUM(InvoiceLineItem.quantity)`, and it produces nonsense:

```
ground beef      theoretical 86,433 oz     purchased 12,907   (LB)
potato roll      theoretical 29,870 each   purchased    792   (CS)
house sauce cup  theoretical  5,110 each   purchased    247   (CS)
```

**The purchased quantity is in PACK units and the theoretical is in recipe
units.** Reconciling them needs the pack conversion — `recipeUnitsPerCase`,
`IngredientSkuMatch.conversionFactor` — which is the single most error-prone
number in this product. It is the family
`project_cogs_spike_guard` exists for: a mis-parsed pack inflates a $/unit by
10–200×, and it did, repeatedly.

**Comparing in DOLLARS avoids the conversion entirely.** Theoretical dollars
come out of the recipe walk, which has already converted; purchased dollars are
`extendedPrice` as printed. So the table compares money, and says so.

## 3. Theoretical dollars cannot be computed in SQL either

The obvious `SUM(ri.quantity × ci.costPerRecipeUnit × units)` is wrong, because
**15 of the 91 ingredient lines in this account are written in a unit the
canonical is not priced in**:

| canonical unit | recipe line unit | lines |
|---|---|---:|
| each | each | 57 |
| **gal** | **fl oz** | 8 |
| oz | oz | 7 |
| **lb** | **oz** | 7 |
| lb | lb | 5 |
| *(4 more, matching)* | | 7 |

Multiplying an `oz` quantity by a `per lb` cost puts ground beef at **$379,441**
against a real $23,715 — 16× out. `computeIngredientLineCost` is the function
that converts, `batchRecipeCosts` is what runs it over the account, and the
page uses that rather than arithmetic of its own.

## 4. Sub-recipes have to be flattened, or 62% of the cost has no owner

Attributing only the `kind: "ingredient"` lines of each recipe recovers
**$66,377 of $175,553 — 38%.** Every combo whose cost is entirely sub-recipes
attributes nothing, because its own lines are components.

Flattening each component into its leaf ingredients, scaled by the component
quantity, recovers **$141,598 — 80.7%.**

## 5. The last 19% is real and gets said out loud

The remaining $33,955 is two things the walk cannot attribute to an ingredient:

- **recipes costed by `foodCostOverride`** — the walk falls back to a
  recipe-level figure and there are no ingredient lines under it to divide.
  `2026-08-28-recipes.md` §3 found eight such recipes, two of them sellable;
- **price drift** — `DailyCogsItem.lineCost` was written with the invoice price
  current on that day, and the walk prices at today's. Beef alone moved −4.8%
  over eight weeks.

Chasing it would mean re-walking every day at that day's prices, which is the
materialiser's job and not a page's. So the page reports coverage: **80.7% of
theoretical cost is attributed to a named ingredient**, and the rest is named
as what it is rather than silently dropped or silently absorbed into a
variance.

## 6. Waste has no table

`Waste logged · $520 · 1.2% of COGS` is the prototype's fourth strip cell.
**No table in this schema matches `%waste%`.** There is no waste log, so the
cell is replaced by the attribution coverage above, which is the honest fourth
figure this page has.

## 7. Two of the three segments already have homes

`P.usage` advertises three tabs: Usage, **Menu item costs**, **Vendor prices**.

- Menu item costs is `/dashboard/menu-profit` and `/dashboard/menu/catalog`,
  both rebuilt.
- Vendor prices — "the same item, every vendor that sells it" — is the
  ingredient page's Matched SKUs table and the vendor page's basket, both
  rebuilt this session, and the basket already carries the pack-size caveat
  this comparison needs.

Rebuilding either here would be the same figure computed twice. The page keeps
Usage and links to the other two.

---

## What this changes about the build

1. **The variance table is in dollars, not quantity**, and says why.
2. **Theoretical comes from `batchRecipeCosts`, flattened through
   sub-recipes** — never from SQL arithmetic over `RecipeIngredient.quantity`.
3. **Coverage is a headline figure**, because 19% of theoretical cost has no
   ingredient to attribute it to.
4. **No waste cell.** No waste table.
5. **No Menu item costs or Vendor prices sections.** Both are built elsewhere.
