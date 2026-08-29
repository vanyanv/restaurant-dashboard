# Monitoring · Ingredient audit — measured before building

`P.moningredients`. Measured 2026-08-29 against the live database.

---

## Nothing has ever been auto-matched

The prototype's strip reads **"Auto-matched, 30d — 218, 94.5% held"** and
**"Reverted by hand — 12, 5.5% of auto-matches."**

`IngredientMatchDecision`, every row ever written:

| status | layer | rows | mean confidence | lines linked |
|---|---|---:|---:|---:|
| SHADOW | auto-vector | 13 | 0.750 | 15 |
| SHADOW | auto-llm | 7 | 0.859 | 10 |
| SHADOW | auto-exact | 1 | 0.990 | 1 |
| SUGGESTED | suggest-vector | 11 | 0.503 | 0 |
| SUGGESTED | suggest-llm | 5 | 0.528 | 0 |

**0 rows are APPLIED and 0 have ever been undone.** The feature shipped
2026-07-29 behind `INGREDIENT_AUTO_MATCH` in shadow mode and has stayed there.
A held rate and a revert rate cannot be computed, because nothing was applied
to hold or revert. 21 decisions in a month, not 218.

## The catalogue thinks a fuel surcharge is an ingredient

Two of the 76 canonical ingredients are freight charges:

| canonical | recipes | SKU matches | invoice lines | spend |
|---|---:|---:|---:|---:|
| `fuel surcharge` | 0 | 0 | **154** | **$1,388.99** |
| `miscellaneous charges fuel surcharge` | 0 | 0 | 0 | $0.00 |

154 invoice lines of freight — in seven spellings, `Fuel Charge`,
`FUEL SURCHARGE`, `CHGS FOR FUEL SURCHARGE`, `CHGS For Fuel Surcharge`… — are
matched to a canonical as though they were food. Neither charge canonical is
in a recipe, so **plate cost is not affected**; every by-ingredient spend
figure is. The second one was created by the LLM rung at 0.84 confidence off
a Sysco row printed `Miscellaneous Charge`.

This is the same family as the invoice reconciliation work: those four names
are already declared non-goods in `src/lib/invoice-charges.ts`
(`isNonIngredientRow`). The matcher does not consult it.

## Coverage is the opposite of what the prototype claims

The prototype says 128 unmatched SKUs and $4,120 of spend uncosted. Measured
across all 1,667 invoice lines:

| match source | lines | spend | distinct product names |
|---|---:|---:|---:|
| sku | 1,481 | $376,509 | 457 |
| alias | 159 | −$1,053 | 12 |
| manual | 3 | $138 | 3 |
| (unmatched) | **24** | **$825** | 20 |

98.6% of lines are matched. The alias row is negative because credit memos
match through aliases.

## And the unmatched queue is one can liner

All 24 unmatched lines:

- **19 are supplies from Individual Foodservice**, of which **11 are the same
  can liner** under **the same SKU, 30819**, spelled eleven ways
  (`CAN LINER 40X46 1.5MIL BLK CORELESS`, `Can Liner 40x46 1.5mil Black
  Coreless`, `CAN LINER`, …) — $443 between them.
- **5 are charge rows** — three `Pallet Charge`, one `Miscellaneous Charge`,
  one `Total SALES TAX` — which the ladder **correctly declined**. Those five
  should never match, so the honest unmatched count is 19, not 24.

## What the matcher is actually for

Held-together spellings, per canonical:

| canonical | spellings | lines | spend |
|---|---:|---:|---:|
| imported fresh tomato bulk 5x6 | 24 | 76 | $8,808 |
| lamb potato fry ss 1/4 stealth | 22 | 68 | $38,666 |
| sysco reliable shortening fry liquid | 22 | 66 | $4,456 |
| sysco classic gloves nitrile | 21 | 57 | $2,200 |
| martins bread potato roll 3.5in | 21 | 75 | **$41,038** |

A GROUP BY on `productName` would report the potato roll as twenty-one
separate products. The matcher is what stops that, and it is the number this
page should lead with rather than a revert rate that does not exist.

## Catalogue shape

76 canonical ingredients: 3 have no SKU match, **43 have no recipe**, 3 have
neither. The 43 is the orphan finding already reported on the Ingredients
page — recorded here so the two pages agree.
