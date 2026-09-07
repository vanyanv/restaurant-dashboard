# The dev database, and why an empty one lies to you

`restaurant_dev` (the second Neon, `us-west-2`) is what `.env.local` points at.
`npm run db:seed` gives it an account, an owner, two placeholder stores and six
canonical ingredients — and **nothing else**. Every table the product actually
reads is empty:

```
OtterDailySummary  0     Invoice           0     ForecastDailyRevenue  0
OtterHourlySummary 0     InvoiceLineItem   0     HarriDailyLabor       0
OtterOrder         0     Recipe            0     DailyCogsItem         0
```

That state is not neutral. It is a database that answers every question with
"nothing", and enough of this project's tooling reads the answer as a verdict
about the CODE that it has produced at least four wrong conclusions on the
record:

- **`npm run fidelity` failed and the failures were read as regressions.** The
  Purchasing pages' three failures were the empty range, not a structural
  break. Every gated page that renders figures failed the same way.
- **Phase 0 of the Ask proposal could not establish a baseline**, so Phase 1's
  exit criterion ("golden-set p50 under 6s") and its Decision 3 (nano vs
  5.4-mini) were deferred to a measurement that could never run.
- **A server/client import bug shipped undetected.** `adapters/ask.ts` imported
  two helpers out of `ask-state.ts`, which is `"use client"`, and every stored
  thread opened as "This conversation did not load". Nothing caught it because
  opening a stored thread requires stored threads.
- **The Ask page's presentation work could not be seen at all.** See the last
  section.

## Filling it

Roughly ten minutes, all of it read-only against Otter. Requires
`OTTER_EMAIL`/`OTTER_PASSWORD` in `.env.local`; `OTTER_JWT` may be months
expired and it does not matter — `getOtterJwt()` signs in when the env token is
past its `exp`. **Do not run `scripts/refresh-otter-jwt.ts` for this**: it
pushes the new token to Vercel and GitHub secrets, which is a production change
you did not intend to make.

1. **Give the stores the real account's shape.** The seeded stores are both
   `lifecycleStage: pre_open`, and `shouldSyncStore` is
   `isActive && lifecycleStage !== "pre_open"` — so every Otter job skips them
   and writes nothing, silently and successfully. Set one store `ready`, leave
   the others `pre_open` (that IS the real account: Hollywood trades, Glendale
   and Van Nuys are under construction), and create the `OtterStore` rows.
2. `npx tsx scripts/backfill-otter.ts 120 --daily-only` — ~1 min, 820 rows.
3. `npx tsx scripts/backfill-otter-hourly.ts 120` — ~2 min, 1,884 buckets.
4. `npx tsx scripts/backfill-otter.ts 30 --no-ratings` — ~3 min, the menu
   categories, items and modifiers the `--daily-only` run skips (3,009 rows).
5. `npx tsx scripts/sync-otter-orders.ts --days=14` — ~6 min, 4,312 orders,
   2,000 of them with line-item details drained.

Keep the windows bounded. `restaurant_dev` is on the same free Neon tier that
took production down on 2026-09-02 when its data-transfer quota ran out; 120
days of summaries is a few thousand rows, but `OtterOrder` with details is the
table that grows without bound.

## Hollywood is TWO Otter facilities, not one

This is the trap in step 1, and `scripts/seed-otter-store.ts` falls into it.

Measured over the 15 days to 2026-09-07:

| Otter store | platforms | volume |
|---|---|---|
| `f8f941a6-9c18-49ed-896a-5b2213ba09a4` | `css-pos` only | $29,370 first-party, 1,473 orders |
| `8c836303-8d5d-4c32-b9d1-a1ca5325b191` | `bnm-web`, `doordash`, `ubereats`, `grubhub`, `caviar` | $95,598 third-party, 3,211 orders |
| `3dff7900-1388-4332-8079-091c3bb96eb4` | one `ubereats` order | $20, one day |

One carries the register; the other carries the restaurant's own web ordering
and every marketplace. They are one physical restaurant — a second location
would have its own `css-pos`. `OtterStore.storeId` is deliberately not unique
so that both can point at one `Store`.

`seed-otter-store.ts` seeds **only the highest-revenue UUID**, which is
`8c836303`, and would drop the register's ~$67k a month on the floor. Its own
output warns "verify this is the correct Hollywood location" — this is that
verification, and the answer is that neither UUID alone is.

## What stays empty, and why that is correct

| table | why | what it costs |
|---|---|---|
| `Invoice`, `InvoiceLineItem` | extracted from the owner's mailbox through Microsoft Graph | Invoices, Vendors, ingredient prices |
| `Recipe` | hand-entered in the product | Recipes, menu margin |
| `DailyCogsItem` | the COGS sweep derives it from recipes × sales | COGS, Menu profit |
| `ForecastDailyRevenue` | the nightly Python ML pipeline | Forecasts, the 13 ML tools |
| `HarriDailyLabor` | the Harri API (`scripts/backfill-harri.ts` — not run here) | Labor |

Those pages render their EMPTY STATES, which is correct behaviour and passes
fidelity. Do not read a `no_match` panel on COGS as a bug until there are
recipes.

## What data does not fix: the Ask page's fidelity

With the database filled, `npm run fidelity` passes — 187 tests, 4 skipped, no
failures, 2026-09-07. The Ask page is the one place where that number still
says almost nothing, and the reason is worth knowing before someone tries to
move it:

The harness loads a BARE ROUTE. The prototype's `P.ask` renders an ANSWER, so
the comparison is between two different states, which is why
`e2e/fidelity/manifest.ts` marks this row `report: true` and does not gate it.
Filling the database moved the desk count from 5 landmarks to 7 — and the
`.ch`, `.tbl`, `.sec` and `.drill` the prototype draws are still zero, because
nothing asked a question.

So the presentation work (`src/lib/chat/present.ts` and `AskShow`) is invisible
to this gate BY CONSTRUCTION. Its chart and table exist only in a turn that has
run. The manifest's own note goes further and explains why a fixture would not
help either: the prototype's answer is the output of a cause-attribution model,
which this product declares on the P&L page that it does not have.

**Any plan whose exit criterion is "fidelity gates `/dashboard/ask` at the
prototype's landmark count" is unachievable as written.** That row gates the
day the cause-attribution model exists, and not before. Verify the answer's
chart and table the way they were verified when they shipped: run the tools
against the real rows and hand the results to `presentFor`, then render
`AskAnswerBody` against a known `AskState`.
