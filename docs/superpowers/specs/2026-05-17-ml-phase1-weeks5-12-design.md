# ML Phase 1, Weeks 5–12 — Design

**Date:** 2026-05-17
**Predecessors:** [W1-4 closeout](2026-05-12-ml-phase1-weeks1-4-closeout.md) · [Phase 1 brainstorm](../../../../.claude/plans/can-we-brainstorm-on-snoopy-acorn.md)
**Status:** Design — pending writing-plans

---

## Context shift since the original brainstorm

The original brainstorm scoped W5-8 as the "Growth AI layer" and W9-12 as "operator copilot + feedback loop," assuming 3 active stores and MinTrace deferred to Phase 2. Two realities discovered during W1-4 force a reshape:

1. **Only Hollywood is operational.** Glendale and Van Nuys are physically in construction, expected to open ~mid-June 2026. They cannot train ML models because they have no operations data, not because of bugs or sync gaps. The "3 active stores" scope assumption in the brainstorm (line 7) was wrong.
2. **Hollywood revenue/item discrepancy is 60% median / 100% p95** (from the W1-4 closeout). The closeout explicitly decided MinTrace gets accelerated into Phase 1.

This design reshapes W5-12 to absorb both:

| Window | Original (brainstorm) | Revised (this design) |
|---|---|---|
| W5-8 | Growth AI layer (Features 2.1-2.4) | **W5**: Store-lifecycle onboarding pipeline. **W6-8**: Hierarchical reconciliation (Nixtla `hierarchicalforecast`, Hollywood-first, multi-store-extensible). |
| W9-12 | Operator copilot (chat tools, feedback table, ranker logging) | Growth AI layer (5 opportunity types + comprehensive quality panel). |
| Phase 2 month 4 | Hierarchical reconciliation + decision layer | **Operator copilot** (chat tools, feedback table, ranker logging) slides here. |

**12-week strict envelope preserved.** Operator copilot is the only thing that defers.

---

## Section 1 — W5: Store-Lifecycle Onboarding Pipeline

**Goal:** Build the cold-start path so Glendale and Van Nuys begin producing forecasts the day they open, using Hollywood as a transfer prior. Hard 1-week time-box.

### Components

#### 1.1 `Store.lifecycleStage` field

Enum on the existing `Store` Prisma model: `pre_open | warming_up | ready`. Drives the nightly job behavior:

- `pre_open` → skip training and forecasting entirely; dashboard shows "Opening soon."
- `warming_up` → emit Hollywood-derived transfer forecasts nightly, train native model on accumulating data, refuse to promote native until threshold met.
- `ready` → native model in production, transfer path off, participates in MinTrace (Section 2).

Lifecycle transitions:
- `pre_open` → `warming_up`: ops action (manual flip when the store physically opens).
- `warming_up` → `ready`: automatic, when native model beats transfer-forecast WAPE by ≥5% AND `sampleSize ≥ _MIN_DAILY_HISTORY` (current 60).

#### 1.2 Transfer-forecast writer

New module: `ml/transfer/hollywood_prior.py`. Nightly job, runs for each `warming_up` store:

1. Pull Hollywood's last 7 days of `ForecastDailyRevenue` / `ForecastMenuItem` / `ForecastHourlyOrders`.
2. Compute multiplicative scalar: `scalar = mean(new_store_actuals_trailing_14d) / mean(Hollywood_actuals_same_window)`. If `n_actuals < 7`, use the hand-set initial scalar stored in the new `Store.initialTransferScalar` field. This value is operator-configurable per store at registration; the default value at registration time is left for the operator to set (no codebase default — forces an intentional decision per store).
3. Write rows to the same forecast tables with `forecastSource = 'transfer'`.
4. Widen the prediction intervals (`p10`/`p90`) by a fixed multiplier of ×1.5 to reflect transfer uncertainty.

Fails-soft: if Hollywood has no recent forecasts (shouldn't happen but possible), record a `JobRun` warning and skip the store for that night.

#### 1.3 `ForecastSource` column

New enum column added to `ForecastDailyRevenue`, `ForecastMenuItem`, `ForecastHourlyOrders`: `native | transfer`. Reconciliation status is signaled separately by `reconciledAt != null` (see Section 2) — reconciliation is a transformation, not a source.

#### 1.4 Promotion gate update

`promotion.decide_promotion` gains a third baseline alongside seasonal-naive and baseline-XGBoost: when a `warming_up` store's native model is being evaluated, it must beat that store's transfer-forecast WAPE by ≥5% (in addition to the existing seasonal-naive and baseline gates). When this passes AND `sampleSize ≥ 60`, the store's `lifecycleStage` flips to `ready`.

#### 1.5 UI affordance

Existing dashboard cards that render forecast values (`src/app/dashboard/**`, mobile equivalents in `src/app/(mobile)/m/**`) gain a JetBrains Mono caption "Based on Hollywood patterns · day [N] of [STORE]" when `forecastSource = 'transfer'`. Editorial-docket compliant: hairline rule above the caption, no shadcn `<Card>` changes. No new page in W5.

### Week breakdown

- **Days 1-3**: Schema migration (`Store.lifecycleStage`, `Store.initialTransferScalar`, `ForecastSource` column on 3 forecast tables) + transfer-forecast writer + nightly wiring.
- **Days 4-5**: UI caption + promotion-gate update + smoke test (mark a test store `warming_up` with mocked actuals; verify transfer forecasts appear with widened intervals; flip to `ready` when synthetic native model beats transfer by ≥5%).

### Exit gate (W5 close, hard Friday cutoff)

1. Test store transitioned `pre_open` → `warming_up` → `ready` end-to-end with synthetic actuals.
2. Dashboard renders the transfer-source caption correctly on at least one card.
3. Hollywood unaffected: its forecasts continue to land in `forecastSource = 'native'` rows with no regression in `MlForecastEvaluation` numbers.
4. When GLN/VNYS open in production, the only required action is an ops flip of `lifecycleStage`.

---

## Section 2 — W6-8: Hierarchical Reconciliation (Nixtla `hierarchicalforecast`)

**Goal:** Bring Hollywood's revenue/item discrepancy from 60% median / 100% p95 down to ≤15% median across 7 consecutive nightly runs, using a coherent 3-level reconciliation that is architecturally multi-store-extensible.

### Hierarchy (Hollywood at launch)

```
ForecastDailyRevenue                      (top)
       ↑↓
Σ category_revenue                        (middle — derived from OtterMenuItem.categoryName)
       ↑↓
Σ (ForecastMenuItem.qty × avgPrice)       (bottom — leaves)
```

When GLN/VNYS reach `ready`, an outer chain level wraps the structure (`chain ≈ Σ stores`). Only `forecastSource = 'native'` rows participate in reconciliation — transfer-sourced forecasts are excluded.

### Schema additions

```
ForecastDailyRevenue:
  + reconciledRevenue      Float?
  + reconciledP10          Float?
  + reconciledP90          Float?
  + reconciledAt           DateTime?
  + reconciliationMethod   String?    // "min_trace" for now

ForecastMenuItem:
  + reconciledQty          Float?
  + reconciledAt           DateTime?
  + reconciliationMethod   String?

ForecastHourlyOrders:
  (no reconciliation columns this phase — hourly is not in the hierarchy)

ForecastDailyCategory   (new table)
  id, storeId, date, categoryName, revenue, reconciledRevenue,
  reconciledAt, reconciliationMethod, createdAt, updatedAt
  @@unique([storeId, date, categoryName])

MlReconciliationDaily   (new table)
  id, storeId, date,
  prePctDiscrepancy_median, prePctDiscrepancy_p95,
  postPctDiscrepancy_median, postPctDiscrepancy_p95,
  methodUsed, sampleSize, createdAt
  @@unique([storeId, date])
```

### Pipeline

1. **`ml/reconciliation/hierarchy.py`** — builds the BottomUp `S` matrix and `tags` dict expected by `hierarchicalforecast.HierarchicalReconciliation`. Category metadata comes from `OtterMenuItem.categoryName` (aggregated nightly into `ForecastDailyCategory`).
2. **`ml/reconciliation/reconcile.py`** — calls `HierarchicalReconciliation([MinTrace(method='mint_shrink')])` with base forecasts + historical residuals (sourced from `MlForecastEvaluation` rows shipped in W1-4). Writes reconciled values back via idempotent upsert on `(storeId, date, target)`.
3. **Nightly wiring** in `ml/run_nightly.py`: added after training, before evaluation. Runs only for `lifecycleStage = 'ready'` stores. Fails-soft — on singular matrix, missing categories, or any reconciler exception, the unreconciled point estimates remain and a `JobRun` warning is recorded.

### UI integration

Forecast read helpers (`src/app/actions/forecasts/revenue-forecast-actions.ts` and siblings) gain a `prefer: 'reconciled' | 'raw'` parameter, defaulting to `'reconciled'`. Falls back to raw when `reconciledAt` is null or stale (>48h). Behind a `ML_USE_RECONCILED` env flag, default `true`, so we can flip off in seconds if reconciled outputs misbehave in production.

### Week breakdown

- **W6**: Schema migration + `hierarchy.py` + category-aggregation pipeline + first end-to-end reconciliation run on Hollywood historical data (offline notebook-style verification before any production write).
- **W7**: Nightly wiring + `MlReconciliationDaily` snapshot writer + integration into `MlForecastEvaluation` + read-helper changes behind the flag.
- **W8**: UI flag flips on (default `true`) + 7-day production observation + multi-store extension code path (chain-level reconciliation), unit-tested with two mocked stores but not exercised until GLN/VNYS come online.

### Exit gate (W8 close)

1. Hollywood `MlReconciliationDaily.postPctDiscrepancy_median ≤ 15%` for 7 consecutive nightly runs.
2. Pre/post comparison row in `MlReconciliationDaily` for each of the 7 nights.
3. Read helpers serve reconciled values when present (verified via smoke test of dashboard revenue cards).
4. Multi-store extension code path passes its unit test (`chain ≈ Σ(stores)` with two synthetic stores).
5. `ML_USE_RECONCILED=false` cleanly reverts the dashboard to unreconciled reads (verified via smoke test).

---

## Section 3 — W9-12: Growth AI Layer + Comprehensive Quality Panel

**Goal:** Ship a typed, evidence-cited recommendation feed (5 opportunity types) and a single page that answers "is the ML stack healthy?", both grounded in the reconciled forecasts from Section 2.

**Constraint:** Opportunities fire only for `lifecycleStage = 'ready'` stores. `warming_up` stores show "Building recommendation history" — transfer forecasts aren't confident enough to drive operator action.

### 3.1 `GrowthOpportunity` type + Prisma model

```ts
type GrowthOpportunity = {
  id: string;
  storeId: string;
  asOfDate: string;                  // YYYY-MM-DD
  opportunityType:
    | "reprice"
    | "menu_engineering"
    | "channel_mix"
    | "food_cost_risk"
    | "profit_risk";
  title: string;
  estimatedDollarImpact: number;
  confidence: "low" | "medium" | "high";
  evidence: Array<{ kind: string; ref: string; value: number | string }>;
  caveats: string[];
  suggestedAction: string;
};
```

Union deliberately locks at 5. A comment block in the type file lists the 3 deferred types (`launch_analogue`, `lost_sales`, `weak_promo`) with their data dependency, so the union can extend additively in Phase 2 without churn.

### 3.2 Dollar-impact formulas (`ml/growth/impact.py`)

| Type | Formula | Inputs |
|---|---|---|
| `reprice` | `elasticity × current_units × current_margin × Δprice` | `ml/elasticity/menu_item.py`, `OtterMenuItem.qty`, recipe-cost table |
| `menu_engineering` | `(category_median_velocity − item_velocity) × item_margin × 30` | `OtterMenuItem` 30-day aggregate, recipe-cost table |
| `channel_mix` | `units_shifted × (high_channel_net − low_channel_net)` | `third_party_*` net + `fp_sales_*` net (already synced) |
| `food_cost_risk` | `(forecast_food_cost_pct − target_food_cost_pct) × forecast_revenue × days` | reconciled `ForecastMenuItem × cost_per_unit`, `ForecastDailyRevenue.reconciledRevenue` |
| `profit_risk` | `forecast_revenue − (forecast_labor + forecast_food_cost + fixed_overhead)`, flagged when projected margin < threshold | reconciled forecasts + Harri labor cost + overhead config |

Rule preserved from the original brainstorm: **no tunable multipliers in any formula.** Every input traces to a column.

### 3.3 Generators (`ml/growth/generators/*.py`)

One pure function per type: `(storeId, asOfDate, db) → GrowthOpportunity[]`. Each has a fixture test + an "acceptable-output" specification. Generators read **reconciled** forecast values when present (`reconciledAt != null`), raw values otherwise — same fallback the dashboard uses.

### 3.4 Operator surface: `/dashboard/intelligence/opportunities`

Editorial-docket compliant per CLAUDE.md tripwires:
- Layout: `.inv-panel` panels (hairline-bold border, 2px radius, warm paper). Not shadcn `<Card>`.
- Each opportunity row: `.inv-row` hover pattern (red 4px scaleY accent bar, total turns `var(--accent)`).
- Numbers (dollar impact): DM Sans 500–600 with `font-variant-numeric: tabular-nums lining-nums`.
- Type labels, SKUs, evidence refs: JetBrains Mono.
- Title prose: Fraunces italic.

No chat tools, no feedback capture — those are Phase 2 month 4. The page is a read-only feed.

### 3.5 Comprehensive quality panel: `/dashboard/intelligence/quality`

Single page, four sections, each an `.inv-panel`:

1. **Forecast accuracy.** Per (target × store) table reading `MlForecastEvaluation`. Columns: WAPE, baselineWape (seasonal-naive), enrichedWape, intervalCoverage80 with the `[78%, 82%]` calibration badge.
2. **Hierarchical reconciliation.** Per store: pre/post `pctDiscrepancy_median` and `_p95` from `MlReconciliationDaily`. Sparkline of the trailing 14 days. Threshold flag at 15%.
3. **Per-store lifecycle.** For each store: `lifecycleStage`, days since open, `warmupState`, sample-count progress toward the warmup threshold ("Hollywood: ready · 423 days. Glendale: warming_up · day 12 of ~60. Van Nuys: pre_open").
4. **Operator-gate streak.** 7-day rolling pass count read from the **per-day verifier** (`ml.evaluation.operator_gate_check --as-of`), not from `JobRun.status`. Closes the W1-4 closeout's "Streak counter UI source" open issue. Per-gate breakdown so a single gate failing is visible.

### Week breakdown

- **W9**: Prisma model + types + impact formulas + `reprice` + `menu_engineering` generators + opportunity feed page scaffold.
- **W10**: `channel_mix` + `food_cost_risk` + `profit_risk` generators + opportunity feed page fully styled and live for Hollywood.
- **W11**: Quality panel — sections 1 (forecast accuracy) and 2 (reconciliation). Per-day verifier wired into the read query.
- **W12**: Quality panel — sections 3 (lifecycle) and 4 (gate streak) + 7-day production observation + Phase 1 closeout doc (mirroring the W1-4 closeout pattern).

### Exit gate (W12 close = Phase 1 closeout)

1. All 5 generators produce ≥1 opportunity each for Hollywood on a real production day.
2. Hand-recompute dollar impact for 3 sampled opportunities; all match within 1%.
3. Quality panel renders all 4 sections. Lifecycle section correctly reflects whichever stage GLN/VNYS are in at that point.
4. Operator-gate streak reads from the per-day verifier and matches the W1-4 closeout's per-day verdict format.
5. `MlReconciliationDaily.postPctDiscrepancy_median ≤ 15%` across the trailing 7 nights for any `ready` store.

---

## Schema delta — consolidated

```
Store
  + lifecycleStage          Enum(pre_open, warming_up, ready)  default pre_open
  + initialTransferScalar   Float?    // operator-set, used until 7+ actuals exist
  + openedAt                DateTime? // populated when lifecycleStage flips to warming_up

ForecastDailyRevenue
  + forecastSource          Enum(native, transfer)  default native
  + reconciledRevenue       Float?
  + reconciledP10           Float?
  + reconciledP90           Float?
  + reconciledAt            DateTime?
  + reconciliationMethod    String?

ForecastMenuItem
  + forecastSource          Enum(native, transfer)  default native
  + reconciledQty           Float?
  + reconciledAt            DateTime?
  + reconciliationMethod    String?

ForecastHourlyOrders
  + forecastSource          Enum(native, transfer)  default native

ForecastDailyCategory      (new)
  id, storeId, date, categoryName, revenue,
  reconciledRevenue, reconciledAt, reconciliationMethod,
  createdAt, updatedAt
  @@unique([storeId, date, categoryName])

MlReconciliationDaily      (new)
  id, storeId, date,
  prePctDiscrepancy_median, prePctDiscrepancy_p95,
  postPctDiscrepancy_median, postPctDiscrepancy_p95,
  methodUsed, sampleSize, createdAt
  @@unique([storeId, date])

GrowthOpportunity          (new)
  id, storeId, asOfDate, opportunityType, title,
  estimatedDollarImpact, confidence, evidence (jsonb),
  caveats (text[]), suggestedAction, createdAt
  @@index([storeId, asOfDate])
```

**Migration discipline:** per memory `reference_prisma_migrations.md`, use `prisma db push` against the dev DB plus hand-written files at `prisma/manual-migrations/2026-05-DD_phase1-w5-onboarding.sql`, `..._phase1-w6-reconciliation.sql`, and `..._phase1-w9-growth.sql` (one per section, dated at write time). **Never `prisma migrate dev`** (would reset the Neon production DB).

---

## Test plan

### Python (W5-8)
- `ml/transfer/hollywood_prior.py`: scalar computation with `n_actuals ∈ {0, 1, 7, 14}`; interval widening; failure handling when Hollywood forecasts are absent.
- `ml/reconciliation/hierarchy.py`: S-matrix shape correctness for 3-level Hollywood-only hierarchy; multi-store extension shape for chain ≈ Σ(2 stores).
- `ml/reconciliation/reconcile.py`: MinTrace shrink-method output on a synthetic hierarchy with known closed-form answer; fail-soft on singular matrix; idempotent upsert.
- Promotion gate: warming-up store with native model beating transfer by 6% → flips to `ready`; native model beating transfer by 4% → stays `warming_up`.

### Python (W9-12)
- One fixture test per generator (5 total). Each asserts the opportunity shape, evidence presence, and dollar-impact formula matches a hand-computed value on a known fixture.
- Reconciled-vs-raw fallback in generators: when `reconciledAt` is null, formula uses raw values without exception.

### TypeScript / Vitest
- Forecast read helpers: `prefer: 'reconciled'` returns reconciled when present, falls back to raw when null or stale.
- `ML_USE_RECONCILED=false` env flag cleanly reverts to raw reads.
- Quality panel renders without crash when (a) all stores `ready`, (b) one `ready` + two `warming_up`, (c) one `ready` + two `pre_open` (current state).
- Opportunity feed empty state for `warming_up` and `pre_open` stores.

### Editorial-docket conformance (W11-12)
- Visual smoke check that opportunity feed and quality panel use `--ink`/`--paper`/`--hairline`/`--accent` tokens only — no generic Tailwind colors.
- Number cells use DM Sans 500–600 + `tabular-nums lining-nums`.
- All list rows use `.inv-row` hover.

### CI gates
- `npm test && pytest ml/tests/` must both pass before merge.
- New: a `pytest ml/tests/reconciliation/` subset run nightly against the prior day's production snapshot (no merge gate; alert only).

---

## Roll-back posture

Per the original brainstorm's "revert behind a flag, don't ship and patch" stance:

- **`ML_USE_RECONCILED`** env flag (default `true` from W8) — flip to `false` to revert UI to unreconciled reads. Reconciliation continues to compute and write columns; only the read path changes.
- **`Store.lifecycleStage`** is ops-flippable. If transfer forecasts misbehave for a `warming_up` store, flip it back to `pre_open` (forecasts stop, dashboard returns to "Opening soon").
- **Growth opportunity feed** sits at a new route — if a generator misfires in production, comment out its registration in `ml/growth/generators/index.py` and the type stays in the union without breaking the page.

If any W6 / W8 / W12 exit gate fails, default action is **revert the flag, leave the schema in place, re-spec**. Schema additions are all nullable / optional and don't break existing reads.

---

## Deferred to Phase 2 (month 4)

The original W9-12 "operator copilot + feedback loop" slides to Phase 2 month 4 unchanged in scope:

- Chat tools: `getForecastQuality`, `listGrowthOpportunities`, `explainOpportunity`.
- `MlRecommendationFeedback` table + capture UI (thumbs / dismiss / "already done" on opportunity cards).
- Recommendation-health monitoring panel (acceptance rate, false-positive rate, top data-coverage gaps).
- Feedback → ranking-feature logging (no retraining; data collection only).

**LLM provider note (per `feedback_llm_provider`):** when the chat tools are built in Phase 2, they target the **existing OpenAI integration** already wired into this codebase. Do not introduce Claude / Anthropic SDK as a second provider; the operator-visible benefit doesn't justify doubling the LLM surface.

---

## Open issues from W1-4 — disposition in this design

From the [W1-4 closeout's "Open issues handed to Weeks 5-8" list](2026-05-12-ml-phase1-weeks1-4-closeout.md#L64):

| W1-4 Open issue | Disposition |
|---|---|
| Glendale/Van Nuys have no SUCCEEDED training runs | **Resolved by Section 1** (lifecycle stages + Hollywood-prior transfer model). Will activate when stores physically open. |
| Hollywood `intervalCoverage80` warming up | No action — natural progression, will exit warming-up state automatically as `sampleSize` crosses 14. |
| Gate 4 point-in-time only | Partially addressed: `MlReconciliationDaily` (Section 2) provides historical reconciliation snapshots for the reconciliation dimension. Generalized reconciliation-coverage history (`ForecastReconciliationDaily` or similar) remains deferred to Phase 2. |
| Streak counter UI source reads `JobRun.status` | **Resolved by Section 3.5 (panel section 4)** — quality panel reads the per-day verifier, not `JobRun.status`. |

---

## Acceptance — Phase 1 (W1-12) complete

When all three sections' exit gates pass:
- Hollywood has reconciled, calibrated forecasts (`MlReconciliationDaily.postPctDiscrepancy_median ≤ 15%`, `intervalCoverage80 ∈ [0.78, 0.82]`).
- A typed, evidence-cited recommendation feed renders for Hollywood with 5 opportunity types.
- Quality panel answers "is the ML stack healthy?" without opening a Python notebook.
- When GLN/VNYS physically open, ops flips `lifecycleStage` and forecasts begin automatically with transfer-source labeling.
- Phase 2 month 4 (operator copilot) starts with a fully reconciled forecast stack and a populated opportunity feed to query against.
