# Decisions Docket — Design

**Date:** 2026-08-18
**Status:** approved (design); phase 1 shipped (`fe691cd`); reconciliation bug found by phase 1 and fixed (`82487bc`); Harri schedule sync wired (`89213f1`); phase 2 labor lane shipped (`d578975`); forecast bias root-caused and fixed (`90ad7e0`); phase 2 complete (`16bf0c0`); accuracy verified by backtest (`1d3bf3e`); interval calibration built and gated (`72f501f`); TreeSHAP attribution shipped (`4370bc4`); schema drift resolved (`cbc1591`); impact intervals shipped (`327977a`); **phase 3 complete**; phase 4 items 14-15 shipped (`ac8dfeb`); items 16-17 open; **Act I (verdict + vitals) and the ranked action ledger shipped**; **Act II (the week ribbon) shipped**; concept alignment pass (accented labor clause, week-over-week and unfilled counts on the vitals, outlier-gated chips, drawer trimmed to four figures) — the whole visual redesign lived only in the artifact's CSS, and the numbered phases covered data and model work alone, so no phase item ever pointed at a pixel of it. Act I was caught by hand; Act II was still the pre-redesign calendar a day later. Layout work now gets its own items
**Visual spec:** https://claude.ai/code/artifact/88ea5f27-4e1a-43a1-b7ab-cf3c5459d0d0 — the redesigned page rendered in the editorial docket system, plus the model-change ledger. It is the authority on layout, copy, and interaction; this document is the authority on data, scope, and model work.

---

## Problem

`/dashboard/decisions` is named for a job it does not do. It renders three panels at equal
visual weight — a seven-cell calendar, a bulleted briefing, five action cards — none of which
tells the owner what to do first, and the only interactive control does not persist. The
forecast underneath it cannot explain a single one of its numbers.

Measured from source, not from the rendered page:

| Symptom | Evidence |
|---|---|
| Briefing half dead | `get-decisions-view.ts` calls `buildBriefing({ cash: null, lostSales: null, menuEngineering: null, targetCogsPct: null })`. Three of six line generators are unreachable; `cogsLine` always takes its target-less branch |
| Decisions not recorded | `action-card.tsx` holds resolution in `useState`. No status column on `GrowthOpportunity`, no decision table in the schema |
| No money on the calendar | Day cells render `busy` / `normal` / `slow`. `predictedRevenue`, `p10`, `p90` are loaded by `getRevenueForecast` and discarded |
| Accuracy hidden | `recentMape` fetched and dropped. **No file under `src/` reads `MlForecastEvaluation` at all** |
| Fake deadlines | Every `doByDate` is `todayKey + 7`. All five cards show the same date. No total across cards |
| Labor as an arrow | Cell shows `+1` / `−1` / "no schedule". `getLaborProductivity` already returns `scheduledHours` vs `actualHours` per day and `staffedHours` per hour-of-day, and this route never imports it |
| Forecast cannot explain itself | No attribution anywhere in `ml/`. XGBoost computes exact TreeSHAP as a by-product and nothing calls it |

## Model findings that drive the design

From `ml/`, with pinned versions from `ml/requirements.txt` (xgboost 2.1.3, mapie 0.9.1,
hierarchicalforecast 1.5.1, scikit-learn 1.5.2).

- **The forecast predicts on top of its own predictions.** `ml/models/revenue.py:forecast()`
  loops day by day and writes each prediction back into the series
  (`rolling.iloc[-1, rolling.columns.get_loc("revenue")] = pred`) so the next day's lag features
  read it as observed. By day 7, `lag_1` is a guess built on six guesses. `ml/models/menu_item.py`
  and `ml/models/hourly_orders.py` do the same.
- **Intervals are a point forecast with a fudge factor.** Training objective is
  `reg:squarederror`. Intervals come from a MAPIE conformal wrapper calibrated at **one step**,
  then stretched across the horizon by a hand-tuned constant `HORIZON_WIDENING_PER_DAY`. The
  fallback path is `±1.28σ` on a single global `holdout_residual_std`. Tuesday and Saturday
  therefore receive bands of the same shape.
- **The daily revenue model has no labor input.** `ml/features/revenue.py:feature_columns()` is
  15 columns: calendar, lags 1/7/14/28, rolling 7/28/90, growth rate, plus weather and events via
  `enriched_feature_columns()`. Zero labor.
- **The labor loader already exists and is unused by revenue.**
  `ml/features/hourly_orders.py` ships `load_harri_features()` and `harri_feature_columns()` —
  15 labor columns. It queries forward to `CURRENT_DATE + horizon_days`, because published
  schedules are known before the day arrives. **Scheduled labor is a legitimate future covariate,
  not leakage.**
- **`HarriShift` is read by zero ML code.** Only `src/lib/harri-schedule-sync.ts` and
  `src/app/actions/labor-productivity-actions.ts`. It is the only intra-day labor grain, carrying
  `minutes`, `positionCode`, `categoryCode`, and `isVirtual` — an unfilled slot left on the grid.
- **The holiday feature is knowingly incomplete.** `_FIXED_HOLIDAYS` holds 7 fixed dates. The
  module docstring names Mother's Day, Father's Day, Super Bowl and Easter as the ones the plan
  called for, then omits them because they move, on the stated reasoning that lag features absorb
  the drift. For a restaurant they do not — a `lag_7` feature actively mispredicts Mother's Day.
- **Impacts are deterministic algebra.** `ml/growth/impact.py` is pure formulas with no tunable
  multipliers and no uncertainty. `reprice_impact = elasticity × units × margin × Δprice`.
- **Elasticity discards its own standard error.** `ml/elasticity/menu_item.py` fits
  OLS `log(qty) ~ log(price) + weekday dummies` and stores `fitR2`, `sampleSize`,
  `pricePointCount` on `MenuItemElasticity`. The coefficient's standard error — the one number
  saying how far to trust it — is computed implicitly and never kept.
- **Anomalies are raw z-score.** `ml/anomaly/` contains only `zscore.py`, while `AnomalyMethod`
  carries an `ISOLATION_FOREST` value with no implementation. A z-score on a strongly seasonal
  series calls the weekend unusual every weekend.
- **`ForecastDailyRevenue` stamps `generatedAt`.** This is the load-bearing fact behind the causal
  read-out: the forecast produced *before* a decision is, by construction, an estimate of what
  would have happened without it.

## What phase 1 found — measured 2026-08-19

Shipping the report card exposed a broken yardstick within a day, and re-ranked the model work.

**The reconciliation bug (fixed, `82487bc`).** `reconcile_past_forecasts` guarded every UPDATE
with `actual* IS NULL`. It runs nightly at ~06:2x UTC — ~23:2x Pacific — so it stamped each day's
actual while that day's Otter sync was still landing, and the guard made the partial value
permanent. All 20 most recent days were understated (Aug 17: $2,204 stored against $7,178 taken).
841 historical rows repaired; 0 of 1,211 now disagree with source.

Effect on the REVENUE evaluation over the same 26-day window:

| Metric | Corrupted actuals | Clean actuals |
|---|---|---|
| WAPE | 18.1% | 11.5% |
| Interval coverage (80%) | 61.5% | 69.2% |
| Monday bias | +47.7% | −11.1% |
| MAPE at horizon 1d | 30.5% | 10.6% |

**The under-prediction was root-caused on 2026-08-19 (`90ad7e0`).** It was not a modelling
problem at all — it was the same disease as the reconciliation bug, one layer up. `ml-nightly`
ran at 06:00 UTC; the last `otter-sync` before it is 04:00 UTC = 21:00 Pacific, and this store
takes **31.9%** of daily net sales after 21:00, peaking at 22:00-23:00. The newest day in
`load_daily_revenue` was routinely ~68% written, so `lag_1` was a third too low and every
horizon inherited it.

| 1-step over the trailing 45 days | bias | MAPE |
|---|---|---|
| complete history | +3.4% | 14.6% |
| previous day shaved to 68.1% | −7.9% | 19.7% |
| production, horizon 1d, same period | −6.7% | 10.6% |

Shaving one day reproduces production almost exactly. It also explains why bias was negative at
*every* horizon including day 1, where recursion cannot be blamed.

Two hypotheses were tested and dropped before this one:

- **Recursive error compounding** — MAPE flat across horizon. Withdrawn (below).
- **The deployed point model never trains on the calib+holdout tail.** True — `base` is fit on
  the train slice only, leaving 91 days and a 7.3%-higher mean unseen. It sounded sufficient.
  But refitting on the full pool moved MAPE 15.1% → 14.0% and made bias slightly *worse*, so it
  is not the cause. Not shipped. Worth revisiting as a small accuracy gain, not as a bias fix.

Fix: `trim_incomplete_trailing_days` drops trailing dates whose `OtterHourlySummary` coverage
stops short of closing hour — tail only, failing open when coverage is missing. `ml-nightly`
also moves to 10:00 UTC so the previous Pacific day is closed and synced before training.

**Two model findings changed as a result.**

- **Error compounding is withdrawn.** It was ranked the top fix. On clean actuals MAPE is flat
  across horizon — 10.6% at 1d, 10.3% at 4d, 9.7% at 7d, 10.6% at 13d. Compounding would climb.
  The recursive loop in `forecast()` is real but is not costing this store accuracy. Rewriting
  three models to direct multi-horizon would have been ~a week spent on a non-problem. Revisit
  only if the horizon curve steepens at another store.
- **Uniform under-prediction is the new top issue.** Bias is negative on all seven weekdays
  (Mon −11.1%, Wed −11.2%, Thu −9.4%, Sun −6.9%, Tue −5.4%, Fri −3.6%, Sat −0.3%), and the model
  loses to a seasonal-naive `y[t-7]` baseline: 11.5% WAPE against 5.6%. On a stricter join without
  the evaluator's fallback the gap narrows to 10.5% vs 8.3% — the evaluator's
  `_seasonal_naive_baseline` falls back to the row's own actual when `t-7` is missing, which its
  docstring notes biases the baseline toward zero. Either way the trained model does not beat
  "use last week's same day". Likely trend lag: revenue is rising (Monday averaged $6,760 in June,
  $7,169 in July, $7,276 in August) while `roll_28` / `roll_90` pull toward the past. Diagnose
  before building.
- **Interval calibration confirmed, with the direction now known.** Coverage by horizon against
  an 80% target: 1d 71%, 4d 71%, 7d 84%, 8d 97%, 11d 96%, 12d 96%. Too tight near, far too loose
  far out — `HORIZON_WIDENING_PER_DAY` inflating by a fixed slope. Delete it rather than retune.

## Decisions

1. ~~**The page leads with one verdict, not three equal panels.**~~ — **shipped**. Hierarchy is verdict → week →
   ledger. Everything else moves below or into a drawer.
2. ~~**The labor lane sits on the week ribbon, not in the drawer.**~~ — **shipped**. "You are 11
   hours short on Saturday" is the only thing on this page the owner can act on today. (User
   decision, 2026-08-18.) The ribbon itself landed later than the lane it was meant to carry:
   until Act II the lane sat on seven detached cards, under a busy/normal/slow pill the redesign
   had deleted. The week is now one hairline-seamed object — seven columns of forecast revenue
   with the 80% band drawn on the same axis, the peak day in accent, weather and event chips
   under each. `lib/ribbon.ts` owns the geometry so the invariant that matters is testable:
   the whisker's caps land exactly where p10 and p90 would draw as columns of their own.
3. **`DecisionLog` is built.** It is the one new table, and it is the prerequisite for both the
   causal read-out and impact calibration. (User decision, 2026-08-18.)
4. **The report card is always visible and never flattering.** Interval coverage is shown against
   its target even when it misses. A page that admits 74% against a target of 80% earns the right
   to be believed when it says $9,240.
5. **No model work ships without a surface.** Every capability in phase 3 and 4 maps to a specific
   pixel. Nothing is built because it is interesting.
6. **Bands are load-bearing.** The ribbon whiskers, the report card, and the causal read-out all
   rest on the interval meaning what it claims. Interval calibration therefore blocks the causal
   read-out, and is sequenced before it.
7. **The LLM narrates; it never predicts.** The verdict line is generated from a JSON block of
   already-computed facts (forecast, SHAP attributions, labor gap, ranked opportunities). It is
   forbidden from introducing a number not present in that block, and output is validated against
   the block before render. Uses the existing OpenAI integration — no second provider.
   (See `feedback_llm_provider` — OpenAI, not Claude.)
8. **`buildBriefing` is not rewritten.** Its six generators are correct and tested by inspection;
   they are simply starved of inputs. Phase 1 feeds them.
9. **Impacts are ranked on the 25th percentile, not the headline.** A wide, speculative $900 must
   not outrank a tight, dependable $700.
10. **Existing shared actions are not modified.** `getLaborProductivity`, `getCashPositionForecast`,
    `getLostSales` and `getMenuEngineering` are consumed elsewhere. Decisions calls them as-is and
    adapts in its own view layer.

## Scope — phases

Each phase ships on its own. Phases 1 and 2 require **no model work** and deliver the redesigned
page. Phase 3 is where the forecast gets good. Phase 4 is where it starts learning.

| # | Phase | Model work? | New schema? |
|---|---|---|---|
| 1 | Make it honest | No | No |
| 2 | Make it about labor | Feature work only | No |
| 3 | Make the model explain and behave | Yes | Forecast attribution columns |
| 4 | Close the loop | Yes | `DecisionLog` |

### Phase 1 — Make it honest

No model changes. Everything below is already computed somewhere in the repo.

1. **Feed `buildBriefing` its real inputs.** Call `getCashPositionForecast`, `getLostSales`,
   `getMenuEngineering` alongside the existing four, and read `Store.targetCogsPct` for the
   store (null on aggregate). All four are currently hardcoded `null`.
2. **Money on the day cell.** Render `predictedRevenue` with the p10–p90 band. The
   `busy`/`normal`/`slow` bucket survives as secondary emphasis, not as the primary reading.
3. **Report-card footer.** New action reading `MlForecastEvaluation` — `wape`, `baselineWape`,
   `intervalCoverage80`, `sampleSize`. First reader of that table in `src/`. Coverage renders
   against its 0.80 target with an honest miss state.
4. **Real deadlines and a pot total.** Derive `doByDate` from `OpportunityType` rather than
   `todayKey + 7`, and sum the ledger.

### Phase 2 — Make it about labor

5. ~~Labor lane on the week ribbon~~ — **shipped** (`d578975`). Sourced from `HarriShift`
   directly, not `getLaborProductivity`: the lane needs hours per forecast day, and
   `getLaborProductivity` is a history surface. "Needed" is `forecastRevenue / targetSplh`
   where the target is `weekdayTargets()` from `lib/splh` — the store's own median
   $/labor-hour for that weekday. Tolerance reuses `SPLH_TOLERANCE` so this and the SPLH
   chart flag the same days.
6. ~~Day drawer: hourly demand against shift coverage~~ — **shipped** (`16bf0c0`).
   `OPERATING_HOURS` runs 10:00 → 01:00, not 00:00 → 23:00: predicted orders peak at hour 23
   (40.7) and are still 36.4 at hour 0, so a midnight-split axis would break the evening in
   half. Hours 0–1 are read from the following calendar date, matching how `bucketShiftHours`
   lands overnight shifts. Per-hour "needed" uses the store's own orders per labor hour over
   the last 60 days. The flagged stretch is the *longest* run of short hours, not the deepest —
   one shift fixes a three-hour hole.
7. ~~Unfilled-slot flag from `HarriShift.isVirtual`~~ — **shipped**, but demoted. Measured
   11 occurrences in 3,737 shifts over 13 months (0.3%), so it is an occasional flag, not
   the design fixture the visual spec made it. The mockup's "2 slots unfilled" is not
   representative of this store.
8. Harri labor features into the daily revenue model, reusing `load_harri_features()`.
   **Not started** — model work.

**Harri findings, 2026-08-19.** `runHarriScheduleSync` had exactly one caller,
`scripts/backfill-harri-schedule.ts`; it was in no cron or route, so `HarriShift` only moved
when someone ran that script by hand. Its docstring called the endpoint "a backward-looking
source — don't forecast on it", which is false and is why nothing did. Probed live: week +0
returned 64 shifts, week +1 returned 63 (437h, Aug 24-30, published and missing from the
database), weeks +2 and +3 empty — a ~2-week publishing horizon. Now wired into the nightly
Harri cron behind `scheduleSyncWindow()` (7 back for edits, since the sync replaces a week
wholesale; 14 forward for the horizon). Store has only 2 position codes (line-cook-5,
cashier) and 28 staff, so position mix is thinner than the visual spec assumes.

### Phase 3 — Make the model explain and behave

9. ~~TreeSHAP attributions~~ — **shipped** (`4370bc4`). Stored on
   `ForecastDailyRevenue.attribution` (JSONB, additive; applied via manual-migration SQL, not
   `db push`, which wanted to drop `InvoiceSyncLog` and `VercelUsageSnapshot`). Grouped into six
   operator-facing buckets — `is_holiday` is matched before `is_weekend`, since both begin `is_`
   and Mother's Day under "Day of week" would mislead. Small groups fold into the base so the
   waterfall still sums to the forecast. Merged across stores in the view layer, which is valid
   because SHAP is additive.
10. ~~Per-horizon interval calibration~~ — **built and deliberately gated** (`72f501f`).
    `relative_half_widths` measures the coverage quantile of |error| per horizon, with a
    split-conformal finite-sample correction and a monotonicity constraint. But an out-of-sample
    split over pre-fix history gave only 60–76% coverage, because every residual in that history
    came from the model fixed earlier the same day. `CALIBRATION_EPOCH` excludes it, so
    `load_horizon_widths` returns `{}` and `forecast()` keeps the conformal path until ~12
    post-fix runs reconcile. Per-weekday remains out of reach: ~38 rows per horizon is five or
    six per weekday. `reg:quantileerror` not attempted — measured widths address the symptom
    without changing the objective.
11. ~~Direct multi-horizon~~ — **withdrawn 2026-08-19**, see findings above.
12. ~~Diagnose and correct the uniform negative bias~~ — **done**, and it was not trend lag.
    Root cause was a still-open business day plus a train-slice-only estimator; see the accuracy
    section above.
13. ~~Elasticity standard errors; Monte Carlo impact intervals~~ — **shipped** (`327977a`).
    Propagated through each generator's *own* closed form via `interval_for`, not through a
    parallel formula. Ledger ranks on `impactP25`.

    **Known limit:** only `reprice` produces intervals — 12 of 39 rows. The other four
    generators' inputs (velocity medians, channel margins, food-cost forecasts) report no error,
    so their cards show a bare point, and after horizon normalisation they currently fill the
    whole top five. `interval_for` is generic; each generator can adopt it once its inputs learn
    to report uncertainty. Separately, only the *elasticity's* uncertainty is propagated — units
    and margin are estimates too — so every range shown is a floor on the true one.
14. `HarriShift` scheduled-hours features; moving holidays.

### Phase 4 — Close the loop

15. `DecisionLog` — opportunity, state (committed / dismissed with reason / expired), actor,
    timestamps, and **the forecast frozen at commit time**.
16. Causal read-out: actuals against the frozen band, with the interval as the significance test.
17. Isotonic calibration of predicted impact against realized impact, per opportunity type.
18. Interval-based anomalies (a day outside its own 95% band); ~~grounded LLM verdict line~~ —
    **the verdict line shipped** with Act I. `src/lib/decision-verdict-llm.ts` narrates from a
    block of already-formatted figures, and `parseVerdictLine` rebuilds its allowlist from that
    same block, so any digit-run the page did not compute is rejected and the deterministic
    composer renders instead. Principle #7 is enforced mechanically, not by prompt wording.
    Cached in `DecisionVerdict` on (scope, date) + a hash of the fact block: one API call per
    scope per day, re-costed only when a displayed figure moves. Interval-based anomalies remain open.

## Accuracy verification — 2026-08-19

Backtested through the real `train()` + `forecast()` path — not a probe — over 10 chronological
cutoffs from 2026-04-15, 14-day horizons, n=140 predictions scored against actuals.

| | bias | MAPE |
|---|---|---|
| before (train-slice model, partial-day anchor) | −5.4% + ~1.7pp | 10.4% |
| partial-day fix only | −7.1% | 9.6% |
| **shipped (both fixes)** | **−1.9%** | **9.4%** |

The partial-day fix alone accounted for ~1.1pp of MAPE but left a −7.1% bias standing. The rest
was the **deployment refit** (`1d3bf3e`): `base` was fit on the train slice only, so the
estimator that shipped had never seen the newest 20% of the window — 91 days on Hollywood, mean
7.3% higher than training.

**That hypothesis was tested twice and the first test was wrong.** A 1-step probe against a
differently-fit pool said refitting made bias slightly *worse*, so it was dropped. Re-run through
the real pipeline with recursion it improved bias in 7 of 10 cutoffs. A level error compounds
through recursive multi-step forecasting in a way a 1-step probe cannot see — worth remembering
before dropping the next hypothesis on a cheap test.

Dry run of the live enriched path afterwards: promotion gate reports
`enriched WAPE 0.0752 beats baseline-XGB 0.0852 (+11.7%) and seasonal-naive 0.0975 (+22.8%)`.
The model beating seasonal-naive is the comparison that was inverted this morning, when it was
being scored against corrupted actuals.

**Still open:** band widths run $1,986 at day 1 to $2,582 at day 7 on a ~$6–8k forecast, i.e.
±15–20%, and measured coverage is 71% at 1d against 97% at 8d. `HORIZON_WIDENING_PER_DAY` is
visible in that progression. Per-horizon, per-weekday calibration is the next item.

## Verification pass — 2026-08-19

Checking the trailing-day fix for knock-on effects found the same bug in two more loaders and
one dangerous coupling (`8a7d5d9`):

- **`reconciledAt` was being written by the wrong subsystem.** `ml/evaluation/reconcile.py`
  stamped it on every actuals UPDATE, but it is the MinTrace writer's freshness marker for
  `reconciledRevenue` — `isReconciledStale()` gates both revenue and food-cost reads on it.
  Under the old NULL guard that was one stamp per row; with the 35-day re-reconciliation window
  it would restamp 35 days nightly, so `isReconciledStale` would never fire and a stale
  `reconciledRevenue` would be served as current. The backfiller no longer touches it, and
  `ml-status.ts` now reads `actualOrders IS NOT NULL` for "has actuals".
- **Hourly orders had the same still-open-day bug, worse.** `complete_hourly_grid` zero-fills
  gaps, so a day synced to hour 13 had hours 14–23 written as *zero orders* — 31.9% of the
  day's take — into `orders_lag_24` and the hour-of-day rolling means.
- **Menu-item quantities had it too**, via the same reindex-and-fill.
- The guard moved to `ml/features/completeness.py`, shared by all three, working at either
  grain. Live: all three loaders stop at 2026-08-18 with 24 hours on the last day.
- Smaller: Harri cron `maxDuration` 60 → 120 (the schedule sync roughly doubled its work), and
  the Decisions SPLH history window now stops at yesterday so a partial today can't drag a
  weekday median built on ~17 observations.

## Schema drift resolved — 2026-08-19 (`cbc1591`)

Adding the attribution column surfaced that `prisma db push` could not run without
`--accept-data-loss`: the 2026-08-17 audit removed three models from `schema.prisma` and left the
tables in the database. Its note called this harmless because "Prisma ignores tables it doesn't
know about" — true at runtime, false for tooling. Deferring the decision did not keep the data
safe; it made every future migration a data-loss prompt.

Archived all 129 rows to `prisma/manual-migrations/archive/2026-08-19_dead_table_archive.sql` and
verified the archive by replaying it into a scratch schema (61/61, 68/68, metrics JSON
byte-identical). `DbSnapshot` records table *sizes*, not contents, so nothing else held a copy.
Then applied the drops. All seven `Store.yelp*` columns went too — checked first, and no store
carried a businessId, rating, review count or URL; the only non-null value was one
`yelpLastSearch` timestamp.

`npm run db:drift` now reports schema-vs-database differences, and CLAUDE.md requires it before
any schema change.

## Testing

- `buildBriefing` has **no tests today**. Phase 1 adds them: one per generator, covering the
  reachable branches that were previously dead (cash floor negative, stockout present, menu dog,
  COGS over/under/at target).
- View-layer tests follow the existing pattern at `tests/app/dashboard/decisions/translate.test.ts`.
- The report-card action is tested against mocked Prisma per the refactor playbook's contract-test
  approach.
- Whole-project gate stays `npm test && npx tsc --noEmit && npm run build`.

## Out of scope

- Rewriting `buildBriefing`'s generators. They work; they were starved.
- Modifying `getLaborProductivity`, `getCashPositionForecast`, `getLostSales`,
  `getMenuEngineering`. Consumed by other routes.
- Isolation-forest anomaly detection. Once intervals are calibrated, "outside its own band" is a
  better detector with nothing extra to maintain.
- Full uplift modelling. Isotonic calibration delivers most of the value for a fraction of the
  work, and needs far less data.
