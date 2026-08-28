# One ingredient, measured before it was built

`P.ingredient` (`docs/counter/counter-prototype.html:7020`) against the live
account, 2026-08-28. Exemplar: `ground beef fine grnd 73/27 creekstone` — 58
invoice lines, $125,740 all-time, **31.3% of the last thirty days' food spend**
($23,807 of $75,977), in 6 recipes.

The route has never existed. Both the Ingredients catalogue and the Inventory
adapter emit `/dashboard/ingredients/{id}` on every row, and every one of them
has been a 404.

---

## 1. Two of the five strip cells have no data on this account

**`On hand · 36 lb · below a 40 lb par`.** The whole account holds **4 stock
counts, 10 count lines and 0 inventory adjustments**. Ground beef — the single
largest ingredient by spend — has **zero** count lines. There is no on-hand
figure for it, and with 10 lines across 76 ingredients there is no on-hand
figure for almost anything. Same finding as `2026-08-28-inventory.md`, reached
from the other end.

**Confidence, on the matched-SKU table** (`72%` in the fixture).
`IngredientSkuMatch` has no confidence column — `id, ownerId, vendorName, sku,
canonicalIngredientId, conversionFactor, fromUnit, toUnit, confirmedBy,
confirmedAt, accountId, vendorKey`. A row exists because a person confirmed it.
All three of this ingredient's rows are confirmed, and a column that reads
"Confirmed" 73 times out of 73 is not a column.

## 2. Three vendor strings, two vendors — for the third time

| `vendorName` on the invoice | lines | mean $/lb |
|---|---:|---:|
| Premier Meats & Crystal Bay | 54 | $4.45 |
| Premier Meats | 3 | $4.37 |
| Sysco Los Angeles, Inc. | 1 | $4.51 |

`normalizeVendorName` folds rows 1–2 and rewrites row 3 to `Sysco`, so the cell
reads **2**, not 3. This is the same fact the Invoices page reports as
$155,430-not-$104,038 and the Ingredients review inbox reports as a cluster —
now on a fourth page. It is only correct here because the adapter normalizes;
a `COUNT(DISTINCT vendorName)` reads 3.

## 3. The SKU match is looser than the canonical's name claims

Four distinct `(vendor, sku)` pairs carry lines against a canonical named
**73/27 Creekstone**:

| vendor | sku | product on the invoice | lines |
|---|---|---|---:|
| Premier Meats & Crystal Bay | 0014046-01 | Ground beef fine grnd 73/27 Creekstone | 53 |
| Premier Meats | 0014046-01 | GROUND BEEF FINE GRND 73/27 CREEKSTONE | 3 |
| Premier Meats & Crystal Bay | 0014157-01 | Ground Beef 73/27 **Halal** Creekstone | 1 |
| Sysco Los Angeles, Inc. | 1029562 | Beef Ground Bulk **75/25** Chub | 1 |

The last one is a different blend — 75/25, not 73/27 — and the one before it is
halal. Both may be deliberate substitutions and neither is necessarily wrong;
what is wrong is that nothing on any page says the canonical is carrying them.
So the table prints the product name the invoice used, and marks a row whose
name disagrees with the canonical's. Two rows of 58 lines is not a crisis, and
an unremarked substitution inside a $125,740 ingredient is worth one glyph.

The `(Sysco, 1029562)` line also demonstrates `vendorMatchKey` working: the
learned row is stored against `Sysco` and the invoice says `Sysco Los Angeles,
Inc.`, and it matched because the key strips to `sysco`.

## 4. The price FELL, so "Cost of the rise" is the wrong column

Weekly medians, $/lb:

```
Jul 20   4.61
Jul 27   4.44
Aug 03   4.39
Aug 10   4.33
Aug 17   4.39
Aug 24   4.39
```

**−4.8% over eight weeks.** The prototype's strip reads `▲ 18% in 3 weeks`, its
"Used in" table ends in a `Cost of the rise` column, and its narrative
throughout is an ingredient getting more expensive. This one got cheaper.

The column stays and is signed: at 15,470 lb of beef across 90 days of sales,
$0.22/lb is about **$3,400 that did not have to be spent**. A page that can
only phrase that as a loss cannot report the good half of its own data.

## 5. Six recipes, and one of them sells nothing

| recipe | per serving | sold, 90d |
|---|---:|---:|
| Double Slider | 3 oz | 82,506 |
| Single Slider | 1.5 oz | 3,906 |
| Triple Slider | 4.5 oz | 1,212 |
| The Quad | 6 oz | 486 |
| Single Patty | 1.5 oz | 219 |
| **Make it a Triple** | 1.5 oz | **0** |

Recipe quantities are in **oz** and the canonical's `recipeUnit` is **lb**, so
every line cost crosses a unit conversion. The page prints the recipe's own
unit, because that is what someone editing the recipe will type.

## 6. The page works for nearly the whole catalogue

| | of 76 |
|---|---:|
| has invoice lines | 75 |
| has a confirmed SKU match | 73 |
| **is in at least one recipe** | **33** |

So the "Used in" section is empty for 43 of 76 — which is the orphan finding
(`2026-08-28-ingredients.md` §4) seen one ingredient at a time. On those pages
the section says what it means rather than rendering an empty table: this thing
is bought and reaches no plate.

---

## What this changes about the build

1. **`On hand` reports the absence**, and says how many count lines exist
   rather than showing a blank.
2. **`Confidence` becomes what the row actually is** — lines seen, and a mark
   when the invoice's product name disagrees with the canonical's.
3. **Vendors are normalized before counting**, or the cell is wrong.
4. **The move column is signed**, and phrased as saved or spent.
5. **An ingredient in no recipe gets a sentence, not an empty table.**
