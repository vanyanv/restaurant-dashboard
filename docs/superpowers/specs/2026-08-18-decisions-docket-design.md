# Decisions Docket — Design

**Date:** 2026-08-18
**Status:** approved (design); phase 1 shipped (`fe691cd`); reconciliation bug found by phase 1 and fixed (`82487bc`); phases 2-4 unstarted
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

1. **The page leads with one verdict, not three equal panels.** Hierarchy is verdict → week →
   ledger. Everything else moves below or into a drawer.
2. **The labor lane sits on the week ribbon, not in the drawer.** "You are 11 hours short on
   Saturday" is the only thing on this page the owner can act on today. (User decision, 2026-08-18.)
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

5. Labor lane on the week ribbon — scheduled vs. needed hours, from `getLaborProductivity`.
6. Day drawer: hourly demand (`ForecastHourlyOrders`) against shift coverage (`HarriShift`).
7. Unfilled-slot flag from `HarriShift.isVirtual`.
8. Harri labor features into the daily revenue model, reusing `load_harri_features()`.

### Phase 3 — Make the model explain and behave

9. TreeSHAP attributions via `booster.predict(dmatrix, pred_contribs=True)` — exact, no new
   dependency. Top contributors stored per forecast row; rendered as the drawer waterfall.
10. `reg:quantileerror` for conditional quantiles; conformal calibration per horizon step and per
    weekday. `HORIZON_WIDENING_PER_DAY` is deleted, not tuned.
11. ~~Direct multi-horizon~~ — **withdrawn 2026-08-19**, see findings above.
12. Diagnose and correct the uniform negative bias (trend lag against rolling means).
13. Elasticity standard errors persisted; Monte Carlo propagation through `impact.py`.
14. `HarriShift` scheduled-hours features; moving holidays.

### Phase 4 — Close the loop

15. `DecisionLog` — opportunity, state (committed / dismissed with reason / expired), actor,
    timestamps, and **the forecast frozen at commit time**.
16. Causal read-out: actuals against the frozen band, with the interval as the significance test.
17. Isotonic calibration of predicted impact against realized impact, per opportunity type.
18. Interval-based anomalies (a day outside its own 95% band); grounded LLM verdict line.

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
