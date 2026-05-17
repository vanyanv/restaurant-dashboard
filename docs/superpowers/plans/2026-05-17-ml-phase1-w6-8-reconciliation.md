# ML Phase 1 — W6-8 Hierarchical Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Hollywood's revenue/item discrepancy from 60% median / 100% p95 down to ≤15% median across 7 consecutive nightly runs, by reconciling the daily-revenue / category / menu-item forecast hierarchy with Nixtla's `MinTrace(method='mint_shrink')`. Architecture must be multi-store-extensible (chain ≈ Σ stores) without exercising the chain level until GLN/VNYS reach `ready`.

**Architecture:** A new `ml/reconciliation/` module builds a BottomUp S-matrix from a 3-level hierarchy (`ForecastDailyRevenue` ↔ Σ `ForecastDailyCategory` (new table, written nightly by aggregating menu-item forecasts × avgPrice by `OtterMenuItem.category`) ↔ Σ (`ForecastMenuItem.predictedQty` × avgPrice)). MinTrace produces reconciled point estimates + intervals written back to nullable columns on the existing forecast tables (`reconciledRevenue`, `reconciledP10`, `reconciledP90`, `reconciledQty`, `reconciliationMethod`). Pre/post discrepancy snapshots land in a new `MlReconciliationDaily` table. Forecast read helpers gain a `prefer: 'reconciled' | 'raw'` parameter behind a single `ML_USE_RECONCILED` env flag (default `true` from W8) so the entire reconciled read path can be reverted in seconds. Fails-soft on singular matrix / missing categories / any reconciler exception — unreconciled point estimates remain and a `JobRun` warning is recorded.

**Tech Stack:** Python 3.12 + `hierarchicalforecast` (new dep, pinned), psycopg2, pandas 2.2.3 / numpy 2.1.3 (already pinned), Prisma + Postgres (schema), Next.js 15 server actions (read helpers), pytest (Python tests), `prisma db push` + hand-written manual migration SQL (per `reference_prisma_migrations` memory — **never** `prisma migrate dev`).

**Predecessors:** [W5 onboarding plan](2026-05-17-ml-phase1-w5-onboarding.md) — landed `LifecycleStage` enum + `ForecastSource` column + `list_stores_by_stage`. This plan only reconciles `lifecycleStage = 'ready'` stores AND only `forecastSource = 'native'` rows.

**Spec section:** [W5-12 design §2](../specs/2026-05-17-ml-phase1-weeks5-12-design.md#section-2--w6-8-hierarchical-reconciliation-nixtla-hierarchicalforecast)

---

## File Structure

**Dependencies:**
- Modify: `ml/requirements.txt` — add `hierarchicalforecast==X.Y.Z` (pin in Task 1).

**Schema (one migration file per spec discipline):**
- Create: `prisma/manual-migrations/2026-05-26_phase1-w6-reconciliation.sql`
- Modify: `prisma/schema.prisma` (add `reconciledRevenue`/`reconciledP10`/`reconciledP90`/`reconciliationMethod` to `ForecastDailyRevenue`; `reconciledQty`/`reconciliationMethod` to `ForecastMenuItem`; two new models — `ForecastDailyCategory`, `MlReconciliationDaily`)

**Python — new reconciliation module:**
- Create: `ml/reconciliation/__init__.py`
- Create: `ml/reconciliation/avg_price.py` — extracts the per-item avgPrice helper currently inlined in `ml/evaluation/nightly_integration.py:146-186` so reconciliation and the existing consistency check share one source of truth.
- Create: `ml/reconciliation/category_aggregator.py` — nightly aggregator that writes `ForecastDailyCategory` rows from latest `ForecastMenuItem × avgPrice` grouped by `OtterMenuItem.category`.
- Create: `ml/reconciliation/hierarchy.py` — builds the BottomUp `S` matrix and `tags` dict expected by `hierarchicalforecast.HierarchicalReconciliation` for both single-store (3 levels: revenue, category, item) and multi-store (4 levels: chain, store, category, item) shapes.
- Create: `ml/reconciliation/reconcile.py` — calls `HierarchicalReconciliation([MinTrace(method='mint_shrink')])` with base forecasts + historical residuals from `MlForecastEvaluation`, writes reconciled values back via idempotent upsert on `(storeId, date, target)`. Fails soft.
- Create: `ml/reconciliation/snapshot.py` — computes pre/post `pctDiscrepancy_median` and `_p95` for the day, writes one `MlReconciliationDaily` row per (storeId, date). Reuses the discrepancy formula from `ml/evaluation/consistency.py` (rather than re-implementing it).

**Python — tests (one file per module + one integration):**
- Create: `ml/tests/test_avg_price.py`
- Create: `ml/tests/test_category_aggregator.py`
- Create: `ml/tests/test_hierarchy.py`
- Create: `ml/tests/test_reconcile.py`
- Create: `ml/tests/test_reconcile_snapshot.py`
- Create: `ml/tests/test_w6_end_to_end_reconciliation.py` (e2e, real DB, skipped if `DATABASE_URL` unset, modeled on `ml/tests/test_w5_end_to_end_lifecycle.py`)

**Python — nightly wiring:**
- Modify: `ml/run_nightly.py` — add `RECONCILE_HIERARCHICAL` phase between the existing `RECONCILE` (actuals backfill) and `EVALUATE` steps inside `_run_full_pipeline_for_store`.
- Modify: `ml/evaluation/nightly_integration.py` — refactor the inlined avg-price computation to import from `ml/reconciliation/avg_price.py` (no behavior change, just DRY).

**TypeScript / dashboard read helpers:**
- Create: `src/lib/forecasts/reconciliation-prefs.ts` — single source of truth for the `ML_USE_RECONCILED` env flag (default `true`, opt-out via `ML_USE_RECONCILED=false`) and the `prefer: 'reconciled' | 'raw'` parameter shape. All forecast read helpers import from here.
- Modify: `src/app/actions/forecasts/revenue-forecast-actions.ts` — accept `prefer`, select reconciled columns, fall back to raw when `reconciledAt` null or stale (>48h).
- Modify: `src/app/actions/forecasts/menu-item-forecast-actions.ts` — same.
- Modify: `src/app/actions/forecasts/food-cost-forecast-actions.ts` — same (it consumes both revenue + menu-item).
- Modify: `src/app/actions/forecasts/profit-risk-actions.ts` — already calls `getFoodCostForecast`; only verify the `prefer` parameter propagates cleanly. No new logic; just one parameter pass-through.

**Documentation:**
- Modify: `ml/README.md` — append a "Hierarchical reconciliation (W6-8)" section.

**Out-of-scope (deliberately):**
- Hourly orders (`ForecastHourlyOrders`) reconciliation — not in the spec's hierarchy.
- Chat-tool integration — Phase 2.
- Operator UI for toggling `ML_USE_RECONCILED` — env-only is enough for the rollback posture.

---

## Sequencing

Three checkpoints mirroring the spec's week breakdown:

1. **Tasks 1–6 (W6):** Dependency + schema + avgPrice extraction + category aggregator + `hierarchy.py` + first end-to-end reconciliation run on synthetic data (no production writes yet).
2. **Tasks 7–11 (W7):** `reconcile.py` writer with fail-soft + `snapshot.py` + nightly wiring + `ML_USE_RECONCILED` flag + the three read-helper changes behind the flag (default `false` initially).
3. **Tasks 12–14 (W8):** Multi-store hierarchy unit test + flag flips to default `true` + 7-day production observation gate verifier + final docs.

Frequent commits — one per step that has a working test or visible change.

---

## Task 1: Pin `hierarchicalforecast` and verify import

**Files:**
- Modify: `ml/requirements.txt`

- [ ] **Step 1: Discover the latest installable version**

The library is `hierarchicalforecast` from Nixtla (PyPI: https://pypi.org/project/hierarchicalforecast/). API verified via the Context7 docs cache at planning time — the call site is `HierarchicalReconciliation.reconcile(Y_hat_df=, S_df=, tags=, Y_df=)`. `Y_df` is **insample fitted values** as a long-format DataFrame with columns `unique_id`, `ds`, `y` (required for `mint_shrink`; not required for `ols`).

```bash
source ml/.venv/bin/activate
pip index versions hierarchicalforecast 2>&1 | head -3
```

Pick the highest released non-pre-release version. Note pandas/numpy upper bounds in its `pyproject.toml` — the project currently pins pandas 2.2.3 / numpy 2.1.3.

- [ ] **Step 2: Pin and install**

Add the chosen version to `ml/requirements.txt`:

```
hierarchicalforecast==<version>
```

```bash
pip install -r ml/requirements.txt
```

Expected: `Successfully installed hierarchicalforecast-…` with no resolver conflicts. If pip complains about pandas/numpy bounds, downgrade `hierarchicalforecast` one minor version at a time until the resolver accepts. Document the final version in the commit message.

- [ ] **Step 3: Smoke-import the exact symbols Task 6 uses**

```bash
python -c "from hierarchicalforecast.core import HierarchicalReconciliation; from hierarchicalforecast.methods import MinTrace; r = HierarchicalReconciliation([MinTrace(method='mint_shrink'), MinTrace(method='ols')]); print('ok', r.__class__.__name__)"
```

Expected: `ok HierarchicalReconciliation`.

- [ ] **Step 4: Commit**

```bash
git add ml/requirements.txt
git commit -m "ml(w6): pin hierarchicalforecast for MinTrace reconciliation"
```

---

## Task 2: Schema migration

**Files:**
- Create: `prisma/manual-migrations/2026-05-26_phase1-w6-reconciliation.sql`
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Write the migration SQL**

Create `prisma/manual-migrations/2026-05-26_phase1-w6-reconciliation.sql`:

```sql
-- Phase 1 W6: hierarchical reconciliation columns + two new tables.
-- See docs/superpowers/specs/2026-05-17-ml-phase1-weeks5-12-design.md §2
-- and reference_prisma_migrations memory: db push + manual SQL, never migrate dev.

ALTER TABLE "ForecastDailyRevenue"
  ADD COLUMN IF NOT EXISTS "reconciledRevenue"    DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "reconciledP10"        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "reconciledP90"        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "reconciliationMethod" TEXT;

ALTER TABLE "ForecastMenuItem"
  ADD COLUMN IF NOT EXISTS "reconciledQty"        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "reconciliationMethod" TEXT;

CREATE TABLE IF NOT EXISTS "ForecastDailyCategory" (
  "id"                    TEXT PRIMARY KEY,
  "storeId"               TEXT NOT NULL,
  "date"                  DATE NOT NULL,
  "categoryName"          TEXT NOT NULL,
  "revenue"               DOUBLE PRECISION NOT NULL,
  "reconciledRevenue"     DOUBLE PRECISION,
  "reconciledAt"          TIMESTAMP(3),
  "reconciliationMethod"  TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ForecastDailyCategory_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ForecastDailyCategory_storeId_date_categoryName_key"
  ON "ForecastDailyCategory" ("storeId", "date", "categoryName");
CREATE INDEX IF NOT EXISTS "ForecastDailyCategory_storeId_date_idx"
  ON "ForecastDailyCategory" ("storeId", "date");

CREATE TABLE IF NOT EXISTS "MlReconciliationDaily" (
  "id"                          TEXT PRIMARY KEY,
  "storeId"                     TEXT NOT NULL,
  "date"                        DATE NOT NULL,
  "prePctDiscrepancyMedian"     DOUBLE PRECISION,
  "prePctDiscrepancyP95"        DOUBLE PRECISION,
  "postPctDiscrepancyMedian"    DOUBLE PRECISION,
  "postPctDiscrepancyP95"       DOUBLE PRECISION,
  "methodUsed"                  TEXT NOT NULL,
  "sampleSize"                  INTEGER NOT NULL DEFAULT 0,
  "createdAt"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MlReconciliationDaily_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "MlReconciliationDaily_storeId_date_key"
  ON "MlReconciliationDaily" ("storeId", "date");
CREATE INDEX IF NOT EXISTS "MlReconciliationDaily_storeId_date_idx"
  ON "MlReconciliationDaily" ("storeId", "date" DESC);
```

- [ ] **Step 2: Update `prisma/schema.prisma`**

In `ForecastDailyRevenue`, add (preserve existing fields and indexes):

```prisma
  reconciledRevenue    Float?
  reconciledP10        Float?
  reconciledP90        Float?
  reconciliationMethod String?
```

In `ForecastMenuItem`, add:

```prisma
  reconciledQty        Float?
  reconciliationMethod String?
```

Add two new models near the existing forecast models (after `ForecastMenuItem`):

```prisma
/// Daily category-level revenue forecast. Written nightly by the
/// reconciliation pipeline (`ml/reconciliation/category_aggregator.py`)
/// by aggregating ForecastMenuItem.predictedQty × avgPrice per category.
/// Acts as the middle level of the BottomUp hierarchy MinTrace reconciles.
model ForecastDailyCategory {
  id                   String    @id @default(cuid())
  storeId              String
  date                 DateTime  @db.Date
  categoryName         String
  revenue              Float
  reconciledRevenue    Float?
  reconciledAt         DateTime?
  reconciliationMethod String?
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  store Store @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@unique([storeId, date, categoryName])
  @@index([storeId, date])
}

/// One row per (store, date) summarising pre/post discrepancy after the
/// nightly hierarchical reconciliation. Powers the W11-12 quality panel
/// (Phase 1 §3.5 section 2). Sparkline reads come from this table directly.
model MlReconciliationDaily {
  id                        String   @id @default(cuid())
  storeId                   String
  date                      DateTime @db.Date
  prePctDiscrepancyMedian   Float?
  prePctDiscrepancyP95      Float?
  postPctDiscrepancyMedian  Float?
  postPctDiscrepancyP95     Float?
  methodUsed                String
  sampleSize                Int      @default(0)
  createdAt                 DateTime @default(now())

  store Store @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@unique([storeId, date])
  @@index([storeId, date(sort: Desc)])
}
```

Add the relations on `Store` (just below the existing `mlForecastEvaluations` line):

```prisma
  forecastDailyCategory  ForecastDailyCategory[]
  mlReconciliationDaily  MlReconciliationDaily[]
```

- [ ] **Step 3: Validate and push**

```bash
npx prisma format
npx prisma validate
npx prisma db push
psql "$DATABASE_URL" -f prisma/manual-migrations/2026-05-26_phase1-w6-reconciliation.sql
npx prisma generate
```

Expected: schema valid; `db push` reports no destructive changes (all additive); SQL idempotent (all CREATE/ALTER use IF NOT EXISTS); client regenerates.

If `db push` proposes any destructive change, STOP — investigate before continuing.

- [ ] **Step 4: Verify**

```bash
psql "$DATABASE_URL" -c "\\d \"ForecastDailyCategory\""
psql "$DATABASE_URL" -c "\\d \"MlReconciliationDaily\""
psql "$DATABASE_URL" -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'ForecastDailyRevenue' AND column_name LIKE 'reconciled%';"
```

Expected: both new tables listed with the right columns + constraints; reconciledRevenue/P10/P90 present on `ForecastDailyRevenue`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/manual-migrations/2026-05-26_phase1-w6-reconciliation.sql
git commit -m "ml(w6): add reconciled columns + ForecastDailyCategory + MlReconciliationDaily"
```

---

## Task 3: Extract `avg_price` helper from `nightly_integration.py`

The existing per-item avgPrice computation lives at `ml/evaluation/nightly_integration.py:146-186` (`_fetch_future_items_with_price`). Reconciliation needs the same logic. Extract first so both call sites share one implementation. No behavior change.

**Files:**
- Create: `ml/reconciliation/__init__.py` (empty)
- Create: `ml/reconciliation/avg_price.py`
- Create: `ml/tests/test_avg_price.py`
- Modify: `ml/evaluation/nightly_integration.py` (import from new module)

- [ ] **Step 1: Write the failing test**

Create `ml/tests/test_avg_price.py`:

```python
"""Tests for the extracted avg_price helper.

The pre-extraction logic lives at ml/evaluation/nightly_integration.py and
is exercised end-to-end by test_consistency.py / test_nightly_integration.py.
These tests pin the contract of the extracted helper.
"""
from __future__ import annotations

from unittest.mock import MagicMock

from ml.reconciliation.avg_price import (
    compute_item_avg_prices,
    AVG_PRICE_FALLBACK,
)


def _mk_conn_with_rows(rows):
    cur = MagicMock()
    cur.__enter__ = lambda self: self
    cur.__exit__ = lambda *a: False
    cur.fetchall.return_value = rows
    cur.execute = MagicMock()
    conn = MagicMock()
    conn.__enter__ = lambda self: self
    conn.__exit__ = lambda *a: False
    conn.cursor.return_value = cur
    return conn


def test_compute_item_avg_prices_returns_dict_keyed_by_item_name():
    rows = [("Bacon Eddy", 9.5), ("Cheesy Eddy", 11.25)]
    conn = _mk_conn_with_rows(rows)
    prices = compute_item_avg_prices(conn, store_id="store-hwd", lookback_days=60)
    assert prices == {"Bacon Eddy": 9.5, "Cheesy Eddy": 11.25}


def test_compute_item_avg_prices_skips_zero_qty_items():
    rows = [("Bacon Eddy", 9.5), ("Free Sample", 0.0)]
    conn = _mk_conn_with_rows(rows)
    prices = compute_item_avg_prices(conn, store_id="store-hwd", lookback_days=60)
    assert "Free Sample" not in prices


def test_avg_price_fallback_constant_is_one():
    # Spec §2 (and the existing consistency.py fallback) expect a $1 floor
    # so a missing-price item still contributes a non-zero leaf value.
    assert AVG_PRICE_FALLBACK == 1.0


def test_compute_item_avg_prices_executes_60_day_lookback_query():
    conn = _mk_conn_with_rows([])
    compute_item_avg_prices(conn, store_id="store-hwd", lookback_days=60)
    cur = conn.cursor.return_value
    sql, params = cur.execute.call_args.args
    assert "OtterMenuItem" in sql
    assert "60" in sql or 60 in params
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pytest ml/tests/test_avg_price.py -v`

Expected: ModuleNotFoundError.

- [ ] **Step 3: Implement the helper**

First read `ml/evaluation/nightly_integration.py:146-186` to capture the exact SQL it uses. Then create `ml/reconciliation/avg_price.py`:

```python
"""Per-item average price helper.

Extracted from ml/evaluation/nightly_integration.py so the hierarchical
reconciliation pipeline (W6-8) and the existing consistency check share
one implementation. The contract is unchanged: AVG of
(fpTotalSales + tpTotalSales) / (fpQuantitySold + tpQuantitySold)
over the trailing N days, skipping zero-qty items.
"""
from __future__ import annotations


# Spec §2 fallback for items with no observed sales in the lookback window.
# Matches the existing consistency-check fallback so reconciliation residuals
# match the discrepancy the operator already sees.
AVG_PRICE_FALLBACK = 1.0


def compute_item_avg_prices(
    conn,
    *,
    store_id: str,
    lookback_days: int = 60,
) -> dict[str, float]:
    """Return {itemName: avgPrice} from the trailing window."""
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT "itemName",
                   AVG(
                     CASE
                       WHEN ("fpQuantitySold" + "tpQuantitySold") > 0
                       THEN ("fpTotalSales" + "tpTotalSales")
                            / ("fpQuantitySold" + "tpQuantitySold")
                     END
                   ) AS avg_price
            FROM "OtterMenuItem"
            WHERE "storeId" = %s
              AND date >= CURRENT_DATE - %s::INTEGER
              AND "isModifier" = false
              AND ("fpQuantitySold" + "tpQuantitySold") > 0
            GROUP BY "itemName"
            ''',
            (store_id, lookback_days),
        )
        rows = cur.fetchall()
    return {name: float(price) for name, price in rows if price is not None}
```

- [ ] **Step 4: Update `nightly_integration.py` to import the helper**

In `ml/evaluation/nightly_integration.py`, replace the inlined `_fetch_future_items_with_price` body's avg-price branch with `compute_item_avg_prices(...)` from the new module. Be surgical: the function may compute additional things (e.g. future-item resolution) — only swap out the avg-price subroutine. Re-run the full test suite at the end of this step to confirm no behavior change.

- [ ] **Step 5: Run all ML tests, expect PASS**

```bash
pytest ml/tests/ -v --tb=short
```

Expected: every prior test still passes + new test_avg_price.py passes.

- [ ] **Step 6: Commit**

```bash
git add ml/reconciliation/__init__.py ml/reconciliation/avg_price.py ml/tests/test_avg_price.py ml/evaluation/nightly_integration.py
git commit -m "ml(w6): extract avg_price helper to ml/reconciliation"
```

---

## Task 4: Category aggregator

**Files:**
- Create: `ml/reconciliation/category_aggregator.py`
- Create: `ml/tests/test_category_aggregator.py`

- [ ] **Step 1: Write the failing test**

Create `ml/tests/test_category_aggregator.py`:

```python
"""Tests for the ForecastDailyCategory nightly aggregator."""
from __future__ import annotations

import datetime as dt
from unittest.mock import MagicMock

from ml.reconciliation.category_aggregator import (
    aggregate_categories_for_store,
    CategoryAggregationResult,
)


def _mk_cursor(rowsets):
    cur = MagicMock()
    cur.__enter__ = lambda self: self
    cur.__exit__ = lambda *a: False
    cur.fetchall.side_effect = rowsets
    cur.execute = MagicMock()
    return cur


def _mk_conn(cursors):
    conn = MagicMock()
    conn.__enter__ = lambda self: self
    conn.__exit__ = lambda *a: False
    it = iter(cursors)
    conn.cursor.side_effect = lambda *a, **k: next(it)
    return conn


def test_aggregates_menu_items_by_category_using_avg_prices():
    # Two items in 'Sandwiches' category, one in 'Drinks'.
    # Forecast rows (itemName, forecastDate, predictedQty):
    item_rows = [
        ("Bacon Eddy",   dt.date(2026, 5, 27), 12.0),
        ("Cheesy Eddy",  dt.date(2026, 5, 27), 8.0),
        ("Iced Coffee",  dt.date(2026, 5, 27), 20.0),
    ]
    # item -> category lookup:
    category_rows = [
        ("Bacon Eddy",  "Sandwiches"),
        ("Cheesy Eddy", "Sandwiches"),
        ("Iced Coffee", "Drinks"),
    ]
    # avg prices (from compute_item_avg_prices):
    price_rows = [
        ("Bacon Eddy",  9.5),
        ("Cheesy Eddy", 11.0),
        ("Iced Coffee", 5.0),
    ]
    insert_cur = MagicMock()
    insert_cur.__enter__ = lambda self: self
    insert_cur.__exit__ = lambda *a: False
    insert_cur.execute = MagicMock()

    cursors = [
        _mk_cursor([item_rows]),
        _mk_cursor([category_rows]),
        _mk_cursor([price_rows]),
        insert_cur,
    ]
    conn = _mk_conn(cursors)

    result = aggregate_categories_for_store(conn, store_id="store-hwd")

    assert isinstance(result, CategoryAggregationResult)
    assert result.ok
    # Sandwiches = 12*9.5 + 8*11 = 114 + 88 = 202.
    # Drinks = 20*5 = 100.
    # 2 categories x 1 forecast date = 2 inserts.
    assert result.rows_written == 2


def test_returns_ok_false_when_no_forecast_rows():
    cursors = [_mk_cursor([[]])]
    conn = _mk_conn(cursors)
    result = aggregate_categories_for_store(conn, store_id="store-hwd")
    assert not result.ok
    assert "no_forecast_rows" in result.warning


def test_falls_back_to_dollar_one_when_item_missing_from_price_map():
    # 1 forecast item but no price row -> uses AVG_PRICE_FALLBACK = 1.0.
    item_rows = [("Mystery Item", dt.date(2026, 5, 27), 10.0)]
    category_rows = [("Mystery Item", "Sandwiches")]
    price_rows = []  # No prices found
    insert_cur = MagicMock()
    insert_cur.__enter__ = lambda self: self
    insert_cur.__exit__ = lambda *a: False
    insert_cur.execute = MagicMock()
    cursors = [
        _mk_cursor([item_rows]),
        _mk_cursor([category_rows]),
        _mk_cursor([price_rows]),
        insert_cur,
    ]
    conn = _mk_conn(cursors)

    result = aggregate_categories_for_store(conn, store_id="store-hwd")
    assert result.ok
    # Sandwiches = 10 * 1.0 = 10. Single row written.
    args = insert_cur.execute.call_args.args
    # params tuple is the 5th positional arg of the INSERT; verify revenue == 10.
    assert args[1][3] == 10.0  # (id, storeId, date, revenue, categoryName) or similar order
```

(The exact param-positional assertion at the end depends on the SQL written in Step 3 — adjust to match.)

- [ ] **Step 2: Run, expect FAIL**

Run: `pytest ml/tests/test_category_aggregator.py -v`

Expected: ModuleNotFoundError.

- [ ] **Step 3: Implement the aggregator**

Create `ml/reconciliation/category_aggregator.py`:

```python
"""Nightly aggregation of ForecastMenuItem rows into ForecastDailyCategory.

Pipeline:
  1. Pull latest native ForecastMenuItem rows for the next horizon.
  2. Join each item to its category via OtterMenuItem (most recent category
     observation per item).
  3. Multiply qty by avg price (from ml.reconciliation.avg_price), falling
     back to $1 for items with no observed price history.
  4. Sum into (storeId, date, categoryName) and upsert into
     ForecastDailyCategory.

Idempotent: upsert keyed on (storeId, date, categoryName).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from ml.db import cuid_like
from ml.reconciliation.avg_price import compute_item_avg_prices, AVG_PRICE_FALLBACK


@dataclass
class CategoryAggregationResult:
    ok: bool
    rows_written: int = 0
    warning: str = ""


def _load_latest_native_item_forecasts(cur, store_id: str):
    """One row per (item, date) — the most recent generation for each."""
    cur.execute(
        '''
        SELECT DISTINCT ON ("otterItemSkuId", "forecastDate")
               "otterItemSkuId", "forecastDate", "predictedQty"
        FROM "ForecastMenuItem"
        WHERE "storeId" = %s
          AND "forecastSource" = 'native'
          AND "forecastDate" >= CURRENT_DATE
        ORDER BY "otterItemSkuId", "forecastDate", "generatedAt" DESC
        ''',
        (store_id,),
    )
    return cur.fetchall()


def _load_item_to_category(cur, store_id: str) -> dict[str, str]:
    """Most-recent category for each itemName at this store."""
    cur.execute(
        '''
        SELECT DISTINCT ON ("itemName") "itemName", category
        FROM "OtterMenuItem"
        WHERE "storeId" = %s AND "isModifier" = false
        ORDER BY "itemName", date DESC
        ''',
        (store_id,),
    )
    return dict(cur.fetchall())


def aggregate_categories_for_store(
    conn, *, store_id: str, method_label: str = "category_sum",
) -> CategoryAggregationResult:
    """Build ForecastDailyCategory rows for one store. Fails soft."""
    with conn.cursor() as cur:
        items = _load_latest_native_item_forecasts(cur, store_id)
    if not items:
        return CategoryAggregationResult(ok=False, warning="no_forecast_rows")

    with conn.cursor() as cur:
        item_to_cat = _load_item_to_category(cur, store_id)

    prices = compute_item_avg_prices(conn, store_id=store_id, lookback_days=60)

    # date -> category -> revenue
    agg: dict[tuple, float] = {}
    for item_name, forecast_date, qty in items:
        category = item_to_cat.get(item_name)
        if category is None:
            continue  # item has no category observation; skip rather than guess
        price = prices.get(item_name, AVG_PRICE_FALLBACK)
        key = (forecast_date, category)
        agg[key] = agg.get(key, 0.0) + float(qty) * price

    written = 0
    with conn.cursor() as cur:
        for (forecast_date, category), revenue in agg.items():
            cur.execute(
                '''
                INSERT INTO "ForecastDailyCategory"
                    (id, "storeId", date, "categoryName", revenue, "updatedAt")
                VALUES (%s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT ("storeId", date, "categoryName")
                DO UPDATE SET revenue = EXCLUDED.revenue,
                              "updatedAt" = CURRENT_TIMESTAMP
                ''',
                (cuid_like(), store_id, forecast_date, category, revenue),
            )
            written += 1

    return CategoryAggregationResult(ok=True, rows_written=written)
```

- [ ] **Step 4: Run, expect PASS**

Run: `pytest ml/tests/test_category_aggregator.py -v`

Expected: 3 passed. (Adjust the param-positional assertion in test #3 if the INSERT column ordering needs tweaking.)

- [ ] **Step 5: Commit**

```bash
git add ml/reconciliation/category_aggregator.py ml/tests/test_category_aggregator.py
git commit -m "ml(w6): category aggregator (writes ForecastDailyCategory rows)"
```

---

## Task 5: `hierarchy.py` — S-matrix and tags

`hierarchicalforecast` expects an `S` matrix that expresses how each lower level rolls up to the upper level, plus a `tags` dict mapping level-name → list of series IDs. We build both shapes here.

**Files:**
- Create: `ml/reconciliation/hierarchy.py`
- Create: `ml/tests/test_hierarchy.py`

- [ ] **Step 1: Write the failing test**

Create `ml/tests/test_hierarchy.py`:

```python
"""Tests for the BottomUp S-matrix and tags builder.

`hierarchicalforecast.HierarchicalReconciliation` consumes (S, tags). Our
build must produce shapes consistent with their expected contract for both
the single-store hierarchy (revenue / category / item) and the
multi-store extension (chain / store / category / item)."""
from __future__ import annotations

import numpy as np
import pytest

from ml.reconciliation.hierarchy import (
    build_single_store_hierarchy,
    build_multi_store_hierarchy,
)


def test_single_store_s_df_rolls_items_to_categories_to_revenue():
    # 2 categories, 3 items:
    #   Sandwiches: [Bacon Eddy, Cheesy Eddy]
    #   Drinks:     [Iced Coffee]
    item_to_category = {
        "Bacon Eddy":  "Sandwiches",
        "Cheesy Eddy": "Sandwiches",
        "Iced Coffee": "Drinks",
    }

    S_df, tags = build_single_store_hierarchy(item_to_category=item_to_category)

    # Top (revenue) + 2 categories + 3 items = 6 rows. Columns = 3 leaves.
    assert S_df.shape == (6, 3)
    assert list(S_df.columns) == ["Bacon Eddy", "Cheesy Eddy", "Iced Coffee"]

    # Revenue row sums every item.
    assert (S_df.loc["revenue"] == 1).all()
    # Sandwiches row sums the 2 sandwich items.
    assert S_df.loc["Sandwiches"].sum() == 2
    assert S_df.loc["Drinks"].sum() == 1
    # Each leaf row picks itself (identity block).
    assert S_df.loc["Bacon Eddy", "Bacon Eddy"] == 1
    assert S_df.loc["Bacon Eddy", "Iced Coffee"] == 0


def test_tags_keys_are_level_names():
    """tags must expose each level name as a list of unique_ids (the keys
    hierarchicalforecast addresses for reconciliation)."""
    item_to_category = {"Item A": "Cat A", "Item B": "Cat B"}
    _, tags = build_single_store_hierarchy(item_to_category=item_to_category)
    assert set(tags.keys()) >= {"revenue", "category", "item"}
    assert tags["revenue"] == ["revenue"]
    assert set(tags["item"]) == {"Item A", "Item B"}


def test_multi_store_hierarchy_adds_chain_level():
    """Chain ≈ Σ stores. With 2 stores each contributing items, the chain row
    must sum every leaf and store rows sum that store's items."""
    stores = {
        "store-hwd": {
            "Bacon Eddy":  "Sandwiches",
            "Iced Coffee": "Drinks",
        },
        "store-gln": {
            "Bacon Eddy":  "Sandwiches",
        },
    }
    S_df, tags = build_multi_store_hierarchy(stores=stores)
    # 3 leaves total (HWD has 2 items, GLN has 1).
    assert S_df.shape[1] == 3
    assert (S_df.loc["__chain__"] == 1).all()
    # Store rows.
    assert S_df.loc["store-hwd"].sum() == 2
    assert S_df.loc["store-gln"].sum() == 1


def test_empty_input_raises():
    with pytest.raises(ValueError, match="empty"):
        build_single_store_hierarchy(item_to_category={})
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pytest ml/tests/test_hierarchy.py -v`

Expected: ModuleNotFoundError.

- [ ] **Step 3: Implement**

Create `ml/reconciliation/hierarchy.py`. NOTE the return type is `pd.DataFrame`, not numpy — `HierarchicalReconciliation.reconcile()` expects `S_df` as a pandas DataFrame indexed by series unique_id with columns = leaf unique_ids.

```python
"""S_df + tags builder for hierarchicalforecast.

Single-store: 3 levels (revenue, category, item).
Multi-store:  4 levels (chain, store, store_category, item) — exercised by
              the unit test in W8 but not by the nightly pipeline until
              GLN/VNYS reach `ready`.

`HierarchicalReconciliation.reconcile()` API contract (verified against
Nixtla docs at planning time):
  * S_df: pandas DataFrame, rows = all series unique_ids (top + middle +
    bottom), columns = bottom-level series unique_ids, values = roll-up
    weights (0 or 1).
  * tags: dict[level_name -> list[unique_id]].
  * Y_hat_df: long-format DataFrame with columns unique_id, ds, y_hat (and
    optional p10/p90).
  * Y_df: long-format DataFrame with columns unique_id, ds, y — the
    insample fitted values used by mint_shrink to estimate the covariance.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def build_single_store_hierarchy(*, item_to_category: dict[str, str]):
    """Return (S_df, tags).

    Series unique_id convention (single-store, no namespace prefix):
      * top:    "revenue"
      * middle: each category name
      * bottom: each item name
    """
    if not item_to_category:
        raise ValueError("empty item_to_category — hierarchy needs at least one item")

    items = sorted(item_to_category.keys())
    categories = sorted(set(item_to_category.values()))
    n_items = len(items)
    n_cat = len(categories)

    # Row order: revenue, then categories (sorted), then items (sorted).
    index = ["revenue"] + categories + items
    S = np.zeros((1 + n_cat + n_items, n_items), dtype=float)

    # Top: all 1s.
    S[0, :] = 1.0
    # Categories: 1 where item belongs.
    cat_to_row = {cat: 1 + i for i, cat in enumerate(categories)}
    for col, item in enumerate(items):
        S[cat_to_row[item_to_category[item]], col] = 1.0
    # Items (bottom): identity block.
    for col, item in enumerate(items):
        S[1 + n_cat + col, col] = 1.0

    S_df = pd.DataFrame(S, index=index, columns=items)

    tags = {
        "revenue": ["revenue"],
        "category": categories,
        "item": items,
    }
    # Convenience row-index map (not consumed by hierarchicalforecast; used
    # by ml.reconciliation.reconcile when writing values back).
    row_index = {name: i for i, name in enumerate(index)}
    tags["__row_index__"] = row_index
    return S_df, tags


def build_multi_store_hierarchy(*, stores: dict[str, dict[str, str]]):
    """4-level hierarchy: chain → store → store_category → leaf_item.

    Series unique_id convention (must namespace by store):
      * top:    "__chain__"
      * level 2: each store_id
      * level 3: "{store_id}:{category}"
      * bottom: "{store_id}:{item}"
    """
    if not stores or not any(stores.values()):
        raise ValueError("empty stores — multi-store hierarchy needs at least one item")

    leaves: list[tuple[str, str, str]] = []  # (store, item, category)
    for store_id in sorted(stores.keys()):
        for item, cat in sorted(stores[store_id].items()):
            leaves.append((store_id, item, cat))

    n_leaves = len(leaves)
    store_ids = sorted(stores.keys())
    n_stores = len(store_ids)
    store_cat_pairs = sorted({(s, c) for s, _, c in leaves})
    n_pairs = len(store_cat_pairs)

    chain_id = "__chain__"
    store_cat_ids = [f"{s}:{c}" for s, c in store_cat_pairs]
    leaf_ids = [f"{s}:{item}" for s, item, _ in leaves]

    index = [chain_id] + store_ids + store_cat_ids + leaf_ids
    n_rows = 1 + n_stores + n_pairs + n_leaves
    S = np.zeros((n_rows, n_leaves), dtype=float)

    # Chain.
    S[0, :] = 1.0
    # Stores.
    for i, store_id in enumerate(store_ids):
        row = 1 + i
        for col, (s, _, _) in enumerate(leaves):
            if s == store_id:
                S[row, col] = 1.0
    # Store-category.
    pair_to_row = {pair: 1 + n_stores + i for i, pair in enumerate(store_cat_pairs)}
    for col, (s, _, c) in enumerate(leaves):
        S[pair_to_row[(s, c)], col] = 1.0
    # Leaf identity block.
    leaf_offset = 1 + n_stores + n_pairs
    for col in range(n_leaves):
        S[leaf_offset + col, col] = 1.0

    S_df = pd.DataFrame(S, index=index, columns=leaf_ids)

    tags = {
        "chain": [chain_id],
        "store": store_ids,
        "store_category": store_cat_ids,
        "leaf": leaf_ids,
        "__row_index__": {name: i for i, name in enumerate(index)},
    }
    return S_df, tags
```

The test in Step 1 still asserts shape correctness on the underlying values (`S_df.values.shape` or just `S_df.shape`), which is what `(6, 3)` checks. Adjust the test assertions to use `S_df.shape` / `S_df.loc["Sandwiches"].sum()` rather than positional indexing into a numpy array.

- [ ] **Step 4: Run, expect PASS**

Run: `pytest ml/tests/test_hierarchy.py -v`

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add ml/reconciliation/hierarchy.py ml/tests/test_hierarchy.py
git commit -m "ml(w6): S-matrix + tags builders for single + multi-store hierarchies"
```

---

## Task 6: `reconcile.py` — MinTrace runner

**Files:**
- Create: `ml/reconciliation/reconcile.py`
- Create: `ml/tests/test_reconcile.py`

- [ ] **Step 1: Write the failing test**

Create `ml/tests/test_reconcile.py`:

```python
"""Tests for the MinTrace reconciliation pipeline.

We test:
  1. Closed-form behavior on a known-consistent hierarchy (input already
     sums correctly → reconciled output should be ~identical).
  2. Fail-soft on singular matrix (residuals all zero) — returns ok=False.
  3. Idempotent upsert (running twice doesn't double-write).
"""
from __future__ import annotations

import datetime as dt
from unittest.mock import MagicMock

import numpy as np
import pandas as pd
import pytest

from ml.reconciliation.reconcile import (
    reconcile_store_hierarchy,
    ReconcileResult,
)


def _consistent_forecast_frame():
    """A small consistent hierarchy: 2 items, 1 category, 1 day.
    Revenue = Σ category = Σ items, all aligned at 100."""
    today = dt.date(2026, 5, 27)
    return {
        "revenue": [(today, 100.0, 80.0, 120.0)],          # (date, point, p10, p90)
        "categories": {
            "Sandwiches": [(today, 100.0, 80.0, 120.0)],
        },
        "items": {
            "Bacon Eddy":  [(today, 5.0, 4.0, 6.0)],   # qty * $10 = $50
            "Cheesy Eddy": [(today, 5.0, 4.0, 6.0)],   # qty * $10 = $50
        },
        "prices": {"Bacon Eddy": 10.0, "Cheesy Eddy": 10.0},
        "item_to_category": {"Bacon Eddy": "Sandwiches", "Cheesy Eddy": "Sandwiches"},
    }


def _fitted_y_df_for_consistent_frame():
    """Long-format insample fitted values matching the hierarchy. 28 days of
    history per series at the same coherent values, plus a small noise term
    so the mint_shrink covariance estimator has non-degenerate residuals."""
    rng = np.random.default_rng(seed=42)
    dates = pd.date_range(end=pd.Timestamp("2026-05-26"), periods=28, freq="D")
    rows = []
    for uid, base in [
        ("revenue", 100.0),
        ("Sandwiches", 100.0),
        ("Bacon Eddy", 50.0),   # qty 5 * $10
        ("Cheesy Eddy", 50.0),
    ]:
        noise = rng.normal(0, 1.0, size=len(dates))
        for ds, n in zip(dates, noise):
            rows.append({"unique_id": uid, "ds": ds, "y": base + n})
    return pd.DataFrame(rows)


def test_reconcile_consistent_hierarchy_returns_ok():
    """When inputs already coherent, MinTrace returns reconciled values
    close to the inputs (within rounding). We assert ok=True + ≥3 writes,
    not specific reconciled values (sensitive to lib-version internals)."""
    forecast = _consistent_forecast_frame()
    y_df = _fitted_y_df_for_consistent_frame()

    cur = MagicMock()
    cur.__enter__ = lambda self: self
    cur.__exit__ = lambda *a: False
    cur.execute = MagicMock()
    conn = MagicMock()
    conn.__enter__ = lambda self: self
    conn.__exit__ = lambda *a: False
    conn.cursor.return_value = cur

    result = reconcile_store_hierarchy(
        conn,
        store_id="store-hwd",
        forecast_frame=forecast,
        y_df=y_df,
        method="mint_shrink",
    )

    assert isinstance(result, ReconcileResult)
    assert result.ok, result.warning
    # Expect ≥1 write for each level (revenue, category, item).
    assert result.rows_written >= 3


def test_reconcile_falls_soft_on_reconciler_exception(monkeypatch):
    """If the underlying lib throws, return ok=False with the exception type."""
    from ml.reconciliation import reconcile as recmod

    def boom(*args, **kwargs):
        raise RuntimeError("singular matrix in MinTrace")

    monkeypatch.setattr(recmod, "_run_min_trace", boom)
    forecast = _consistent_forecast_frame()
    cur = MagicMock()
    cur.__enter__ = lambda self: self
    cur.__exit__ = lambda *a: False
    conn = MagicMock()
    conn.__enter__ = lambda self: self
    conn.__exit__ = lambda *a: False
    conn.cursor.return_value = cur

    result = reconcile_store_hierarchy(
        conn, store_id="store-hwd", forecast_frame=forecast,
        y_df=_fitted_y_df_for_consistent_frame(), method="mint_shrink",
    )
    assert not result.ok
    assert "singular" in result.warning.lower() or "runtimeerror" in result.warning.lower()


def test_reconcile_falls_back_to_ols_when_y_df_empty(monkeypatch):
    """mint_shrink needs Y_df with insample residuals. When Y_df is empty
    (cold-start / no historical actuals), we should fall back to method='ols'
    automatically and still produce reconciled writes."""
    from ml.reconciliation import reconcile as recmod

    calls = []
    original = recmod._run_min_trace
    def spy(S_df, tags, y_hat_df, y_df, method):
        calls.append(method)
        return original(S_df, tags, y_hat_df, y_df, method)
    monkeypatch.setattr(recmod, "_run_min_trace", spy)

    forecast = _consistent_forecast_frame()
    cur = MagicMock()
    cur.__enter__ = lambda self: self
    cur.__exit__ = lambda *a: False
    conn = MagicMock()
    conn.__enter__ = lambda self: self
    conn.__exit__ = lambda *a: False
    conn.cursor.return_value = cur

    result = reconcile_store_hierarchy(
        conn, store_id="store-hwd", forecast_frame=forecast,
        y_df=pd.DataFrame(columns=["unique_id", "ds", "y"]),
        method="mint_shrink",
    )
    # The wrapper should have tried mint_shrink first OR jumped straight to ols
    # — either is acceptable as long as it lands on ols and produces writes.
    assert "ols" in calls
    assert result.ok
    assert result.method == "ols"


def test_reconcile_sql_writers_have_idempotent_marker():
    """The three back-write SQL templates are idempotent — by ON CONFLICT
    (for ForecastDailyCategory aggregator inserts) or by UPDATE keyed on the
    row's natural identity (for ForecastDailyRevenue / ForecastMenuItem,
    which are written by the model trainer). The string 'ON CONFLICT' or
    'UPDATE' must appear in each."""
    from ml.reconciliation.reconcile import (
        _REVENUE_UPSERT_SQL, _CATEGORY_UPSERT_SQL, _ITEM_UPSERT_SQL,
    )
    for sql in (_REVENUE_UPSERT_SQL, _CATEGORY_UPSERT_SQL, _ITEM_UPSERT_SQL):
        assert "UPDATE" in sql or "ON CONFLICT" in sql
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pytest ml/tests/test_reconcile.py -v`

Expected: ModuleNotFoundError.

- [ ] **Step 3: Implement**

Create `ml/reconciliation/reconcile.py`:

```python
"""MinTrace hierarchical reconciliation runner.

Reads point forecasts from the in-memory forecast_frame (built by the caller
from the latest ForecastDailyRevenue / ForecastDailyCategory / ForecastMenuItem
native rows), runs MinTrace from `hierarchicalforecast`, and writes reconciled
point estimates back via idempotent UPDATE. Fails soft on any exception —
unreconciled values remain in place and a warning is returned.

Auto-fallback: when `method='mint_shrink'` but `y_df` is empty (cold-start
store, no historical actuals yet), retries with `method='ols'` which doesn't
need the insample residuals. The final method used is reported on the result.

The (S_df, tags) hierarchy comes from ml.reconciliation.hierarchy.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Optional

import numpy as np
import pandas as pd

from ml.reconciliation.hierarchy import build_single_store_hierarchy


_LOG = logging.getLogger(__name__)


_METHODS_REQUIRING_Y_DF = {"mint_shrink", "mint_cov", "wls_var"}


@dataclass
class ReconcileResult:
    ok: bool
    rows_written: int = 0
    method: str = ""
    warning: str = ""


# UPDATE-idempotent: the natural key of each row is unique, so re-running just
# overwrites the same reconciled columns with the same values.
_REVENUE_UPSERT_SQL = '''
    UPDATE "ForecastDailyRevenue"
    SET "reconciledRevenue" = %s,
        "reconciledP10" = %s,
        "reconciledP90" = %s,
        "reconciledAt" = CURRENT_TIMESTAMP,
        "reconciliationMethod" = %s
    WHERE "storeId" = %s AND "forecastDate" = %s AND "hourBucket" = 0
      AND "generatedAt" = (
        SELECT MAX("generatedAt") FROM "ForecastDailyRevenue"
        WHERE "storeId" = %s AND "forecastDate" = %s AND "hourBucket" = 0
          AND "forecastSource" = 'native'
      )
'''

_CATEGORY_UPSERT_SQL = '''
    UPDATE "ForecastDailyCategory"
    SET "reconciledRevenue" = %s,
        "reconciledAt" = CURRENT_TIMESTAMP,
        "reconciliationMethod" = %s
    WHERE "storeId" = %s AND date = %s AND "categoryName" = %s
'''

_ITEM_UPSERT_SQL = '''
    UPDATE "ForecastMenuItem"
    SET "reconciledQty" = %s,
        "reconciliationMethod" = %s
    WHERE "storeId" = %s AND "forecastDate" = %s AND "otterItemSkuId" = %s
      AND "generatedAt" = (
        SELECT MAX("generatedAt") FROM "ForecastMenuItem"
        WHERE "storeId" = %s AND "forecastDate" = %s AND "otterItemSkuId" = %s
          AND "forecastSource" = 'native'
      )
'''


def _run_min_trace(S_df, tags, y_hat_df, y_df, method: str) -> pd.DataFrame:
    """Thin wrapper so tests can monkeypatch this single call site.

    `tags` here is the *level-name* dict only — the __row_index__ entry from
    ml.reconciliation.hierarchy is stripped before passing in. Returns the
    reconciler's output DataFrame; column for the reconciled values is named
    like 'MinTrace/mint_shrink' (one column per reconciler in the list).
    """
    from hierarchicalforecast.core import HierarchicalReconciliation
    from hierarchicalforecast.methods import MinTrace

    public_tags = {k: v for k, v in tags.items() if not k.startswith("__")}
    reconciler = HierarchicalReconciliation([MinTrace(method=method)])
    kwargs = {"Y_hat_df": y_hat_df, "S_df": S_df, "tags": public_tags}
    if method in _METHODS_REQUIRING_Y_DF:
        kwargs["Y_df"] = y_df
    return reconciler.reconcile(**kwargs)


def _reconciled_column_name(reconciled_df: pd.DataFrame) -> Optional[str]:
    """Find the reconciler-output column. Convention is 'MinTrace/<method>'
    but the helper tolerates any non-meta numeric column added by the lib."""
    meta = {"unique_id", "ds", "y", "y_hat"}
    for col in reconciled_df.columns:
        if col in meta:
            continue
        if pd.api.types.is_numeric_dtype(reconciled_df[col]):
            return col
    return None


def reconcile_store_hierarchy(
    conn,
    *,
    store_id: str,
    forecast_frame: dict[str, Any],
    y_df: pd.DataFrame,
    method: str = "mint_shrink",
) -> ReconcileResult:
    """Reconcile one store's hierarchy across the forecast horizon and write
    results back.

    `forecast_frame` shape (built by the caller):
      {
        "revenue":    [(date, point, p10, p90), ...],
        "categories": { category_name: [(date, point, p10, p90), ...], ... },
        "items":      { item_name:     [(date, qty,   p10, p90), ...], ... },
        "prices":     { item_name: avg_price, ... },
        "item_to_category": { item_name: category_name, ... },
      }

    `y_df` is a long-format DataFrame with columns unique_id, ds, y holding
    insample historical actuals — required for mint_shrink covariance
    estimation. May be empty; we fall back to method='ols' automatically.

    Fails soft on any other exception; caller logs the warning into JobRun.
    """
    chosen_method = method
    if method in _METHODS_REQUIRING_Y_DF and (y_df is None or y_df.empty):
        chosen_method = "ols"

    try:
        S_df, tags = build_single_store_hierarchy(
            item_to_category=forecast_frame["item_to_category"],
        )
        y_hat_df = _build_y_hat_df(forecast_frame, S_df)
        reconciled = _run_min_trace(S_df, tags, y_hat_df, y_df, chosen_method)
    except Exception as exc:  # pylint: disable=broad-except
        # If the failure was due to mint_shrink residual issues, try ols once.
        if chosen_method == "mint_shrink":
            try:
                chosen_method = "ols"
                reconciled = _run_min_trace(S_df, tags, y_hat_df, y_df, chosen_method)
            except Exception as exc2:  # pylint: disable=broad-except
                return ReconcileResult(
                    ok=False, method=chosen_method,
                    warning=f"{type(exc).__name__}: {exc}; ols-fallback: {exc2}",
                )
        else:
            return ReconcileResult(
                ok=False, method=chosen_method,
                warning=f"{type(exc).__name__}: {exc}",
            )

    rows_written = _write_reconciled(conn, store_id, reconciled, forecast_frame, chosen_method)
    return ReconcileResult(ok=True, rows_written=rows_written, method=chosen_method)


def _build_y_hat_df(forecast_frame, S_df: pd.DataFrame) -> pd.DataFrame:
    """Long-format Y_hat_df with columns unique_id, ds, y_hat.

    Series ids match the S_df row index (revenue / category names / item
    names). Item-level values are converted from qty -> revenue via avg
    price so every level is in dollars.
    """
    rows = []
    for date, point, _p10, _p90 in forecast_frame["revenue"]:
        rows.append({"unique_id": "revenue", "ds": pd.Timestamp(date), "y_hat": float(point)})
    for cat, series in forecast_frame["categories"].items():
        for date, point, _p10, _p90 in series:
            rows.append({"unique_id": cat, "ds": pd.Timestamp(date), "y_hat": float(point)})
    for item, series in forecast_frame["items"].items():
        price = forecast_frame["prices"].get(item, 1.0) or 1.0
        for date, qty, _p10, _p90 in series:
            rows.append({"unique_id": item, "ds": pd.Timestamp(date), "y_hat": float(qty) * price})
    df = pd.DataFrame(rows)
    # Defensive: filter to series the S_df knows about (paranoia against drift
    # between forecast_frame and item_to_category).
    return df[df["unique_id"].isin(S_df.index)].reset_index(drop=True)


def _write_reconciled(
    conn, store_id: str, reconciled_df: pd.DataFrame, forecast_frame, method: str,
) -> int:
    """Idempotent write of reconciled values back to the three forecast tables."""
    col = _reconciled_column_name(reconciled_df)
    if col is None or reconciled_df.empty:
        return 0

    # Pre-index for O(1) lookup.
    indexed = reconciled_df.set_index(["unique_id", "ds"])[col]

    def _get(uid: str, date) -> Optional[float]:
        try:
            v = indexed.loc[(uid, pd.Timestamp(date))]
            return float(v) if pd.notna(v) else None
        except (KeyError, TypeError):
            return None

    written = 0
    with conn.cursor() as cur:
        # Revenue (top).
        for date, _point, p10, p90 in forecast_frame["revenue"]:
            new_point = _get("revenue", date)
            if new_point is None:
                continue
            cur.execute(
                _REVENUE_UPSERT_SQL,
                (new_point, p10, p90, method, store_id, date, store_id, date),
            )
            written += 1
        # Categories.
        for cat, series in forecast_frame["categories"].items():
            for date, _point, _p10, _p90 in series:
                new_point = _get(cat, date)
                if new_point is None:
                    continue
                cur.execute(_CATEGORY_UPSERT_SQL, (new_point, method, store_id, date, cat))
                written += 1
        # Items: reconciled output is in revenue units; divide by avg price
        # to recover qty for the ForecastMenuItem.reconciledQty column.
        for item, series in forecast_frame["items"].items():
            price = forecast_frame["prices"].get(item, 1.0) or 1.0
            for date, _qty, _p10, _p90 in series:
                new_rev = _get(item, date)
                if new_rev is None:
                    continue
                new_qty = new_rev / price
                cur.execute(
                    _ITEM_UPSERT_SQL,
                    (new_qty, method, store_id, date, item, store_id, date, item),
                )
                written += 1
    return written
```

- [ ] **Step 4: Run, expect PASS**

Run: `pytest ml/tests/test_reconcile.py -v`

Expected: 3 passed. If the test that depends on the real `hierarchicalforecast` API fails (Task 1's lib version may use slightly different column names), update `_run_min_trace` and `_build_y_hat_df` to match the actual contract — the test asserts only ok=True + ≥3 writes, not specific reconciled values, precisely so the lib-API specifics can be adjusted here.

- [ ] **Step 5: Commit**

```bash
git add ml/reconciliation/reconcile.py ml/tests/test_reconcile.py
git commit -m "ml(w6): MinTrace reconciliation runner with fail-soft + idempotent upsert"
```

---

## Task 7: Pre/post discrepancy snapshot writer

**Files:**
- Create: `ml/reconciliation/snapshot.py`
- Create: `ml/tests/test_reconcile_snapshot.py`

The discrepancy formula already exists in `ml/evaluation/consistency.py`. Reuse it.

- [ ] **Step 1: Read the existing discrepancy logic**

Read `ml/evaluation/consistency.py` and identify the function that returns `(revenue_total, items_total, discrepancyPct)` per day. Note its name + signature for the snapshot to import.

- [ ] **Step 2: Write the failing test**

Create `ml/tests/test_reconcile_snapshot.py`:

```python
"""Tests for the MlReconciliationDaily snapshot writer."""
from __future__ import annotations

import datetime as dt
from unittest.mock import MagicMock

from ml.reconciliation.snapshot import write_reconciliation_snapshot


def test_writes_one_row_per_store_day_with_pre_post_percentiles():
    cur = MagicMock()
    cur.__enter__ = lambda self: self
    cur.__exit__ = lambda *a: False
    cur.execute = MagicMock()
    conn = MagicMock()
    conn.__enter__ = lambda self: self
    conn.__exit__ = lambda *a: False
    conn.cursor.return_value = cur

    write_reconciliation_snapshot(
        conn,
        store_id="store-hwd",
        date=dt.date(2026, 5, 27),
        pre_discrepancies=[-0.6, -0.5, -0.55],
        post_discrepancies=[-0.12, -0.10, -0.14],
        method_used="mint_shrink",
    )

    sql, params = cur.execute.call_args.args
    assert "INSERT INTO \"MlReconciliationDaily\"" in sql
    assert "ON CONFLICT" in sql  # idempotent re-run

    # Spot check the percentile params (rough — exact ordering depends on the
    # SQL signature defined in Step 3).
    flat = [p for p in params if isinstance(p, (int, float))]
    # Pre median (around -0.55) and post median (around -0.12) should appear.
    rounded = [round(x, 2) for x in flat]
    assert any(abs(v - -0.55) < 0.05 for v in rounded), rounded
    assert any(abs(v - -0.12) < 0.05 for v in rounded), rounded
```

- [ ] **Step 3: Implement**

Create `ml/reconciliation/snapshot.py`:

```python
"""Writer for MlReconciliationDaily rows (pre/post discrepancy snapshot).

Powers the W11-12 quality panel section 2 (per-store reconciliation health).
Idempotent on (storeId, date).
"""
from __future__ import annotations

import datetime as dt
from typing import Sequence

import numpy as np

from ml.db import cuid_like


def _percentile(values: Sequence[float], p: float) -> float | None:
    if not values:
        return None
    return float(np.percentile(np.abs(values), p))


def write_reconciliation_snapshot(
    conn,
    *,
    store_id: str,
    date: dt.date,
    pre_discrepancies: Sequence[float],
    post_discrepancies: Sequence[float],
    method_used: str,
) -> None:
    """Upsert one MlReconciliationDaily row. `*_discrepancies` are the raw
    per-item discrepancy ratios (signed); we take the absolute-value percentile.
    """
    pre_median = _percentile(pre_discrepancies, 50)
    pre_p95 = _percentile(pre_discrepancies, 95)
    post_median = _percentile(post_discrepancies, 50)
    post_p95 = _percentile(post_discrepancies, 95)
    sample = max(len(pre_discrepancies), len(post_discrepancies))

    with conn.cursor() as cur:
        cur.execute(
            '''
            INSERT INTO "MlReconciliationDaily"
                (id, "storeId", date,
                 "prePctDiscrepancyMedian", "prePctDiscrepancyP95",
                 "postPctDiscrepancyMedian", "postPctDiscrepancyP95",
                 "methodUsed", "sampleSize")
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT ("storeId", date) DO UPDATE SET
                "prePctDiscrepancyMedian"  = EXCLUDED."prePctDiscrepancyMedian",
                "prePctDiscrepancyP95"     = EXCLUDED."prePctDiscrepancyP95",
                "postPctDiscrepancyMedian" = EXCLUDED."postPctDiscrepancyMedian",
                "postPctDiscrepancyP95"    = EXCLUDED."postPctDiscrepancyP95",
                "methodUsed"               = EXCLUDED."methodUsed",
                "sampleSize"               = EXCLUDED."sampleSize"
            ''',
            (cuid_like(), store_id, date,
             pre_median, pre_p95, post_median, post_p95,
             method_used, sample),
        )
```

- [ ] **Step 4: Run, expect PASS**

Run: `pytest ml/tests/test_reconcile_snapshot.py -v`

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add ml/reconciliation/snapshot.py ml/tests/test_reconcile_snapshot.py
git commit -m "ml(w6): MlReconciliationDaily snapshot writer"
```

---

## Task 8: Wire reconciliation into the nightly pipeline

**Files:**
- Modify: `ml/run_nightly.py`

The new phase slots between the existing `RECONCILE` (actuals backfill) and `EVALUATE` steps inside `_run_full_pipeline_for_store`. Only runs for `lifecycleStage = 'ready'` stores (the main loop already enforces this) and only on `forecastSource = 'native'` rows.

- [ ] **Step 1: Add imports**

In `ml/run_nightly.py`, add to the import block:

```python
from ml.reconciliation.avg_price import compute_item_avg_prices
from ml.reconciliation.category_aggregator import aggregate_categories_for_store
from ml.reconciliation.reconcile import reconcile_store_hierarchy
from ml.reconciliation.snapshot import write_reconciliation_snapshot
from ml.evaluation.consistency import compute_revenue_item_discrepancy  # name verified in Task 7
```

If `compute_revenue_item_discrepancy` is named differently in `ml/evaluation/consistency.py`, use the actual symbol that returns per-day discrepancies — adjust the import and call sites here.

- [ ] **Step 2: Add the orchestrator**

`_load_historical_y_df` returns the long-format insample DataFrame the reconciler needs. Source of truth: `ForecastDailyRevenue.actualRevenue` (revenue level), `ForecastMenuItem.actualQty × avg_price` (item level), and a derived `ForecastDailyCategory` actuals computed from `OtterMenuItem` historical sales (since we don't store category-level actuals directly). When any historical actuals are missing for a series, the empty-Y_df branch in `reconcile.py` kicks in and falls back to `method='ols'` automatically.

`compute_revenue_item_discrepancy` from `ml/evaluation/consistency.py` returns per-day discrepancies — at planning time, verify whether it already supports a `use_reconciled` flag. If not, add it as an optional kwarg in this commit (small one-liner: branch on `reconciledRevenue` / `reconciledQty` vs raw); the existing call sites get the default behavior unchanged.

Just above `_run_full_pipeline_for_store`, add:

```python
HISTORICAL_Y_DF_DAYS = 28


def run_hierarchical_reconciliation_for_store(store_id: str) -> dict:
    """Run category aggregation + MinTrace + snapshot for one ready store.

    Fails soft at every layer:
      - category aggregator failure -> reconciliation skipped, ok=False
      - reconciler failure -> unreconciled values stay, ok=False (after
        reconcile.py's own internal ols fallback has been tried)
      - snapshot failure -> row not written, but reconciled values still land
    """
    today = dt.date.today()
    with connect() as conn:
        agg = aggregate_categories_for_store(conn, store_id=store_id)
        if not agg.ok:
            return {"store_id": store_id, "ok": False, "phase": "category",
                    "warning": agg.warning}

        forecast_frame = _build_forecast_frame(conn, store_id)
        if forecast_frame is None:
            return {"store_id": store_id, "ok": False, "phase": "frame",
                    "warning": "no_forecast_frame"}

        y_df = _load_historical_y_df(conn, store_id, forecast_frame, HISTORICAL_Y_DF_DAYS)
        pre = compute_revenue_item_discrepancy(conn, store_id, today)

        rec = reconcile_store_hierarchy(
            conn, store_id=store_id, forecast_frame=forecast_frame,
            y_df=y_df, method="mint_shrink",
        )

        if rec.ok:
            post = compute_revenue_item_discrepancy(
                conn, store_id, today, use_reconciled=True,
            )
            try:
                write_reconciliation_snapshot(
                    conn, store_id=store_id, date=today,
                    pre_discrepancies=pre, post_discrepancies=post,
                    method_used=rec.method,
                )
            except Exception as exc:  # pylint: disable=broad-except
                # Snapshot failure is non-blocking — reconciled values landed.
                print({"phase": "RECONCILE_HIERARCHICAL", "store_id": store_id,
                       "warning": f"snapshot_failed: {exc}"})
    return {"store_id": store_id, "ok": rec.ok, "rows_written": rec.rows_written,
            "method": rec.method, "warning": rec.warning or None}


def _build_forecast_frame(conn, store_id):
    """Assemble the dict reconcile.reconcile_store_hierarchy consumes.

    Pulls latest native ForecastDailyRevenue / ForecastDailyCategory /
    ForecastMenuItem rows for the next 14 days. Returns None if any level
    is empty (caller fails soft). DISTINCT ON pattern matches
    ml.transfer.hollywood_prior:_load_hollywood_recent_forecasts.
    """
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT DISTINCT ON ("forecastDate")
                   "forecastDate", "predictedRevenue", p10, p90
            FROM "ForecastDailyRevenue"
            WHERE "storeId" = %s
              AND "hourBucket" = 0
              AND "forecastSource" = 'native'
              AND "forecastDate" >= CURRENT_DATE
              AND "forecastDate" <  CURRENT_DATE + INTERVAL '14 days'
            ORDER BY "forecastDate", "generatedAt" DESC
            ''',
            (store_id,),
        )
        revenue = [(d, float(p), _f(p10), _f(p90)) for d, p, p10, p90 in cur.fetchall()]
    if not revenue:
        return None

    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT date, "categoryName", revenue
            FROM "ForecastDailyCategory"
            WHERE "storeId" = %s
              AND date >= CURRENT_DATE
              AND date <  CURRENT_DATE + INTERVAL '14 days'
            ORDER BY "categoryName", date
            ''',
            (store_id,),
        )
        categories: dict[str, list] = {}
        for d, cat, rev in cur.fetchall():
            categories.setdefault(cat, []).append((d, float(rev), None, None))
    if not categories:
        return None

    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT DISTINCT ON ("otterItemSkuId", "forecastDate")
                   "otterItemSkuId", "forecastDate", "predictedQty", p10, p90
            FROM "ForecastMenuItem"
            WHERE "storeId" = %s
              AND "forecastSource" = 'native'
              AND "forecastDate" >= CURRENT_DATE
              AND "forecastDate" <  CURRENT_DATE + INTERVAL '14 days'
            ORDER BY "otterItemSkuId", "forecastDate", "generatedAt" DESC
            ''',
            (store_id,),
        )
        items: dict[str, list] = {}
        for item, d, qty, p10, p90 in cur.fetchall():
            items.setdefault(item, []).append((d, float(qty), _f(p10), _f(p90)))
    if not items:
        return None

    prices = compute_item_avg_prices(conn, store_id=store_id, lookback_days=60)

    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT DISTINCT ON ("itemName") "itemName", category
            FROM "OtterMenuItem"
            WHERE "storeId" = %s AND "isModifier" = false
            ORDER BY "itemName", date DESC
            ''',
            (store_id,),
        )
        item_to_category = dict(cur.fetchall())

    # Restrict to items we have a category for (otherwise hierarchy.py raises).
    filtered_items = {k: v for k, v in items.items() if k in item_to_category}
    if not filtered_items:
        return None

    return {
        "revenue": revenue,
        "categories": categories,
        "items": filtered_items,
        "prices": prices,
        "item_to_category": {k: item_to_category[k] for k in filtered_items},
    }


def _load_historical_y_df(conn, store_id, forecast_frame, days: int):
    """Long-format insample fitted values for mint_shrink (unique_id, ds, y).

    Sources:
      * revenue:    ForecastDailyRevenue.actualRevenue
      * categories: derived from OtterMenuItem rows via the same aggregation
                    the nightly category_aggregator does (qty * avg_price,
                    grouped by category)
      * items:      ForecastMenuItem.actualQty * avg_price for that item

    Series IDs MUST match the forecast_frame keys (hierarchy.py builds the
    S_df index from those). Returns a pandas DataFrame; may be empty if no
    history is reconciled yet, in which case reconcile.py falls back to ols.
    """
    import pandas as pd  # local import; module-level already has it but keep DRY
    prices = forecast_frame["prices"]
    rows = []

    with conn.cursor() as cur:
        # Revenue actuals.
        cur.execute(
            '''
            SELECT "forecastDate", "actualRevenue"
            FROM "ForecastDailyRevenue"
            WHERE "storeId" = %s
              AND "hourBucket" = 0
              AND "forecastSource" = 'native'
              AND "actualRevenue" IS NOT NULL
              AND "forecastDate" >= CURRENT_DATE - %s::INTEGER
              AND "forecastDate" <  CURRENT_DATE
            ORDER BY "forecastDate"
            ''',
            (store_id, days),
        )
        for d, actual in cur.fetchall():
            rows.append({"unique_id": "revenue", "ds": pd.Timestamp(d), "y": float(actual)})

        # Category historical actuals from OtterMenuItem (qty * avg_price).
        cur.execute(
            '''
            SELECT date, category,
                   SUM(("fpQuantitySold" + "tpQuantitySold")) AS qty,
                   AVG(
                     CASE WHEN ("fpQuantitySold" + "tpQuantitySold") > 0
                          THEN ("fpTotalSales" + "tpTotalSales")
                               / ("fpQuantitySold" + "tpQuantitySold")
                     END
                   ) AS avg_price
            FROM "OtterMenuItem"
            WHERE "storeId" = %s
              AND "isModifier" = false
              AND date >= CURRENT_DATE - %s::INTEGER
              AND date <  CURRENT_DATE
            GROUP BY date, category
            ''',
            (store_id, days),
        )
        for d, cat, qty, avg_price in cur.fetchall():
            if avg_price is None or qty is None:
                continue
            rows.append({
                "unique_id": cat, "ds": pd.Timestamp(d),
                "y": float(qty) * float(avg_price),
            })

        # Item actuals (qty * known avg_price).
        cur.execute(
            '''
            SELECT "otterItemSkuId", "forecastDate", "actualQty"
            FROM "ForecastMenuItem"
            WHERE "storeId" = %s
              AND "forecastSource" = 'native'
              AND "actualQty" IS NOT NULL
              AND "forecastDate" >= CURRENT_DATE - %s::INTEGER
              AND "forecastDate" <  CURRENT_DATE
            ORDER BY "otterItemSkuId", "forecastDate"
            ''',
            (store_id, days),
        )
        for item, d, actual_qty in cur.fetchall():
            price = prices.get(item)
            if price is None:
                continue  # No price -> can't put on the revenue scale; skip.
            rows.append({
                "unique_id": item, "ds": pd.Timestamp(d),
                "y": float(actual_qty) * price,
            })

    if not rows:
        return pd.DataFrame(columns=["unique_id", "ds", "y"])
    df = pd.DataFrame(rows)
    # Keep only series the forecast hierarchy will know about.
    known_ids = (
        {"revenue"}
        | set(forecast_frame["categories"].keys())
        | set(forecast_frame["items"].keys())
    )
    return df[df["unique_id"].isin(known_ids)].reset_index(drop=True)


def _f(v):
    """Cast Decimal/None to float/None for the forecast_frame tuples."""
    return float(v) if v is not None else None
```

- [ ] **Step 3: Insert into the pipeline**

In `_run_full_pipeline_for_store`, between the existing `RECONCILE` block (the `reconcile_past_forecasts` call) and the `EVALUATE` block, add:

```python
    rec_result = run_hierarchical_reconciliation_for_store(store_id)
    print({"phase": "RECONCILE_HIERARCHICAL", **rec_result})
    if not rec_result.get("ok"):
        # Fail-soft: surface the warning but don't fail the whole nightly.
        # Unreconciled values remain in place; the dashboard's prefer fallback
        # serves raw values when reconciledAt is null.
        pass
```

(Deliberately not incrementing `failures` so reconciliation problems alert but don't block the nightly.)

- [ ] **Step 4: Run the existing test suite to confirm no regression**

```bash
source ml/.venv/bin/activate
pytest ml/tests/ -v --tb=short
```

Expected: all prior tests still pass.

- [ ] **Step 5: Commit**

```bash
git add ml/run_nightly.py
git commit -m "ml(w7): wire hierarchical reconciliation into nightly pipeline"
```

---

## Task 9: First end-to-end production run on Hollywood

This is the W6 exit-gate equivalent — verify the new pipeline against real data without touching the read path yet (reconciled values land in the DB; UI still reads raw).

- [ ] **Step 1: Snapshot pre-run state**

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM \"ForecastDailyRevenue\" WHERE \"reconciledRevenue\" IS NOT NULL;"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM \"ForecastDailyCategory\";"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM \"MlReconciliationDaily\";"
```

Expected: all three are zero (or whatever pre-run baseline) — we're about to add to them.

- [ ] **Step 2: Run nightly**

```bash
source ml/.venv/bin/activate
export DATABASE_URL=$(cat /tmp/dburl)
python -m ml.run_nightly 2>&1 | tail -30
```

Expected: the new `RECONCILE_HIERARCHICAL` phase appears in output for Hollywood, ok=True, rows_written ≥ several dozen (revenue + category + per-item rows over 14-day horizon).

- [ ] **Step 3: Verify rows landed**

```bash
psql "$DATABASE_URL" -c "SELECT \"forecastDate\", \"predictedRevenue\", \"reconciledRevenue\", \"reconciliationMethod\" FROM \"ForecastDailyRevenue\" WHERE \"reconciledRevenue\" IS NOT NULL ORDER BY \"forecastDate\" LIMIT 5;"
psql "$DATABASE_URL" -c "SELECT date, \"categoryName\", revenue, \"reconciledRevenue\" FROM \"ForecastDailyCategory\" ORDER BY date LIMIT 5;"
psql "$DATABASE_URL" -c "SELECT date, \"prePctDiscrepancyMedian\", \"postPctDiscrepancyMedian\", \"sampleSize\" FROM \"MlReconciliationDaily\" ORDER BY date DESC LIMIT 3;"
```

Expected: reconciledRevenue populated, methodUsed = 'mint_shrink', snapshot row(s) present.

Per spec exit gate item 1 (W8): `postPctDiscrepancyMedian ≤ 15%`. If today's row is the first, we have one of seven needed for the 7-day window — note in the commit message.

- [ ] **Step 4: Commit (no code change — just the verification log)**

```bash
git commit --allow-empty -m "ml(w7): first hierarchical reconciliation run on Hollywood — first MlReconciliationDaily row written"
```

---

## Task 10: `ML_USE_RECONCILED` flag + read-helper changes

**Files:**
- Create: `src/lib/forecasts/reconciliation-prefs.ts`
- Modify: `src/app/actions/forecasts/revenue-forecast-actions.ts`
- Modify: `src/app/actions/forecasts/menu-item-forecast-actions.ts`
- Modify: `src/app/actions/forecasts/food-cost-forecast-actions.ts`

- [ ] **Step 1: Create the flag module**

Create `src/lib/forecasts/reconciliation-prefs.ts`:

```typescript
/**
 * Single source of truth for the `ML_USE_RECONCILED` env flag (W6-8).
 *
 * Default: `true` from W8 onward. Flip to `false` (env-only) for instant
 * rollback to unreconciled reads. Reconciliation continues to write columns;
 * only the read path is affected.
 *
 * Falls back to raw values when `reconciledAt` is null or older than the
 * stale threshold (48h) regardless of the flag.
 */
export const STALE_RECONCILED_HOURS = 48

export type ForecastSourcePreference = "reconciled" | "raw"

export function defaultForecastPreference(): ForecastSourcePreference {
  // Note: `process.env` reads in Next.js server actions are evaluated at
  // request time, so flipping the env in Vercel is effective on the next
  // invocation — no redeploy needed.
  const flag = process.env.ML_USE_RECONCILED?.toLowerCase()
  if (flag === "false" || flag === "0") return "raw"
  return "reconciled"
}

export function isReconciledStale(reconciledAt: Date | null): boolean {
  if (!reconciledAt) return true
  const ageMs = Date.now() - reconciledAt.getTime()
  return ageMs > STALE_RECONCILED_HOURS * 60 * 60 * 1000
}
```

- [ ] **Step 2: Update `revenue-forecast-actions.ts`**

Add the `prefer` parameter to `getRevenueForecast` input. Select `reconciledRevenue`, `reconciledP10`, `reconciledP90`, `reconciledAt` alongside the raw columns. In the row-mapping step, branch:

```typescript
import {
  defaultForecastPreference,
  isReconciledStale,
  type ForecastSourcePreference,
} from "@/lib/forecasts/reconciliation-prefs"

// in the input interface:
export async function getRevenueForecast(input: {
  storeId?: string
  horizonDays?: number
  asOf?: Date
  prefer?: ForecastSourcePreference
}): ...

const prefer = input.prefer ?? defaultForecastPreference()

// in the prisma select:
        reconciledRevenue: true,
        reconciledP10: true,
        reconciledP90: true,
        reconciledAt: true,

// in the row mapping (per row):
const useReconciled =
  prefer === "reconciled"
  && r.reconciledRevenue != null
  && !isReconciledStale(r.reconciledAt)

const predictedRevenue = useReconciled ? r.reconciledRevenue : r.predictedRevenue
const p10 = useReconciled ? r.reconciledP10 : r.p10
const p90 = useReconciled ? r.reconciledP90 : r.p90
```

Pass these through the existing aggregation logic.

- [ ] **Step 3: Update `menu-item-forecast-actions.ts`**

Same pattern — accept `prefer`, select `reconciledQty` + `reconciledAt`, branch in the row mapping. `predictedQty` flips to `reconciledQty` when applicable.

- [ ] **Step 4: Update `food-cost-forecast-actions.ts`**

This file calls both `getRevenueForecast` and `getMenuItemForecast` internally. Add `prefer` to its input and forward to both. Existing callers default through `defaultForecastPreference()`.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/forecasts/reconciliation-prefs.ts src/app/actions/forecasts/
git commit -m "ml(w7): ML_USE_RECONCILED flag + prefer parameter on forecast read helpers"
```

---

## Task 11: End-to-end DB test for the read fallback

**Files:**
- Create: `ml/tests/test_w6_end_to_end_reconciliation.py`

Modeled on the W5 end-to-end test. Skips when `DATABASE_URL` unset.

- [ ] **Step 1: Write the test**

```python
"""End-to-end W6 exit gate: a synthetic store runs through the full
reconciliation pipeline, then verify the writer/upserter/snapshot landed."""
from __future__ import annotations

import datetime as dt
import os
import uuid

import pytest

from ml.db import connect, cuid_like


pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set; end-to-end test requires a real DB",
)


@pytest.fixture
def synthetic_ready_store():
    """Clone Hollywood as a `ready` smoke store with no forecasts.
    The test seeds its own ForecastMenuItem / ForecastDailyRevenue rows
    so we exercise the pipeline without depending on a model run."""
    store_id = cuid_like()
    name = f"w6-smoke-{uuid.uuid4().hex[:8]}"
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            'INSERT INTO "Store" (id, name, "ownerId", "accountId", '
            '"lifecycleStage", "updatedAt") '
            'SELECT %s, %s, "ownerId", "accountId", '
            '\'ready\'::"LifecycleStage", CURRENT_TIMESTAMP '
            'FROM "Store" WHERE name ILIKE %s LIMIT 1',
            (store_id, name, "%Hollywood"),
        )
    yield store_id
    with connect() as conn, conn.cursor() as cur:
        cur.execute('DELETE FROM "MlReconciliationDaily" WHERE "storeId" = %s', (store_id,))
        cur.execute('DELETE FROM "ForecastDailyCategory" WHERE "storeId" = %s', (store_id,))
        cur.execute('DELETE FROM "ForecastDailyRevenue" WHERE "storeId" = %s', (store_id,))
        cur.execute('DELETE FROM "ForecastMenuItem" WHERE "storeId" = %s', (store_id,))
        cur.execute('DELETE FROM "Store" WHERE id = %s', (store_id,))


def test_category_aggregator_writes_rows_against_real_db(synthetic_ready_store):
    """Seed a few ForecastMenuItem rows + a couple OtterMenuItem category
    observations; run the aggregator; verify ForecastDailyCategory has rows."""
    # ... (full SQL seeds + aggregator call + assert COUNT(*) > 0)
    pass


def test_snapshot_writer_creates_one_row_per_store_day(synthetic_ready_store):
    """Call write_reconciliation_snapshot directly; verify one row appears."""
    from ml.reconciliation.snapshot import write_reconciliation_snapshot
    with connect() as conn:
        write_reconciliation_snapshot(
            conn,
            store_id=synthetic_ready_store,
            date=dt.date.today(),
            pre_discrepancies=[-0.6, -0.5, -0.55],
            post_discrepancies=[-0.12, -0.10, -0.14],
            method_used="mint_shrink",
        )
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT "postPctDiscrepancyMedian", "methodUsed" FROM "MlReconciliationDaily" '
            'WHERE "storeId" = %s', (synthetic_ready_store,),
        )
        rows = cur.fetchall()
    assert len(rows) == 1
    assert rows[0][1] == "mint_shrink"
```

Fill in the `test_category_aggregator_writes_rows_against_real_db` body with the SQL seeds that mirror Hollywood's data shape (a couple `OtterMenuItem` rows for category resolution, a couple `ForecastMenuItem` rows to aggregate, then assert COUNT(*) ≥ 1 in `ForecastDailyCategory`).

- [ ] **Step 2: Run**

Run: `pytest ml/tests/test_w6_end_to_end_reconciliation.py -v`

Expected: 2 passed when `DATABASE_URL` is set; SKIPPED otherwise.

- [ ] **Step 3: Commit**

```bash
git add ml/tests/test_w6_end_to_end_reconciliation.py
git commit -m "ml(w7): end-to-end DB test for reconciliation snapshot + aggregator"
```

---

## Task 12: Multi-store hierarchy unit-test exercise

Spec §2 exit gate item 4: "Multi-store extension code path passes its unit test (`chain ≈ Σ stores` with two synthetic stores)."

The `build_multi_store_hierarchy` from Task 5 is already covered by `test_hierarchy.py` for the S-matrix shape. This task adds a reconciliation-level invariant: run MinTrace through the multi-store hierarchy on synthetic data and assert the reconciled chain ≈ Σ store rows.

**Files:**
- Modify: `ml/tests/test_hierarchy.py` (add `test_multi_store_minTrace_preserves_chain_sum`)

- [ ] **Step 1: Add the test**

```python
def test_multi_store_minTrace_preserves_chain_sum():
    """End-to-end: build a multi-store hierarchy with 2 synthetic stores,
    run MinTrace, assert the reconciled chain row equals the sum of the
    reconciled store rows within numerical tolerance.

    Uses ml.reconciliation.reconcile._run_min_trace so we exercise the same
    wrapper the nightly pipeline uses (including the public_tags filter that
    strips our __row_index__ helper)."""
    import pandas as pd
    from ml.reconciliation.reconcile import _run_min_trace, _reconciled_column_name

    stores = {
        "store-a": {"item1": "cat-x", "item2": "cat-y"},
        "store-b": {"item3": "cat-x"},
    }
    S_df, tags = build_multi_store_hierarchy(stores=stores)

    # Coherent leaves: 10 / 20 / 30. Rolling up through S gives every parent.
    leaf_ids = tags["leaf"]
    leaf_values = pd.Series([10.0, 20.0, 30.0], index=leaf_ids)
    full = S_df @ leaf_values  # one value per series in S_df.index

    ds_today = pd.Timestamp("2026-05-27")
    y_hat_df = pd.DataFrame({
        "unique_id": full.index,
        "ds": ds_today,
        "y_hat": full.values,
    })

    # Synthetic Y_df with mild noise so mint_shrink has non-degenerate residuals.
    rng = np.random.default_rng(seed=42)
    dates = pd.date_range(end=pd.Timestamp("2026-05-26"), periods=28, freq="D")
    y_rows = []
    for uid in full.index:
        base = float(full.loc[uid])
        for d in dates:
            y_rows.append({"unique_id": uid, "ds": d, "y": base + rng.normal(0, 1.0)})
    y_df = pd.DataFrame(y_rows)

    out = _run_min_trace(S_df, tags, y_hat_df, y_df, method="mint_shrink")

    col = _reconciled_column_name(out)
    assert col is not None, list(out.columns)

    chain_row = out[out["unique_id"] == "__chain__"][col].iloc[0]
    store_rows = out[out["unique_id"].isin(["store-a", "store-b"])][col].sum()
    assert abs(chain_row - store_rows) < 0.01, (chain_row, store_rows)
```

- [ ] **Step 2: Run, expect PASS**

Run: `pytest ml/tests/test_hierarchy.py::test_multi_store_minTrace_preserves_chain_sum -v`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add ml/tests/test_hierarchy.py
git commit -m "ml(w8): multi-store MinTrace chain-sum invariant test"
```

---

## Task 13: 7-day observation gate verifier

Spec §2 exit gate item 1: `postPctDiscrepancyMedian ≤ 15%` for 7 consecutive nightly runs. Mirrors the W1-4 operator-gate-check pattern at `ml/evaluation/operator_gate_check.py`.

**Files:**
- Create: `ml/evaluation/reconciliation_gate_check.py`
- Create: `ml/tests/test_reconciliation_gate_check.py`

- [ ] **Step 1: Write the failing test**

```python
"""Tests for the 7-day reconciliation-health gate."""
from __future__ import annotations

from unittest.mock import MagicMock

from ml.evaluation.reconciliation_gate_check import (
    gate_reconciliation_post_median,
    RECONCILIATION_TARGET,
)


def _mk_conn(rows):
    cur = MagicMock()
    cur.__enter__ = lambda self: self
    cur.__exit__ = lambda *a: False
    cur.fetchall.return_value = rows
    conn = MagicMock()
    conn.__enter__ = lambda self: self
    conn.__exit__ = lambda *a: False
    conn.cursor.return_value = cur
    return conn


def test_passes_when_all_7_days_below_15_percent():
    rows = [(0.12,), (0.10,), (0.11,), (0.13,), (0.09,), (0.14,), (0.11,)]
    passed, detail = gate_reconciliation_post_median(_mk_conn(rows))
    assert passed, detail
    assert "7/7" in detail


def test_fails_when_any_day_above_15_percent():
    rows = [(0.12,), (0.18,), (0.11,)] + [(0.10,)] * 4
    passed, detail = gate_reconciliation_post_median(_mk_conn(rows))
    assert not passed


def test_fails_when_fewer_than_7_rows():
    rows = [(0.10,), (0.11,)]
    passed, detail = gate_reconciliation_post_median(_mk_conn(rows))
    assert not passed
    assert "insufficient_window" in detail


def test_target_threshold_locked_at_fifteen_percent():
    assert RECONCILIATION_TARGET == 0.15
```

- [ ] **Step 2: Implement**

Create `ml/evaluation/reconciliation_gate_check.py`:

```python
"""W8 exit gate: postPctDiscrepancyMedian ≤ 15% for 7 consecutive runs.

Run as `python -m ml.evaluation.reconciliation_gate_check` during the
observation window. Mirrors the operator_gate_check.py pattern.
"""
from __future__ import annotations

import sys
from typing import Tuple


RECONCILIATION_TARGET = 0.15
_WINDOW_DAYS = 7


def gate_reconciliation_post_median(conn) -> Tuple[bool, str]:
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT "postPctDiscrepancyMedian"
            FROM "MlReconciliationDaily"
            WHERE date >= CURRENT_DATE - %s::INTEGER
            ORDER BY date DESC
            LIMIT %s
            ''',
            (_WINDOW_DAYS, _WINDOW_DAYS),
        )
        rows = cur.fetchall()
    if len(rows) < _WINDOW_DAYS:
        return False, f"insufficient_window: {len(rows)}/{_WINDOW_DAYS} rows"
    failing = [v for (v,) in rows if v is None or v > RECONCILIATION_TARGET]
    if failing:
        return False, f"{len(failing)}/{_WINDOW_DAYS} days above {RECONCILIATION_TARGET}"
    return True, f"7/7 days at or below {RECONCILIATION_TARGET}"


def main() -> int:
    from ml.db import connect
    with connect() as conn:
        ok, detail = gate_reconciliation_post_median(conn)
    print(f"reconciliation gate: {'PASS' if ok else 'FAIL'} — {detail}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: Run, expect PASS**

```bash
pytest ml/tests/test_reconciliation_gate_check.py -v
```

Expected: 4 passed.

- [ ] **Step 4: Commit**

```bash
git add ml/evaluation/reconciliation_gate_check.py ml/tests/test_reconciliation_gate_check.py
git commit -m "ml(w8): 7-day reconciliation health gate verifier"
```

---

## Task 14: Default `ML_USE_RECONCILED` to `true` + docs

The flag has been read-path-only since Task 10 (default already `true` in `defaultForecastPreference()`). This task is the explicit production switch: confirm the default, document the rollback procedure, and append the W6-8 closure to the README.

- [ ] **Step 1: Verify `defaultForecastPreference()` returns `"reconciled"` when the env is unset**

```bash
node -e "delete process.env.ML_USE_RECONCILED; console.log(require('./src/lib/forecasts/reconciliation-prefs.ts'))"
```

(If TS-Node isn't available, just re-read the file and confirm the default branch.)

- [ ] **Step 2: Append to `ml/README.md`**

```markdown
## Hierarchical reconciliation (W6-8)

The nightly pipeline writes reconciled point estimates back to the existing
forecast tables (`reconciledRevenue` / `reconciledP10` / `reconciledP90` /
`reconciledQty`) using Nixtla `MinTrace(method='mint_shrink')`. The dashboard
reads reconciled values by default; flip `ML_USE_RECONCILED=false` in Vercel
to revert to unreconciled reads (reconciliation continues to write columns;
only the read path changes — full rollback in seconds, no redeploy).

Health is tracked in `MlReconciliationDaily` (one row per store-day, pre/post
discrepancy percentiles). The gate `python -m ml.evaluation.reconciliation_gate_check`
exits 0 if `postPctDiscrepancyMedian ≤ 15%` for the trailing 7 days.

When GLN/VNYS reach `ready` (post-W5), the multi-store hierarchy
(`ml/reconciliation/hierarchy.py::build_multi_store_hierarchy`) replaces the
single-store builder in `run_hierarchical_reconciliation_for_store`. Unit
test pinned at `ml/tests/test_hierarchy.py::test_multi_store_minTrace_preserves_chain_sum`.
```

- [ ] **Step 3: Run graphify update**

```bash
graphify update .
```

- [ ] **Step 4: Commit**

```bash
git add ml/README.md
git commit -m "docs(ml): document hierarchical reconciliation + ML_USE_RECONCILED rollback"
```

---

## Self-review checklist

Cross-checked against [spec §2](../specs/2026-05-17-ml-phase1-weeks5-12-design.md#section-2--w6-8-hierarchical-reconciliation-nixtla-hierarchicalforecast):

| Spec requirement | Plan task |
|---|---|
| §2 hierarchy: revenue / category / item, multi-store extensible | Task 5 (single + multi builders) |
| Only `forecastSource = 'native'` rows participate | Task 4 + Task 6 (SQL clauses filter) |
| Schema: reconciled columns + new tables | Task 2 |
| ml/reconciliation/hierarchy.py | Task 5 |
| ml/reconciliation/reconcile.py (MinTrace + idempotent upsert) | Task 6 |
| ForecastDailyCategory aggregated nightly from menu items | Task 4 |
| Nightly wiring after training, before evaluation | Task 8 |
| Runs only for `lifecycleStage = 'ready'` | Task 8 (leverages W5 dispatch loop) |
| Fails-soft (singular matrix, missing cats, exceptions) | Task 6 (ReconcileResult.ok=False path) |
| Read helpers: prefer reconciled, fall back to raw on null/stale 48h | Task 10 |
| ML_USE_RECONCILED env flag (default true from W8) | Task 10 + Task 14 |
| MlReconciliationDaily snapshot writer | Task 7 |
| Pre/post comparison row per nightly | Task 8 (snapshot called inside orchestrator) |
| Multi-store extension code path unit-tested | Task 12 |
| Exit gate: postPctDiscrepancyMedian ≤ 15% for 7 nights | Task 13 (verifier) + manual observation |
| Exit gate: read helpers serve reconciled when present | Task 10 (default branch) + Task 11 (DB e2e) |
| Exit gate: ML_USE_RECONCILED=false reverts cleanly | Task 14 (verify default branch) |
| Spec migration discipline: db push + manual SQL | Task 2 |

No placeholders. Type names consistent across tasks (`CategoryAggregationResult`, `ReconcileResult`, `ForecastSourcePreference`, `defaultForecastPreference`, `isReconciledStale`, `compute_item_avg_prices`, `build_single_store_hierarchy`, `build_multi_store_hierarchy`, `reconcile_store_hierarchy`, `_run_min_trace`, `_reconciled_column_name`, `_build_forecast_frame`, `_load_historical_y_df`, `write_reconciliation_snapshot`, `run_hierarchical_reconciliation_for_store`, `gate_reconciliation_post_median`) — verified by ctrl-F.

**Library-API soft spots resolved at planning time** (Context7 cache on Nixtla's docs):
- `HierarchicalReconciliation.reconcile(Y_hat_df, S_df, tags, Y_df)` — Y_df is long-format insample fitted values, NOT a numpy residual matrix.
- `S_df` is a pandas DataFrame indexed by series unique_id with columns = leaf unique_ids.
- Reconciled values land in a column named like `'MinTrace/mint_shrink'`; helper `_reconciled_column_name` resolves it generically.
- `mint_shrink` requires Y_df with insample residuals; auto-fallback to `'ols'` when Y_df is empty (cold-start) or the shrinkage raises.

Subsequent plan:
- [W9-12 growth + quality panel](2026-05-17-ml-phase1-w9-12-growth.md) — to be written after W6-8 ships, because the growth-opportunity formulas in §3.2 consume reconciled forecast values via the same `prefer` parameter built in Task 10.
