# Start a count — measured before building

`P.newcount`, `/dashboard/operations/inventory/count/new`. Measured
2026-08-29.

---

## The wizard's first panel has no data behind it

`P.newcount`'s desk opens with four toggles — **Walk-in**, **Dry store**,
**Line**, **Freezer** — with line counts and a warning that *"leaving the
freezer out means its on-hand keeps drifting from the model"*.

There is no storage area anywhere in this schema. Searching every column in
the database for `%area%`, `%zone%`, `%storage%`, `%location%` or `%shelf%`
returns exactly one row, and it is `User.timezone`.

The only grouping an ingredient carries is `CanonicalIngredient.category`,
and it is a supplier taxonomy rather than a walk route:

| category | ingredients | in a recipe | has a SKU match |
|---|---:|---:|---:|
| Paper/Supplies | 26 | 7 | 26 |
| Dry Goods | 17 | 3 | 17 |
| Beverages | 12 | 10 | 12 |
| Produce | 4 | 4 | 4 |
| Cleaning | 4 | 0 | 4 |
| Dairy | 3 | 3 | 3 |
| Meat | 2 | 1 | 1 |
| Bakery / Frozen / Equipment / Canned and Dry / Other / (none) | 7 | 4 | 5 |

A count sheet grouped by "Paper/Supplies, Dry Goods, Beverages" is not a walk
route, and pretending otherwise would send someone to the walk-in four times.
The page groups by the category that exists and says what it is.

## Nothing has ever been counted

The prototype's sub-header reads **"Weekly count · 34 lines · typically 18
minutes"**. There is no "typically":

| started | store | status | lines |
|---|---|---|---:|
| 2026-05-12 | Hollywood | IN_PROGRESS | 10 |
| 2026-05-12 | Hollywood | ABANDONED | 0 |
| 2026-05-08 | Hollywood | ABANDONED | 0 |
| 2026-05-08 | Glendale | IN_PROGRESS | 0 |

**Four counts have ever been started. None has ever been completed.** Two
were abandoned with nothing entered; two are still open, one of them since 8
May with zero lines. The most recent activity of any kind is 12 May — three
and a half months ago.

10 of the 76 canonical ingredients have ever appeared on a count line, all in
that one session. So there is no "typically 18 minutes", no weekly cadence,
and no last-counted date for 66 of the 76 things a sheet would list.

## What a sheet can honestly say

- **76 canonical ingredients**, of which **33 are in a recipe**. The rest are
  supplies and freight artefacts (see the ingredient audit).
- **Expected on-hand**: `StockCountLine.estimatedQtyAtCount` freezes the
  model's prediction at count time, so it exists only for lines already
  counted — 10 rows, all from May. A sheet cannot print an expected quantity
  for an ingredient nobody has counted.
- The two open counts are the thing to surface: starting a new count on
  Hollywood resumes the one from 12 May rather than creating another
  (`startOrResumeStockCount` returns `resumed: true`), and the page should say
  so before the button is pressed rather than after.

## One dead gate

The existing editorial page calls `hasOwnerAccess(session.user.role)` and
redirects on failure. `Role` holds only `OWNER` and `DEVELOPER` and the helper
accepts both, so the branch is unreachable. Not carried over.
