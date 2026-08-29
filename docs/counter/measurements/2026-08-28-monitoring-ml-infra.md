# Monitoring · Model health and Infrastructure — measured before building

Two tabs, `P.monml` and `P.moninfra`. Measured 2026-08-28/29 against the live
database.

---

## Model health (`P.monml`)

### The prototype's headline is the opposite of what the data says

`P.monml`'s strip claims **"Beat the naive guess — 21 of 30, by $186 a day."**

Measured, across every `MlForecastEvaluation` row that carries both a model
WAPE and a `baselineWape` (the seasonal-naive `y[t-7]` fit on the same rows):

| target | evaluations | beat the baseline | mean WAPE | mean baseline WAPE |
|---|---:|---:|---:|---:|
| REVENUE | 187 | **0** | 11.15% | 7.11% |
| MENU_ITEM | 89 | 64 | 40.33% | 52.80% |
| BUSY_HOURS | 89 | 77 | 37.83% | 74.08% |

**The revenue model has never beaten "the same day last week." Not once in 187
evaluations.** It is a third worse than a one-line baseline, consistently:
newest window 11.89% against 8.48%.

The same pipeline is decisively better than the baseline on the two harder
targets — busy hours by half, menu items by a quarter. So this is not a broken
pipeline; it is a pipeline whose flagship number is the one thing it does not do
well, presented as though it does.

### Gate 2 cannot catch this, by construction

`gate2_seasonal_naive_fired` passes 28 of 28 days. Its detail reads
`REVENUE 6/9 runs mention seasonal-naive`. It checks that the baseline was
**computed**, not that the model **beat** it. A gate can pass every day for a
month while the thing it is named after loses every single time.

### The gates that do fire

30 days of `OperatorGateDailyVerdict`:

| gate | days | passed |
|---|---:|---:|
| gate1_eval_rows_today | 28 | 28 |
| gate2_seasonal_naive_fired | 28 | 28 |
| **gate3_revenue_coverage** | 28 | **9** |
| gate4_reconciliation_health | 28 | 28 |

Gate 3 is a band, not a floor — it fails high as well as low. 2026-08-26 read
`0.886 over 78 rows — BROKEN`; 2026-08-28 read `0.803 over 105 rows — OK`. An
80% interval covering 88.6% of actuals means the intervals are too wide, which
is a real defect and not an obvious one from the word "coverage".

### MENU_ITEM's training MAPE is 8.08 million percent

`MlTrainingRun` for MENU_ITEM records `mape = 80844.6` with status SUCCEEDED
(80,844 as a ratio, i.e. 8,084,463%). MAPE divides by actuals, and per-item
daily quantities are frequently 1 or 0. The number is arithmetic noise. The
page must not print a MAPE for that target; WAPE (28.6%) is the one that means
something.

### Menu-item evaluation grades a model from July, and that is correct

The newest MENU_ITEM evaluation grades `xgboost-815baac6-20260729-0815`. The
model trained yesterday has **0 of its 210 forecast rows reconciled** — you
cannot grade a forecast before the day it forecasts has happened. Reconciliation
accrues down the generations: 22 rows for 08-27, 51 for 08-26, 140 for 08-23,
208 for 08-19. Worth stating on the page so a month-old version string doesn't
read as a stuck pipeline.

### Forecast against actual — last full days, newest generation per date

| date | forecast | actual | miss |
|---|---:|---:|---:|
| 2026-08-27 | $6,735 | $6,992 | −3.7% |
| 2026-08-26 | $6,269 | $6,451 | −2.8% |
| 2026-08-25 | $6,784 | $6,358 | +6.7% |
| 2026-08-24 | $7,202 | $7,518 | −4.2% |
| 2026-08-23 | $8,837 | $9,355 | −5.5% |
| 2026-08-22 | $9,026 | $8,321 | +8.5% |
| 2026-08-21 | $7,396 | $7,685 | −3.8% |

The current day is excluded — 2026-08-28 reads +150% purely because the day is
half-synced.

---

## Infrastructure (`P.moninfra`)

### Every figure in the prototype's strip is roughly 20× the truth

| prototype | measured |
|---|---|
| Database 8.4 GB, ▲210 MB in 30 days | **294 MB** live; snapshot 306 MB, ▲9 MB in 30 days |
| R2 bucket 412 objects, 1.9 GB | **298 objects, 88.4 MB** |
| Tokens — 1 expiring, GitHub 6 days | no expiry data exists in the database at all |
| Connections 12 / 100 | not recorded |

The Tokens panel is the honest casualty. There is no table holding integration
credential expiry; the prototype's five rows are invented. The page says so
rather than printing five green "OK" tags derived from nothing.

### What the database is actually made of

`DbSnapshot.perTable` keeps the top 12 tables only:

| table | size |
|---|---:|
| OtterOrderSubItem | 74.9 MB |
| OtterOrder | 56.5 MB |
| OtterOrderItem | 49.1 MB |
| ForecastHourlyOrders | 20.3 MB |
| ForecastMenuItem | 15.2 MB |
| OtterMenuItem | 12.0 MB |

Order rows are 61% of the database. Every forecast generation ever written is
another 12%.

### Job failures, and the two that are not failures

30 days of `JobRun`:

| job | runs | failures | mean duration |
|---|---:|---:|---:|
| `ml.operator-gate-check` | 31 | **22** | 1.4s |
| `otter.metrics.sync` | 524 | 18 | 10.7s |
| `harri-labor-sync` | 188 | 3 | 4.9s |
| `otter.hourly.sync` | 489 | 1 | 2.0s |
| everything else (11 jobs) | 1,092 | 0 | — |

**`ml.operator-gate-check`'s 22 failures are not failures.** Its metadata on a
FAILURE run reads `"overallPass": false, "gate3RevenueCoverageStrict": false` —
the job ran fine and recorded that a gate did not pass. It exits non-zero to
report bad news. Counting it as an outage inflates the failure count sevenfold
and hides the one job that genuinely breaks.

`otter.metrics.sync`'s 18 failures are real but clustered: every one is
`Otter API error 500: Internal error`, and 5 of them landed inside four minutes
on 2026-08-28 between 15:48 and 15:51. Upstream, not ours. 3.4% of runs.

### Errors are the watchdog, not the application

5 `ErrorEvent` rows in 7 days, all from `cron.staleness` and
`cron.failure-streak`. Zero application errors. The watchdog reports jobs
overdue — which is the same otter 500 burst, seen from the other side.
