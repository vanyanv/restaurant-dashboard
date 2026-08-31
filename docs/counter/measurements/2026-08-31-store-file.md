# The store file — measured before rebuilding it

`P.storecosts`, `/dashboard/stores/<id>`. Measured 2026-08-31.

The page exists and renders **24 of the prototype's 39 landmarks**. This is
not a page that was never built; it is a page built to about two thirds of
its design, and the missing third is the third that carries the operator's
own numbers. What follows is what the schema can actually answer, section by
section, because four of the prototype's panels ask for things this database
does not hold.

---

## The fixed-expense table has no rows. None.

The prototype's widest panel is **Fixed expenses** — "6 lines · each becomes
its own P&L row" — a six-column table of label, amount, cadence, monthly,
prorated-to-range, and an on/off tag.

`StoreFixedExpense` holds **0 rows**, across all three stores. Not few — zero.
The model is in the schema, it has a `storeId` index, `frequency`,
`sortOrder` and `isActive`, and `Store.fixedExpenses` is wired. Nothing has
ever written to it.

So the table is real, the column set is buildable, and every row of it would
be empty on first render. That is the inventory page's situation again ("a
page whose prototype asks for data that does not exist"), and it gets the
same treatment: the section is composed, and it states the absence rather
than drawing six em-dashes and calling it a table.

## Four fixed costs are on file, and only for one store

| store | rent | labor | towels | cleaning | COGS target |
|---|---|---|---|---|---|
| Hollywood | 10,390 | **0** | 238.33 | 3,400 | 30% |
| Van Nuys | — | — | — | — | — |
| Glendale | — | — | — | — | — |

Hollywood's `fixedMonthlyLabor` is **0, not null** — a real zero someone
entered, which is a different reading from "not told us yet" and the page
must not flatten the two. The other two stores carry nothing at all, which
is the same fact the P&L already states in its own words ("neither has rent
on file — so neither appears above rather than appearing at zero").

`fixedMonthlyTowels` is stored as a monthly equivalent of a weekly entry
(238.33 = 55/week), per its own schema comment. The prototype's Operating
inputs panel shows amount, cadence and the monthly equivalent side by side,
which is exactly the conversion this column already performs and hides.

## Platform commissions: the prototype shows three, the schema has two

`Store` carries `doordashCommissionRate` and `uberCommissionRate`. There is
no Grubhub column, and the prototype's panel lists three marketplaces.

Commit `4250112d` already recorded the other half of this: **every commission
rate is a default**. Nobody has ever set one. So the panel would show two
rates, both defaults, against a P&L that prices every marketplace order from
them — which is worth saying on the page, because a wrong rate makes every
third-party margin on the statement wrong and nothing currently flags that
the numbers are untouched.

## The location file is missing two of its five rows

The prototype shows Address, Phone, Geocoded, Event radius, Lifecycle.

- **Address** — present for all three, full formatted strings.
- **Geocoded** — present for all three (Hollywood 34.0982, −118.3105).
- **Lifecycle** — present: Hollywood `ready`, the other two `pre_open`.
- **Phone** — `null` for every store. The column exists; nothing populates it.
- **Event radius** — no column. The prototype's "2.5 miles" is its own
  invention; nothing in this schema parameterises the event-signal radius per
  store.

Three rows of five are real. The other two are a nullable column nobody fills
and a setting that does not exist.

## What the rebuild adds

Against the current 24 landmarks, the prototype's remaining fifteen are:

- **How it reaches the P&L** — the mathline block: monthly → ×12÷365 per day
  → × days in range → charged to this period. Every input is already on the
  page; this panel is arithmetic over them and needs no new data.
- **Fixed expenses** — the table above, composed and empty.
- **Platform commissions / Targets / Where it lands** — the three-up row. Two
  rates, two targets (`targetCogsPct` and the prime ceiling, which is
  `PRIME_CEILING_PCT` and not per-store), and a map of which input lands on
  which P&L row.
- **Edit this file** — the setrow block and its buttons.

And one landmark the page has that the design does not: a **Needs you** queue
with two items. The prototype's store file has no queue.

## The rule this page is the test of

Every figure here lands on the P&L, so every figure here must come from the
one function that computes it — not a second copy that agrees today. The
proration (`×12÷365 × days`) is the same arithmetic the P&L's fixed-cost line
already performs, and the store file must read it rather than restate it.
