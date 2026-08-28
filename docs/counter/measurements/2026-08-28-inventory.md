# Inventory, measured before it was built

`P.inventory` (`docs/counter/counter-prototype.html:5730`) against the live
account, 2026-08-28.

This is the first page in the rebuild whose prototype asks, section by section,
for data that does not exist. Not "a smaller gap than the fixture's" — **none**.

---

## 1. What the prototype asks for, and what is behind it

| The prototype's figure | Behind it here |
|---|---|
| On-hand value $9,840 | No completed count. See §2 |
| Items tracked 34, **6 below par** | **No par level exists** — not a column, not a table |
| Last count Aug 14, 7 days ago | **Never.** 4 attempts, all in May, none completed |
| Shrink, 30d 1.2% | No shrink or waste table exists |
| On hand / Par / Variance / Below par table | Two of the four columns have no source |
| Coverage health: 22 predicted / 7 drifting / 5 no model | **0 `IngredientModelState` rows.** No model has ever run |
| On-hand value, 8 weeks | One series point would need one completed count |
| Adjust on hand | **0 `InventoryAdjustment` rows**, ever |

Four stock counts exist on the account, **three of them on Hollywood** (the
fourth is on a store that has not opened, so the page, which is per-store, says
three):

```
2026-05-12  IN_PROGRESS  10 lines   Hollywood
2026-05-12  ABANDONED     0 lines   Hollywood
2026-05-08  ABANDONED     0 lines   Hollywood
2026-05-08  IN_PROGRESS   0 lines   (pre-open store)
```

The fullest of them is ten lines, seven of which are soda syrup — somebody
walked as far as the beverage rack and stopped. `StockCount.status` has never
been `COMPLETED`.

## 2. The on-hand number was wrong, and it is now merely unusable

`computeRunningOnHand` anchors on the most recent COMPLETED count. With none it
falls back to `baseAt = null`, and the integral runs from the first invoice —
2026-01-15, 225 days.

That is the structural problem. On top of it sat a defect, fixed in the commit
before this page: `sumDeliveries` converted an invoice line with `convertQty`,
which is dimensional, and **`InvoiceLineItem.unit` is `CS` on all but a handful
of 1,667 lines** while `recipeUnit` is `each`, `oz`, `gal`, `ml` or `lb`.
Nothing converts a case to an each dimensionally, so every delivery was dropped
and flagged `partial`. Depletion converted fine. The integral was consumption
with no supply.

| Across 76 ingredients | Before | After the pack fix |
|---|---:|---:|
| `partial` | 72 | 14 |
| `deliveriesQty = 0` | 73 | 8 |
| Negative on-hand | 31 | 18 |
| Σ(cost × onHand) | **−$372,975** | **+$166,279** |

Coke Mexican Glass read **−1,694,000 ml** — 4,844 bottles in debt. It now reads
−590,000 ml, which is still absurd, because 225 days of un-anchored integration
does not survive the small per-recipe errors it accumulates.

**So this page states no on-hand quantity anywhere.** Printing −590,000 ml, or
a $166,279 "on-hand value" derived from it, would be the exact defect the
commit before this one removed, one layer up.

`getInventoryStatus` is a live Ask tool returning `onHand`, `daysOfCover`,
`status: REORDER_NOW` and `reorderBy`. Thirty ingredients carry a positive
depletion rate against a negative on-hand, so it answers "what do I need to
reorder?" with thirty urgent ingredients. **The tool is out of this page's
scope and is left alone; it is flagged here because it is live.**

## 3. What IS true, and what the page is built on

- **76 canonical ingredients.** 64 carry a cost, 61 a `recipeUnitsPerCase`, 59
  are complete enough to count (recipe unit **and** cost **and** pack).
- **7 are partly defined** — a unit but no pack, a pack but no cost. Two of
  them are the same mustard packet entered twice at two different costs
  (`mustard packets 5.5 g` at $0.0061/g and `mustard packets 5.5gr` at
  $0.0107/g), which is the vendor-name aliasing of `2026-08-28-invoices.md` §3
  showing up one table over.
- **10 have nothing defined**, and the list explains itself: `fuel surcharge`,
  `miscellaneous charges fuel surcharge`, `ground beef fine grnd 73/27
  creekstone return/cancelled order`. Those are not ingredients. They are
  invoice rows that the auto-matcher promoted into the pantry.
- **$375,594 of costed ingredient has been delivered** in the un-anchored
  window (Σ `InvoiceLineItem.extendedPrice` where a canonical ingredient is
  matched), against **$356,527 the recipes say was used** over the same days
  (Σ `DailyCogsItem.lineCost`, the figure COGS and the P&L read). The gap is
  **$19,067, 5.1% of what came in**, and nothing has ever checked it against a
  shelf.

  Both halves are measured. The obvious alternative — Σ `costPerRecipeUnit` ×
  converted quantity — came to **$666,365**, against $383,935 of invoices ever
  issued, because `costPerRecipeUnit` and `recipeUnitsPerCase` are derived from
  different pack readings on rows the sanity checker has already flagged for
  pack shape. Two measured figures other pages already agree on beat one
  reconstruction of them.
- **Weekly deliveries of costed ingredients**, the last 8 weeks:
  $2,491 · $20,151 · $13,012 · $18,971 · $18,166 · $13,958 · $15,170.
  That is a real series and it is what a count is checked against.
- **0 `VendorLeadTime` rows.** Every `reorderBy` date anywhere in the product
  is computed from `DEFAULT_FALLBACK_LEAD_DAYS`, a constant, not from any
  vendor's actual behaviour. The nightly recompute has never populated it.

## 4. How each section changes its subject

Every section keeps the prototype's shape and landmark sequence.

- **Strip** — from four measurements of stock to four measurements of the gap:
  what has never happened, what is tracked, how long the window has been open,
  and what went into it unchecked.
- **"On hand"** → the ingredient roster with what is *known* about each one:
  unit, cost, pack, and whether it can be counted. Not quantities.
- **"Coverage health"** keeps its three-band bar exactly, and it is a better
  fit than the prototype's: 59 ready · 7 partly defined · 10 not ingredients.
  The prototype's bands measure a model that has never run; these measure work
  that has to happen before a count is possible.
- **"On-hand value, 8 weeks"** → **"Delivered, 8 weeks"**. Same chart, the
  series that exists.
- **"Next count"** → the attempt that stopped, and the button through to the
  count flow that already works at `/m/count`.
- **"Adjust on hand"** → **"What a count would settle"**: $375,594 delivered
  against $356,527 used, and the $19,067 nothing has verified. Three money
  lines, which is what the prototype's slot holds, and the arithmetic is the
  argument for counting.

## 5. On the phone

`P.inventory.phone()` is a counting keypad, not a summary — the prototype's own
note says so. **That keypad already exists and works, at `/m/count`**, with a
session, a pad and a save. It is not Counter-styled, and restyling it is
`P.countnew`'s job (its own manifest row), not this page's.

So the phone surface here is the prototype's landmark shape — head, strip, one
section — reporting the state of the count, with its button going to the keypad
that works rather than to a second one.
