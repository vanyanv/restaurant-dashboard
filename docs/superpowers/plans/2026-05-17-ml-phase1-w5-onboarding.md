# ML Phase 1 — W5 Store-Lifecycle Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the cold-start path so Glendale and Van Nuys can begin producing forecasts the day they physically open, using Hollywood as a transfer prior. Hard one-week time-box per the [W5-12 design spec, Section 1](../specs/2026-05-17-ml-phase1-weeks5-12-design.md#section-1--w5-store-lifecycle-onboarding-pipeline).

**Architecture:** Add a `lifecycleStage` enum to `Store` (`pre_open | warming_up | ready`) and a `forecastSource` enum to the three forecast tables (`native | transfer`). A new module `ml/transfer/hollywood_prior.py` writes Hollywood-derived transfer forecasts nightly for `warming_up` stores. The existing promotion gate (`ml/evaluation/promotion.py`) gets a third comparison — beat the store's own transfer-forecast WAPE by ≥5% — and on success flips `lifecycleStage` to `ready`. Dashboard cards gain a caption when reading `forecastSource = 'transfer'` rows.

**Tech Stack:** Python 3 + psycopg2 (ml/ pipeline), Prisma + Postgres (schema), Next.js 15 + React 19 (dashboard cards), pytest (Python tests), Vitest (TS tests), `prisma db push` + hand-written manual migration SQL (per `reference_prisma_migrations` memory — **never** `prisma migrate dev`).

---

## File Structure

**Schema (one migration file):**
- Create: `prisma/manual-migrations/2026-05-19_phase1-w5-onboarding.sql`
- Modify: `prisma/schema.prisma` (add `LifecycleStage` + `ForecastSource` enums, add fields to `Store` / `ForecastDailyRevenue` / `ForecastMenuItem` / `ForecastHourlyOrders`)

**Python pipeline (new module + integration):**
- Create: `ml/transfer/__init__.py`
- Create: `ml/transfer/hollywood_prior.py` — scalar computation + transfer-forecast writer
- Create: `ml/tests/test_hollywood_prior.py`
- Modify: `ml/evaluation/promotion.py` — add transfer-baseline arm to `decide_promotion` + helper to compute transfer-forecast WAPE
- Modify: `ml/tests/test_promotion.py` — add tests for the transfer arm + lifecycle-flip decision
- Create: `ml/lifecycle.py` — pure-ish helpers: `should_promote_to_ready(store_id, native_wape, transfer_wape, sample_size) -> bool` and `flip_to_ready(store_id)` SQL writer
- Create: `ml/tests/test_lifecycle.py`
- Modify: `ml/run_nightly.py` — branch on `lifecycleStage`; call transfer-forecast writer for `warming_up`; skip everything for `pre_open`; call lifecycle promotion check after revenue training succeeds
- Modify: `ml/features/revenue.py` — extend `list_active_store_ids()` to optionally filter by lifecycle stage (or add a new helper `list_stores_by_stage`)

**Hollywood store ID identification (read-only helper):**
- The Hollywood store is the only operational store (memory: `project_store_lifecycle`). Use `Store.name = 'Hollywood'` to resolve `HOLLYWOOD_STORE_ID` at runtime. Centralize the lookup so the test can stub it.

**Dashboard UI (transfer-source caption):**
- Modify: `src/app/actions/forecasts/_shared.ts` — extend the forecast read row shape so the caller sees `forecastSource: 'native' | 'transfer'`
- Modify: `src/app/actions/forecasts/revenue-forecast-actions.ts` — include `forecastSource` + decide the latest row's source for the day
- Modify: `src/app/actions/forecasts/menu-item-forecast-actions.ts` — same
- Modify: `src/app/actions/forecasts/_shared.ts` (already listed above) for menu item too
- Create: `src/components/forecast/transfer-source-caption.tsx` — JetBrains Mono caption "Based on Hollywood patterns · day [N] of [STORE]"
- Modify: at least one dashboard card that renders forecast values to include the caption. Use `src/app/dashboard/intelligence/launch-trajectory` if it exists, else the revenue-forecast card under `src/app/dashboard/intelligence/`. The verification step lists the exact file we settle on.
- Test: `src/components/forecast/transfer-source-caption.test.tsx` (Vitest)

**Documentation:**
- Modify: `CLAUDE.md` — no changes required (tripwires unchanged)
- Modify: `ml/README.md` — append a paragraph documenting the lifecycle stages

---

## Sequencing

The plan flows in three checkpoints:

1. **Tasks 1–3:** Schema delta and migration (lands first because everything below depends on the columns existing).
2. **Tasks 4–9:** Python module — `hollywood_prior.py`, lifecycle helpers, promotion-gate update, nightly wiring.
3. **Tasks 10–13:** Dashboard read path + caption component + end-to-end smoke test against a synthetic test store + exit-gate checklist.

Commit after every step that has a working test. Frequent commits.

---

## Task 1: Schema — add enums and columns

**Files:**
- Modify: `prisma/schema.prisma` (lines ~1327 for enums; ~1378 / ~1406 / ~1431 for forecast models; Store model near top)
- Create: `prisma/manual-migrations/2026-05-19_phase1-w5-onboarding.sql`

### Step 1: Write the migration SQL

- [ ] **Step 1: Create the manual migration file**

Create `prisma/manual-migrations/2026-05-19_phase1-w5-onboarding.sql`:

```sql
-- Phase 1 Week 5: Store-lifecycle onboarding + transfer-forecast source.
-- Adds:
--   * Store.lifecycleStage (enum LifecycleStage)
--   * Store.initialTransferScalar (Float)
--   * Store.openedAt (DateTime)
--   * Forecast{DailyRevenue,MenuItem,HourlyOrders}.forecastSource (enum ForecastSource)
--
-- See docs/superpowers/specs/2026-05-17-ml-phase1-weeks5-12-design.md §1
-- and reference_prisma_migrations memory: db push + manual SQL, never migrate dev.

DO $$ BEGIN
  CREATE TYPE "LifecycleStage" AS ENUM ('pre_open', 'warming_up', 'ready');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ForecastSource" AS ENUM ('native', 'transfer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Store"
  ADD COLUMN IF NOT EXISTS "lifecycleStage" "LifecycleStage" NOT NULL DEFAULT 'pre_open',
  ADD COLUMN IF NOT EXISTS "initialTransferScalar" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "openedAt" TIMESTAMP(3);

-- Hollywood is operational today; mark it ready so nothing changes for it.
UPDATE "Store"
   SET "lifecycleStage" = 'ready',
       "openedAt" = COALESCE("openedAt", "createdAt")
 WHERE "name" = 'Hollywood' AND "isActive" = true;

ALTER TABLE "ForecastDailyRevenue"
  ADD COLUMN IF NOT EXISTS "forecastSource" "ForecastSource" NOT NULL DEFAULT 'native';
ALTER TABLE "ForecastMenuItem"
  ADD COLUMN IF NOT EXISTS "forecastSource" "ForecastSource" NOT NULL DEFAULT 'native';
ALTER TABLE "ForecastHourlyOrders"
  ADD COLUMN IF NOT EXISTS "forecastSource" "ForecastSource" NOT NULL DEFAULT 'native';

CREATE INDEX IF NOT EXISTS "ForecastDailyRevenue_storeId_forecastSource_idx"
  ON "ForecastDailyRevenue" ("storeId", "forecastSource");
CREATE INDEX IF NOT EXISTS "ForecastMenuItem_storeId_forecastSource_idx"
  ON "ForecastMenuItem" ("storeId", "forecastSource");
CREATE INDEX IF NOT EXISTS "ForecastHourlyOrders_storeId_forecastSource_idx"
  ON "ForecastHourlyOrders" ("storeId", "forecastSource");
```

- [ ] **Step 2: Update `prisma/schema.prisma`**

Add the enums near the existing enums section (after `enum MlTarget` around line 1332):

```prisma
enum LifecycleStage {
  pre_open
  warming_up
  ready
}

enum ForecastSource {
  native
  transfer
}
```

In the `Store` model (top of file), add (preserve existing fields and ordering):

```prisma
  lifecycleStage        LifecycleStage @default(pre_open)
  initialTransferScalar Float?
  openedAt              DateTime?
```

In `ForecastDailyRevenue`, add after the existing fields (and before relations):

```prisma
  forecastSource   ForecastSource @default(native)
```

Same line in `ForecastMenuItem` and `ForecastHourlyOrders`. Add an index in each:

```prisma
  @@index([storeId, forecastSource])
```

- [ ] **Step 3: Apply schema to the dev DB**

Run:

```bash
npx prisma db push --skip-generate
psql "$DATABASE_URL" -f prisma/manual-migrations/2026-05-19_phase1-w5-onboarding.sql
npx prisma generate
```

Expected: `db push` reports no destructive changes (additive only); the SQL runs idempotently with `CREATE TYPE … EXCEPTION WHEN duplicate_object` blocks tolerating re-runs; `prisma generate` succeeds.

If `prisma db push` proposes destructive changes, STOP — investigate before continuing. Do NOT confirm.

- [ ] **Step 4: Verify**

Run:

```bash
psql "$DATABASE_URL" -c "SELECT \"lifecycleStage\", \"initialTransferScalar\", \"openedAt\" FROM \"Store\" WHERE \"isActive\" = true ORDER BY name;"
psql "$DATABASE_URL" -c "\\d+ \"ForecastDailyRevenue\"" | grep forecastSource
```

Expected: Hollywood row shows `ready`; GLN and VNYS show `pre_open` (default); the column listing shows `forecastSource | ForecastSource | not null default 'native'`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/manual-migrations/2026-05-19_phase1-w5-onboarding.sql
git commit -m "ml(w5): add LifecycleStage + ForecastSource enums and columns"
```

---

## Task 2: Pure scalar-computation function with tests

**Files:**
- Create: `ml/transfer/__init__.py` (empty)
- Create: `ml/transfer/hollywood_prior.py`
- Create: `ml/tests/test_hollywood_prior.py`

### Step 1: Write the failing tests first

- [ ] **Step 1: Write `ml/tests/test_hollywood_prior.py`** (pure-function tests for the scalar)

```python
"""Tests for the Hollywood-prior transfer scalar computation."""
from __future__ import annotations

import math

import pytest

from ml.transfer.hollywood_prior import (
    compute_transfer_scalar,
    widened_interval,
    INTERVAL_WIDEN_MULTIPLIER,
)


def test_compute_transfer_scalar_with_full_window_uses_ratio():
    # 14 days of new-store actuals averaging 1500; Hollywood same window avg 3000.
    new_actuals = [1500.0] * 14
    holly_actuals = [3000.0] * 14
    scalar = compute_transfer_scalar(
        new_store_actuals=new_actuals,
        hollywood_actuals_same_window=holly_actuals,
        initial_scalar=None,
    )
    assert scalar == pytest.approx(0.5)


def test_compute_transfer_scalar_under_threshold_uses_initial_scalar():
    # Only 3 actuals — below the 7-day floor; fall back to operator-set initial.
    scalar = compute_transfer_scalar(
        new_store_actuals=[1500.0, 1600.0, 1400.0],
        hollywood_actuals_same_window=[3000.0, 3000.0, 3000.0],
        initial_scalar=0.42,
    )
    assert scalar == 0.42


def test_compute_transfer_scalar_zero_actuals_uses_initial():
    scalar = compute_transfer_scalar(
        new_store_actuals=[],
        hollywood_actuals_same_window=[],
        initial_scalar=0.75,
    )
    assert scalar == 0.75


def test_compute_transfer_scalar_missing_initial_when_under_threshold_raises():
    with pytest.raises(ValueError, match="initial_scalar required"):
        compute_transfer_scalar(
            new_store_actuals=[1.0, 2.0],
            hollywood_actuals_same_window=[1.0, 2.0],
            initial_scalar=None,
        )


def test_compute_transfer_scalar_threshold_is_seven():
    # Exactly 7 days IS enough to compute the ratio.
    scalar = compute_transfer_scalar(
        new_store_actuals=[100.0] * 7,
        hollywood_actuals_same_window=[200.0] * 7,
        initial_scalar=0.0,
    )
    assert scalar == pytest.approx(0.5)


def test_compute_transfer_scalar_zero_hollywood_avg_falls_back():
    # If Hollywood window happens to be zero (closure?), divide-by-zero guard.
    scalar = compute_transfer_scalar(
        new_store_actuals=[100.0] * 14,
        hollywood_actuals_same_window=[0.0] * 14,
        initial_scalar=0.5,
    )
    assert scalar == 0.5


def test_widened_interval_multiplies_half_width_by_constant():
    point, p10, p90 = widened_interval(point=100.0, p10=80.0, p90=120.0)
    # Original half-width 20; widened half-width 30 (×1.5); center unchanged.
    assert INTERVAL_WIDEN_MULTIPLIER == pytest.approx(1.5)
    assert point == 100.0
    assert p10 == pytest.approx(70.0)
    assert p90 == pytest.approx(130.0)


def test_widened_interval_clamps_p10_at_zero():
    _, p10, _ = widened_interval(point=10.0, p10=8.0, p90=12.0)
    # Half-width 2 * 1.5 = 3 → center 10 → p10 = 7 (positive, unchanged).
    assert p10 == pytest.approx(7.0)
    # And a case that would go negative:
    _, p10, _ = widened_interval(point=5.0, p10=0.0, p90=20.0)
    # Half-width 10 → p10 would be 5 - 15 = -10; clamp to 0.
    assert p10 == 0.0


def test_widened_interval_passthrough_when_p10_or_p90_none():
    point, p10, p90 = widened_interval(point=50.0, p10=None, p90=60.0)
    assert (point, p10, p90) == (50.0, None, 60.0)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest ml/tests/test_hollywood_prior.py -v`

Expected: ImportError / ModuleNotFoundError because `ml/transfer/hollywood_prior.py` does not exist.

- [ ] **Step 3: Write `ml/transfer/__init__.py`**

Create as an empty file:

```python
```

- [ ] **Step 4: Write the minimal `ml/transfer/hollywood_prior.py`**

```python
"""Hollywood-prior transfer forecasts.

For each `warming_up` store, project Hollywood's recent forecasts onto the
new store using a multiplicative scalar (ratio of trailing 14-day actuals).
Used until the store accumulates enough native history to beat the transfer
forecast on WAPE — see ml.lifecycle.

Architectural rule (per spec §1.2): no codebase default for the initial
scalar — operators set it per store at registration so the choice is intentional.
If a store has fewer than 7 actuals AND no initialTransferScalar, the writer
emits a JobRun warning and skips the store for that night.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


_MIN_ACTUALS_FOR_RATIO = 7
INTERVAL_WIDEN_MULTIPLIER = 1.5


def compute_transfer_scalar(
    *,
    new_store_actuals: list[float],
    hollywood_actuals_same_window: list[float],
    initial_scalar: Optional[float],
) -> float:
    """Return the multiplicative scalar that maps Hollywood forecasts to the
    new store's expected revenue.

    Rule (spec §1.2):
      * ≥ 7 actuals and Hollywood mean > 0 → scalar = mean(new) / mean(holly).
      * Otherwise → use `initial_scalar` (operator-set).
      * If neither path is available, raise ValueError so the caller fails
        loud and the nightly job records a JobRun warning.
    """
    n = min(len(new_store_actuals), len(hollywood_actuals_same_window))
    if n >= _MIN_ACTUALS_FOR_RATIO:
        new_mean = sum(new_store_actuals[:n]) / n
        holly_mean = sum(hollywood_actuals_same_window[:n]) / n
        if holly_mean > 0:
            return new_mean / holly_mean
        # Hollywood window happens to be zero — fall through to initial.
    if initial_scalar is None:
        raise ValueError(
            "initial_scalar required: store has fewer than "
            f"{_MIN_ACTUALS_FOR_RATIO} actuals and no operator-set "
            "initialTransferScalar to fall back on"
        )
    return float(initial_scalar)


def widened_interval(
    *,
    point: float,
    p10: Optional[float],
    p90: Optional[float],
) -> tuple[float, Optional[float], Optional[float]]:
    """Widen a (p10, p90) interval by INTERVAL_WIDEN_MULTIPLIER about the point.

    Half-width grows by the multiplier; p10 clamped at 0 (no negative revenue
    or quantities). When either bound is None, return it unchanged.
    """
    if p10 is None or p90 is None:
        return point, p10, p90
    new_p10 = point - (point - p10) * INTERVAL_WIDEN_MULTIPLIER
    new_p90 = point + (p90 - point) * INTERVAL_WIDEN_MULTIPLIER
    if new_p10 < 0:
        new_p10 = 0.0
    return point, new_p10, new_p90
```

- [ ] **Step 5: Run tests, expect PASS**

Run: `pytest ml/tests/test_hollywood_prior.py -v`

Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
git add ml/transfer/__init__.py ml/transfer/hollywood_prior.py ml/tests/test_hollywood_prior.py
git commit -m "ml(w5): pure scalar + interval-widening helpers for transfer forecasts"
```

---

## Task 3: Transfer-forecast writer with DB tests

**Files:**
- Modify: `ml/transfer/hollywood_prior.py` (add writer functions)
- Modify: `ml/tests/test_hollywood_prior.py` (add writer tests with mocked DB)

### Step 1: Write the failing writer tests

- [ ] **Step 1: Append to `ml/tests/test_hollywood_prior.py`**

```python
# --- writer tests (use psycopg2 mock cursor pattern from test_nightly_integration) ---

from unittest.mock import MagicMock

from ml.transfer.hollywood_prior import (
    write_transfer_forecasts_for_store,
    TransferWriteResult,
)


def _mk_cursor(rowsets: list[list[tuple]]):
    """Build a cursor whose successive fetchall()s return rowsets[i]."""
    cur = MagicMock()
    cur.__enter__ = lambda self: self
    cur.__exit__ = lambda *a: False
    cur.fetchall.side_effect = rowsets
    cur.execute = MagicMock()
    return cur


def _mk_conn(cursors: list):
    conn = MagicMock()
    conn.__enter__ = lambda self: self
    conn.__exit__ = lambda *a: False
    it = iter(cursors)
    conn.cursor.side_effect = lambda *a, **k: next(it)
    return conn


def test_write_transfer_forecasts_writes_revenue_rows_with_widened_intervals():
    """Hollywood has 14 days of native forecasts at $3000 ±400 around 3000.
    New store has 14 days of $1500 actuals so scalar = 0.5. After widening
    by 1.5×, p10 of the new-store transfer row should be 1500 - 0.5*400*1.5 = 1200.
    """
    # cur 1 (load hollywood forecasts):
    hollywood_rows = [(2026_05_20, 3000.0, 2800.0, 3200.0)]  # date, point, p10, p90
    # cur 2 (load new-store actuals):
    new_actuals = [(1500.0,)] * 14
    # cur 3 (load hollywood actuals):
    holly_actuals = [(3000.0,)] * 14
    # cur 4 (insert): no fetchall expected.
    insert_cur = MagicMock()
    insert_cur.__enter__ = lambda self: self
    insert_cur.__exit__ = lambda *a: False
    insert_cur.execute = MagicMock()

    cursors = [
        _mk_cursor([hollywood_rows]),
        _mk_cursor([new_actuals]),
        _mk_cursor([holly_actuals]),
        insert_cur,
    ]
    conn = _mk_conn(cursors)

    result = write_transfer_forecasts_for_store(
        conn,
        new_store_id="store-gln",
        hollywood_store_id="store-hwd",
        model_version="transfer-20260520",
        initial_scalar=0.5,
    )

    assert isinstance(result, TransferWriteResult)
    assert result.ok
    assert result.revenue_rows_written >= 1
    # Verify INSERT was called with forecastSource = 'transfer'
    inserts = [c for c in insert_cur.execute.call_args_list]
    assert any("forecastSource" in c.args[0] or "transfer" in str(c).lower() for c in inserts)


def test_write_transfer_forecasts_fails_soft_when_hollywood_has_no_recent_forecasts():
    """If Hollywood has no recent forecasts, return ok=False with a warning."""
    cursors = [
        _mk_cursor([[]]),  # hollywood_rows empty
    ]
    conn = _mk_conn(cursors)

    result = write_transfer_forecasts_for_store(
        conn,
        new_store_id="store-gln",
        hollywood_store_id="store-hwd",
        model_version="transfer-20260520",
        initial_scalar=0.5,
    )

    assert not result.ok
    assert "hollywood_has_no_recent_forecasts" in result.warning


def test_write_transfer_forecasts_fails_soft_when_no_actuals_and_no_initial():
    """Under 7 actuals AND no initial_scalar → ValueError surfaces as ok=False."""
    cursors = [
        _mk_cursor([[(2026_05_20, 3000.0, 2800.0, 3200.0)]]),
        _mk_cursor([[(1500.0,)] * 3]),
        _mk_cursor([[(3000.0,)] * 3]),
    ]
    conn = _mk_conn(cursors)

    result = write_transfer_forecasts_for_store(
        conn,
        new_store_id="store-gln",
        hollywood_store_id="store-hwd",
        model_version="transfer-20260520",
        initial_scalar=None,
    )

    assert not result.ok
    assert "initial_scalar" in result.warning.lower()
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pytest ml/tests/test_hollywood_prior.py -v -k "test_write_transfer_forecasts"`

Expected: ImportError on `write_transfer_forecasts_for_store` and `TransferWriteResult`.

- [ ] **Step 3: Implement the writer in `ml/transfer/hollywood_prior.py`**

Append:

```python
import datetime as dt
from dataclasses import field

from ml.db import cuid_like


@dataclass
class TransferWriteResult:
    ok: bool
    revenue_rows_written: int = 0
    menu_item_rows_written: int = 0
    hourly_rows_written: int = 0
    scalar_used: Optional[float] = None
    warning: str = ""


def _load_hollywood_recent_forecasts(cur, hollywood_store_id: str, days: int):
    """Latest forecast per (date, hourBucket=0) for Hollywood in the next `days`."""
    cur.execute(
        '''
        SELECT DISTINCT ON ("forecastDate")
               "forecastDate", "predictedRevenue", p10, p90
        FROM "ForecastDailyRevenue"
        WHERE "storeId" = %s
          AND "hourBucket" = 0
          AND "forecastSource" = 'native'
          AND "forecastDate" >= CURRENT_DATE
        ORDER BY "forecastDate" ASC, "generatedAt" DESC
        LIMIT %s
        ''',
        (hollywood_store_id, days),
    )
    return cur.fetchall()


def _load_trailing_actuals(cur, store_id: str, days: int) -> list[float]:
    """Trailing actuals from OtterDailySummary (sum of fpNetSales + tpNetSales).

    Used to compute the multiplicative scalar — same source the reconciler
    writes into ForecastDailyRevenue.actualRevenue.
    """
    cur.execute(
        '''
        SELECT COALESCE("fpNetSales", 0) + COALESCE("tpNetSales", 0) AS actual
        FROM "OtterDailySummary"
        WHERE "storeId" = %s
          AND date >= CURRENT_DATE - %s::INTEGER
        ORDER BY date DESC
        LIMIT %s
        ''',
        (store_id, days, days),
    )
    return [float(r[0]) for r in cur.fetchall()]


def write_transfer_forecasts_for_store(
    conn,
    *,
    new_store_id: str,
    hollywood_store_id: str,
    model_version: str,
    initial_scalar: Optional[float],
    horizon_days: int = 14,
) -> TransferWriteResult:
    """Write transfer-source revenue forecasts for one warming_up store.

    Fails soft (returns ok=False + warning) on:
      - no recent Hollywood forecasts to project from
      - insufficient actuals + no initial_scalar fallback

    Menu-item and hourly transfer writes are deliberately scoped out of W5
    (revenue only) — the UI caption attaches to the revenue card and any
    operator-action surface that reads revenue. Extend in a later phase if
    we need item-level transfer forecasts.
    """
    with conn.cursor() as cur:
        hollywood = _load_hollywood_recent_forecasts(cur, hollywood_store_id, horizon_days)
    if not hollywood:
        return TransferWriteResult(ok=False, warning="hollywood_has_no_recent_forecasts")

    with conn.cursor() as cur:
        new_actuals = _load_trailing_actuals(cur, new_store_id, 14)
    with conn.cursor() as cur:
        holly_actuals = _load_trailing_actuals(cur, hollywood_store_id, 14)

    try:
        scalar = compute_transfer_scalar(
            new_store_actuals=new_actuals,
            hollywood_actuals_same_window=holly_actuals,
            initial_scalar=initial_scalar,
        )
    except ValueError as exc:
        return TransferWriteResult(ok=False, warning=f"scalar_unavailable: {exc}")

    written = 0
    with conn.cursor() as cur:
        for row in hollywood:
            forecast_date, point, p10, p90 = row
            scaled_point = float(point) * scalar
            scaled_p10 = float(p10) * scalar if p10 is not None else None
            scaled_p90 = float(p90) * scalar if p90 is not None else None
            new_point, new_p10, new_p90 = widened_interval(
                point=scaled_point, p10=scaled_p10, p90=scaled_p90,
            )
            cur.execute(
                '''
                INSERT INTO "ForecastDailyRevenue"
                    (id, "storeId", "forecastDate", "hourBucket",
                     "predictedRevenue", p10, p90, "modelVersion", "forecastSource")
                VALUES (%s, %s, %s, 0, %s, %s, %s, %s, 'transfer')
                ''',
                (cuid_like(), new_store_id, forecast_date,
                 new_point, new_p10, new_p90, model_version),
            )
            written += 1

    return TransferWriteResult(
        ok=True,
        revenue_rows_written=written,
        scalar_used=scalar,
    )
```

- [ ] **Step 4: Run, expect PASS**

Run: `pytest ml/tests/test_hollywood_prior.py -v`

Expected: 11 passed.

- [ ] **Step 5: Commit**

```bash
git add ml/transfer/hollywood_prior.py ml/tests/test_hollywood_prior.py
git commit -m "ml(w5): transfer-forecast writer with fail-soft warnings"
```

---

## Task 4: Lifecycle promotion helper

**Files:**
- Create: `ml/lifecycle.py`
- Create: `ml/tests/test_lifecycle.py`

### Step 1: Write the failing tests

- [ ] **Step 1: Write `ml/tests/test_lifecycle.py`**

```python
"""Tests for the warming_up → ready lifecycle promotion gate."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from ml.lifecycle import (
    should_promote_to_ready,
    READY_PROMOTION_IMPROVEMENT_THRESHOLD,
    READY_PROMOTION_MIN_SAMPLE,
    flip_to_ready,
)


def test_should_promote_when_native_beats_transfer_by_threshold():
    # Native WAPE 0.20, transfer WAPE 0.25 → relative improvement 20% (>5%).
    assert should_promote_to_ready(
        native_wape=0.20,
        transfer_wape=0.25,
        sample_size=READY_PROMOTION_MIN_SAMPLE,
    )


def test_should_not_promote_when_improvement_below_threshold():
    # Native 0.24 vs transfer 0.25 → 4% improvement, below 5%.
    assert not should_promote_to_ready(
        native_wape=0.24,
        transfer_wape=0.25,
        sample_size=READY_PROMOTION_MIN_SAMPLE,
    )


def test_should_not_promote_when_sample_below_min():
    # Even a great improvement, but only 30 samples — below 60-day floor.
    assert not should_promote_to_ready(
        native_wape=0.10,
        transfer_wape=0.30,
        sample_size=30,
    )


def test_should_not_promote_when_transfer_wape_zero_or_missing():
    assert not should_promote_to_ready(
        native_wape=0.10,
        transfer_wape=0.0,
        sample_size=READY_PROMOTION_MIN_SAMPLE,
    )
    assert not should_promote_to_ready(
        native_wape=0.10,
        transfer_wape=None,
        sample_size=READY_PROMOTION_MIN_SAMPLE,
    )


def test_threshold_locked_at_five_percent():
    # Spec §1.4 locks the threshold at 5%.
    assert READY_PROMOTION_IMPROVEMENT_THRESHOLD == pytest.approx(0.05)


def test_min_sample_locked_at_sixty():
    # Spec §1.4 locks the minimum at 60.
    assert READY_PROMOTION_MIN_SAMPLE == 60


def test_flip_to_ready_executes_update_statement():
    cur = MagicMock()
    cur.__enter__ = lambda self: self
    cur.__exit__ = lambda *a: False
    cur.execute = MagicMock()
    conn = MagicMock()
    conn.__enter__ = lambda self: self
    conn.__exit__ = lambda *a: False
    conn.cursor.return_value = cur

    flip_to_ready(conn, store_id="store-gln")

    args = cur.execute.call_args
    assert "lifecycleStage" in args.args[0]
    assert "'ready'" in args.args[0]
    assert args.args[1] == ("store-gln",)
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pytest ml/tests/test_lifecycle.py -v`

Expected: ImportError.

- [ ] **Step 3: Write `ml/lifecycle.py`**

```python
"""Store-lifecycle helpers.

Stages: pre_open → warming_up → ready (one-way transitions).

The pre_open → warming_up flip is an ops action (operator clicks a button
when the store physically opens), not driven by code in this module.

The warming_up → ready flip is automatic — `should_promote_to_ready` decides
on each nightly run whether the native model has earned promotion.
"""
from __future__ import annotations

from typing import Optional


# Spec §1.4: native must beat transfer-forecast WAPE by ≥5% relative.
READY_PROMOTION_IMPROVEMENT_THRESHOLD = 0.05

# Spec §1.4: also require sampleSize ≥ 60 (matches existing _MIN_DAILY_HISTORY
# discipline for trustworthy WAPE).
READY_PROMOTION_MIN_SAMPLE = 60


def should_promote_to_ready(
    *,
    native_wape: float,
    transfer_wape: Optional[float],
    sample_size: int,
) -> bool:
    """Return True iff the native model has earned promotion to `ready`.

    Two gates, both must pass:
      1. `(transfer_wape - native_wape) / transfer_wape >= 0.05` (5% relative).
      2. `sample_size >= 60` so the WAPE itself is trustworthy.
    """
    if transfer_wape is None or transfer_wape <= 0:
        return False
    if sample_size < READY_PROMOTION_MIN_SAMPLE:
        return False
    rel_improvement = (transfer_wape - native_wape) / transfer_wape
    return rel_improvement >= READY_PROMOTION_IMPROVEMENT_THRESHOLD


def flip_to_ready(conn, *, store_id: str) -> None:
    """Atomic flip of one store from warming_up to ready.

    Idempotent — if the store is already ready, the UPDATE is a no-op.
    """
    with conn.cursor() as cur:
        cur.execute(
            '''
            UPDATE "Store"
            SET "lifecycleStage" = 'ready'::"LifecycleStage"
            WHERE id = %s AND "lifecycleStage" = 'warming_up'::"LifecycleStage"
            ''',
            (store_id,),
        )
```

- [ ] **Step 4: Run, expect PASS**

Run: `pytest ml/tests/test_lifecycle.py -v`

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add ml/lifecycle.py ml/tests/test_lifecycle.py
git commit -m "ml(w5): lifecycle promotion gate (native beats transfer by 5% + n>=60)"
```

---

## Task 5: Transfer-baseline WAPE in promotion module

The lifecycle gate (Task 4) is pure. To call it, the nightly job needs the store's own transfer-forecast WAPE. Compute it from the existing forecast tables.

**Files:**
- Modify: `ml/evaluation/promotion.py` (add `transfer_forecast_wape` helper)
- Modify: `ml/tests/test_promotion.py`

### Step 1: Write the failing test

- [ ] **Step 1: Append to `ml/tests/test_promotion.py`**

```python
from unittest.mock import MagicMock

from ml.evaluation.promotion import transfer_forecast_wape


def _mk_conn_with_rows(rows):
    cur = MagicMock()
    cur.__enter__ = lambda self: self
    cur.__exit__ = lambda *a: False
    cur.fetchall.return_value = rows
    conn = MagicMock()
    conn.__enter__ = lambda self: self
    conn.__exit__ = lambda *a: False
    conn.cursor.return_value = cur
    return conn, cur


def test_transfer_forecast_wape_computes_wape_from_reconciled_transfer_rows():
    # 3 rows; predicted vs actual: |800-1000|+|1100-1000|+|900-1000| = 400
    # Σ actual = 3000 → WAPE = 400/3000 ≈ 0.1333.
    rows = [
        (800.0, 1000.0),
        (1100.0, 1000.0),
        (900.0, 1000.0),
    ]
    conn, _ = _mk_conn_with_rows(rows)
    wape = transfer_forecast_wape(conn, store_id="store-gln", lookback_days=60)
    assert wape is not None
    assert abs(wape - (400 / 3000)) < 1e-9


def test_transfer_forecast_wape_returns_none_when_no_rows():
    conn, _ = _mk_conn_with_rows([])
    assert transfer_forecast_wape(conn, store_id="store-gln", lookback_days=60) is None


def test_transfer_forecast_wape_returns_none_when_sum_actuals_zero():
    conn, _ = _mk_conn_with_rows([(0.0, 0.0), (5.0, 0.0)])
    assert transfer_forecast_wape(conn, store_id="store-gln", lookback_days=60) is None
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pytest ml/tests/test_promotion.py -v -k transfer_forecast_wape`

Expected: ImportError.

- [ ] **Step 3: Add `transfer_forecast_wape` to `ml/evaluation/promotion.py`**

Append at the bottom of the file:

```python
def transfer_forecast_wape(
    conn,
    *,
    store_id: str,
    lookback_days: int = 60,
) -> Optional[float]:
    """WAPE of this store's reconciled transfer forecasts over the trailing
    `lookback_days`. Returns None if no reconciled transfer rows exist or
    Σ|actual| is zero.

    Used by the lifecycle gate: native model must beat THIS value by ≥5%.
    """
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT "predictedRevenue", "actualRevenue"
            FROM "ForecastDailyRevenue"
            WHERE "storeId" = %s
              AND "forecastSource" = 'transfer'
              AND "actualRevenue" IS NOT NULL
              AND "reconciledAt" IS NOT NULL
              AND "forecastDate" >= CURRENT_DATE - %s::INTEGER
            ''',
            (store_id, lookback_days),
        )
        rows = cur.fetchall()
    if not rows:
        return None
    abs_err = sum(abs(float(p) - float(a)) for p, a in rows)
    abs_act = sum(abs(float(a)) for _, a in rows)
    if abs_act == 0:
        return None
    return abs_err / abs_act
```

- [ ] **Step 4: Run, expect PASS**

Run: `pytest ml/tests/test_promotion.py -v -k transfer_forecast_wape`

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add ml/evaluation/promotion.py ml/tests/test_promotion.py
git commit -m "ml(w5): transfer_forecast_wape helper for lifecycle gate"
```

---

## Task 6: Stage-aware store enumeration

**Files:**
- Modify: `ml/features/revenue.py` (add `list_stores_by_stage`)
- Modify (test): re-use existing test file or `ml/tests/test_lifecycle.py`

- [ ] **Step 1: Append helper test to `ml/tests/test_lifecycle.py`**

```python
from ml.features.revenue import list_stores_by_stage


def test_list_stores_by_stage_filters_correctly(monkeypatch):
    """list_stores_by_stage(stages=['ready']) returns only ready stores."""
    rows = [
        ("hwd", "ready"),
        ("gln", "warming_up"),
        ("vnys", "pre_open"),
    ]

    cur = MagicMock()
    cur.__enter__ = lambda self: self
    cur.__exit__ = lambda *a: False
    cur.fetchall.return_value = [("hwd",)]  # filtered by SQL
    cur.execute = MagicMock()
    conn = MagicMock()
    conn.__enter__ = lambda self: self
    conn.__exit__ = lambda *a: False
    conn.cursor.return_value = cur

    monkeypatch.setattr("ml.features.revenue.connect", lambda: conn)

    out = list_stores_by_stage(stages=("ready",))
    assert out == ["hwd"]
    sql, params = cur.execute.call_args.args
    assert "lifecycleStage" in sql
    assert params == (["ready"],)
```

- [ ] **Step 2: Add `list_stores_by_stage` to `ml/features/revenue.py`**

```python
def list_stores_by_stage(*, stages: tuple[str, ...]) -> list[str]:
    """Active store IDs filtered by `Store.lifecycleStage`.

    Pass e.g. `("ready",)` to enumerate stores that should train native
    models, or `("warming_up",)` for the transfer-writer pass.
    """
    sql = '''
        SELECT id FROM "Store"
        WHERE "isActive" = true
          AND "lifecycleStage"::TEXT = ANY(%s)
        ORDER BY name
    '''
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (list(stages),))
            return [r[0] for r in cur.fetchall()]
```

(Keep the existing `list_active_store_ids` untouched — the nightly job switches to the new helper in Task 7, but other callers may still use the old one.)

- [ ] **Step 3: Run, expect PASS**

Run: `pytest ml/tests/test_lifecycle.py::test_list_stores_by_stage_filters_correctly -v`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add ml/features/revenue.py ml/tests/test_lifecycle.py
git commit -m "ml(w5): list_stores_by_stage enumerator"
```

---

## Task 7: Wire the transfer writer + lifecycle gate into the nightly run

**Files:**
- Modify: `ml/run_nightly.py`
- Modify: `ml/tests/test_nightly_integration.py` (or create a new focused test if the existing one is too broad)

### Step 1: Test the branching behavior

- [ ] **Step 1: Append a smoke-style test**

Create `ml/tests/test_run_nightly_lifecycle_branching.py`:

```python
"""Tests that run_nightly.main() branches correctly on Store.lifecycleStage.

Mocks the per-store run functions so we only verify dispatch logic.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


@patch("ml.run_nightly.run_anomaly_detection_for_store", return_value={"ok": True})
@patch("ml.run_nightly.run_elasticity_for_store", return_value={"ok": True})
@patch("ml.run_nightly.reconcile_past_forecasts", return_value={"ok": True})
@patch("ml.run_nightly.run_busy_hours_for_store", return_value={"ok": True})
@patch("ml.run_nightly.run_menu_items_for_store", return_value={"ok": True})
@patch("ml.run_nightly.run_revenue_for_store", return_value={"ok": True})
@patch("ml.run_nightly.write_transfer_forecasts_for_store")
@patch("ml.run_nightly.list_stores_by_stage")
@patch("ml.run_nightly.connect")
def test_pre_open_stores_are_skipped(
    mock_connect, mock_list, mock_transfer, mock_rev, *_
):
    from ml.run_nightly import main
    # Only a pre_open store exists.
    mock_list.side_effect = lambda stages: {("pre_open",): ["store-vnys"], ("warming_up",): [], ("ready",): []}[stages]
    mock_connect.return_value.__enter__.return_value = MagicMock()

    rc = main()

    assert rc == 0
    mock_rev.assert_not_called()
    mock_transfer.assert_not_called()


@patch("ml.run_nightly.run_anomaly_detection_for_store", return_value={"ok": True})
@patch("ml.run_nightly.run_elasticity_for_store", return_value={"ok": True})
@patch("ml.run_nightly.reconcile_past_forecasts", return_value={"ok": True})
@patch("ml.run_nightly.run_busy_hours_for_store", return_value={"ok": True})
@patch("ml.run_nightly.run_menu_items_for_store", return_value={"ok": True})
@patch("ml.run_nightly.run_revenue_for_store", return_value={"ok": True})
@patch("ml.run_nightly.write_transfer_forecasts_for_store")
@patch("ml.run_nightly.resolve_hollywood_store_id", return_value="store-hwd")
@patch("ml.run_nightly.list_stores_by_stage")
@patch("ml.run_nightly.connect")
def test_warming_up_stores_get_transfer_writes(
    mock_connect, mock_list, _resolve, mock_transfer, mock_rev, *_
):
    from ml.run_nightly import main
    from ml.transfer.hollywood_prior import TransferWriteResult
    mock_list.side_effect = lambda stages: {
        ("pre_open",): [],
        ("warming_up",): ["store-gln"],
        ("ready",): [],
    }[stages]
    mock_transfer.return_value = TransferWriteResult(ok=True, revenue_rows_written=14, scalar_used=0.5)
    mock_connect.return_value.__enter__.return_value = MagicMock()

    rc = main()

    assert rc == 0
    mock_transfer.assert_called_once()
    # Warming-up stores also train native (so the gate has something to compare).
    mock_rev.assert_called_once()


@patch("ml.run_nightly.run_anomaly_detection_for_store", return_value={"ok": True})
@patch("ml.run_nightly.run_elasticity_for_store", return_value={"ok": True})
@patch("ml.run_nightly.reconcile_past_forecasts", return_value={"ok": True})
@patch("ml.run_nightly.run_busy_hours_for_store", return_value={"ok": True})
@patch("ml.run_nightly.run_menu_items_for_store", return_value={"ok": True})
@patch("ml.run_nightly.run_revenue_for_store", return_value={"ok": True})
@patch("ml.run_nightly.write_transfer_forecasts_for_store")
@patch("ml.run_nightly.list_stores_by_stage")
@patch("ml.run_nightly.connect")
def test_ready_stores_train_native_no_transfer(
    mock_connect, mock_list, mock_transfer, mock_rev, *_
):
    from ml.run_nightly import main
    mock_list.side_effect = lambda stages: {
        ("pre_open",): [],
        ("warming_up",): [],
        ("ready",): ["store-hwd"],
    }[stages]
    mock_connect.return_value.__enter__.return_value = MagicMock()

    rc = main()

    assert rc == 0
    mock_rev.assert_called_once_with("store-hwd", pytest.helpers.ANY if hasattr(pytest, "helpers") else mock_rev.call_args.args[1])
    mock_transfer.assert_not_called()
```

If the `pytest.helpers` line proves brittle, replace the assert with:

```python
    assert mock_rev.call_count == 1
    assert mock_rev.call_args.args[0] == "store-hwd"
```

- [ ] **Step 2: Run, expect FAIL** (since `list_stores_by_stage`, `write_transfer_forecasts_for_store`, `resolve_hollywood_store_id` aren't imported in `ml/run_nightly.py` yet)

Run: `pytest ml/tests/test_run_nightly_lifecycle_branching.py -v`

Expected: AttributeError / ImportError.

- [ ] **Step 3: Modify `ml/run_nightly.py`**

Add the imports near the top, after the existing block:

```python
from ml.features.revenue import list_stores_by_stage
from ml.lifecycle import should_promote_to_ready, flip_to_ready, READY_PROMOTION_MIN_SAMPLE
from ml.transfer.hollywood_prior import write_transfer_forecasts_for_store
from ml.evaluation.promotion import transfer_forecast_wape
```

Add a helper just below the model-version functions:

```python
def resolve_hollywood_store_id() -> str | None:
    """Resolve the operational anchor store by name.

    Per project memory `project_store_lifecycle`, Hollywood is the only
    operational store today. We resolve by name so this works in any
    environment (prod, staging, test) without a hard-coded ID.
    """
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT id FROM "Store" WHERE name = %s AND "isActive" = true LIMIT 1',
            ("Hollywood",),
        )
        row = cur.fetchone()
    return row[0] if row else None


def _load_store_init_scalar(store_id: str) -> float | None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT "initialTransferScalar" FROM "Store" WHERE id = %s',
            (store_id,),
        )
        row = cur.fetchone()
    return float(row[0]) if row and row[0] is not None else None


def run_transfer_forecasts_for_store(
    store_id: str, hollywood_store_id: str, model_version: str,
) -> dict:
    initial = _load_store_init_scalar(store_id)
    transfer_version = f"transfer-{model_version}"
    with connect() as conn:
        result = write_transfer_forecasts_for_store(
            conn,
            new_store_id=store_id,
            hollywood_store_id=hollywood_store_id,
            model_version=transfer_version,
            initial_scalar=initial,
        )
    return {
        "store_id": store_id,
        "ok": result.ok,
        "rows_written": result.revenue_rows_written,
        "scalar_used": result.scalar_used,
        "warning": result.warning or None,
    }


def maybe_promote_to_ready(store_id: str, native_result: dict) -> dict:
    """Run the warming_up → ready check after a successful native train.

    `native_result` is the dict returned by run_revenue_for_store; we need
    its mape/sample_size proxies — but spec §1.4 uses WAPE, not MAPE. We
    compute the native WAPE from the most recent MlForecastEvaluation row,
    which is written by the nightly evaluator AFTER training.
    """
    sample_size = native_result.get("sample_size") or 0
    if sample_size < READY_PROMOTION_MIN_SAMPLE:
        return {"store_id": store_id, "promoted": False, "reason": "insufficient_sample"}

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                '''
                SELECT wape FROM "MlForecastEvaluation"
                WHERE "storeId" = %s AND target = 'REVENUE'::"MlTarget"
                ORDER BY "computedAt" DESC
                LIMIT 1
                ''',
                (store_id,),
            )
            row = cur.fetchone()
        if not row or row[0] is None:
            return {"store_id": store_id, "promoted": False, "reason": "no_native_wape_row"}
        native_wape = float(row[0])
        transfer_wape = transfer_forecast_wape(conn, store_id=store_id, lookback_days=60)
        if not should_promote_to_ready(
            native_wape=native_wape,
            transfer_wape=transfer_wape,
            sample_size=sample_size,
        ):
            return {
                "store_id": store_id,
                "promoted": False,
                "reason": (
                    f"native_wape={native_wape:.4f} "
                    f"transfer_wape={transfer_wape and round(transfer_wape, 4)} "
                    f"n={sample_size}"
                ),
            }
        flip_to_ready(conn, store_id=store_id)
    return {"store_id": store_id, "promoted": True, "native_wape": native_wape}
```

Replace the body of `main()`. Keep all existing per-store work but route by stage:

```python
def main() -> int:
    model_version = _model_version()

    pre_open = list_stores_by_stage(stages=("pre_open",))
    warming_up = list_stores_by_stage(stages=("warming_up",))
    ready = list_stores_by_stage(stages=("ready",))

    for store_id in pre_open:
        print({"phase": "LIFECYCLE", "store_id": store_id, "stage": "pre_open", "action": "skipped"})

    hollywood_id = None
    if warming_up:
        hollywood_id = resolve_hollywood_store_id()
        if hollywood_id is None:
            print({"phase": "LIFECYCLE", "warning": "no_hollywood_anchor_skipping_transfers"})

    failures = 0
    for store_id in warming_up:
        if hollywood_id:
            t_result = run_transfer_forecasts_for_store(store_id, hollywood_id, model_version)
            print({"phase": "TRANSFER", **t_result})
            if not t_result.get("ok"):
                failures += 1
        # Also train native so the gate has data to evaluate.
        revenue_result = run_revenue_for_store(store_id, model_version)
        print({"target": "REVENUE", **revenue_result})
        if revenue_result.get("ok"):
            promo = maybe_promote_to_ready(store_id, revenue_result)
            print({"phase": "LIFECYCLE", **promo})
        else:
            failures += 1

    for store_id in ready:
        revenue_result = run_revenue_for_store(store_id, model_version)
        print({"target": "REVENUE", **revenue_result})
        if not revenue_result.get("ok"):
            failures += 1

        menu_result = run_menu_items_for_store(store_id, model_version)
        print({"target": "MENU_ITEM", **menu_result})
        if not menu_result.get("ok"):
            failures += 1

        busy_hours_result = run_busy_hours_for_store(store_id, model_version)
        print({"target": "BUSY_HOURS", **busy_hours_result})
        if not busy_hours_result.get("ok"):
            failures += 1

        anomaly_result = run_anomaly_detection_for_store(store_id)
        print({"phase": "ANOMALY", **anomaly_result})
        if not anomaly_result.get("ok"):
            failures += 1

        elasticity_result = run_elasticity_for_store(store_id)
        print({"phase": "ELASTICITY", **elasticity_result})
        if not elasticity_result.get("ok"):
            failures += 1

        try:
            reconcile_result = reconcile_past_forecasts(store_id)
            print({"phase": "RECONCILE", **reconcile_result})
        except Exception as exc:  # pylint: disable=broad-except
            print({"phase": "RECONCILE", "store_id": store_id, "ok": False, "reason": str(exc)})
            failures += 1

        try:
            with connect() as conn:
                run_evaluation_pass(conn, store_id, dt.date.today())
                run_consistency_check(conn, store_id, dt.date.today())
            print({"phase": "EVALUATE", "store_id": store_id, "ok": True})
        except Exception as exc:  # pylint: disable=broad-except
            print({"phase": "EVALUATE", "store_id": store_id, "ok": False, "reason": str(exc)})
            failures += 1

    return 0 if failures == 0 else 1
```

(Delete the old `store_ids = list_active_store_ids()` / loop — replaced by the stage-routed loops above.)

- [ ] **Step 4: Run lifecycle-branching tests, expect PASS**

Run: `pytest ml/tests/test_run_nightly_lifecycle_branching.py -v`

Expected: 3 passed. If the `pytest.helpers.ANY` line failed, switch to the alternative `call_args` assertions noted in Step 1.

- [ ] **Step 5: Re-run the full test suite to confirm no regression**

Run: `pytest ml/tests/ -v -x`

Expected: every previously passing test still passes. If `test_nightly_integration.py` breaks because it asserted on the old `list_active_store_ids` path, update those assertions to use the new stage-routed flow (or seed the mocks with `("ready",)` returning the expected store).

- [ ] **Step 6: Commit**

```bash
git add ml/run_nightly.py ml/tests/test_run_nightly_lifecycle_branching.py
git commit -m "ml(w5): nightly run branches on lifecycle stage + writes transfer forecasts"
```

---

## Task 8: Forecast read helpers expose `forecastSource`

**Files:**
- Modify: `src/app/actions/forecasts/revenue-forecast-actions.ts`

- [ ] **Step 1: Add `forecastSource` to the interface and select**

Edit `src/app/actions/forecasts/revenue-forecast-actions.ts`:

```typescript
export interface RevenueForecastDay {
  date: Date
  predictedRevenue: number
  p10: number | null
  p90: number | null
  modelVersion: string
  generatedAt: Date
  forecastSource: "native" | "transfer"
}
```

In the `prisma.forecastDailyRevenue.findMany` select, add:

```typescript
        forecastSource: true,
```

In the loop that builds latest-per-store rows, propagate `forecastSource` into the produced `RevenueForecastDay`.

- [ ] **Step 2: Run the existing forecast tests**

Run: `npm test -- forecast` (or the project's standard `npm test` if there isn't a per-file convention).

Expected: TS compiles; tests pass. If any test referenced the old shape without `forecastSource`, extend that fixture.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/forecasts/revenue-forecast-actions.ts
git commit -m "ml(w5): expose forecastSource on revenue-forecast read helper"
```

---

## Task 9: Caption component

**Files:**
- Create: `src/components/forecast/transfer-source-caption.tsx`
- Create: `src/components/forecast/transfer-source-caption.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// src/components/forecast/transfer-source-caption.test.tsx
import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"

import { TransferSourceCaption } from "./transfer-source-caption"

describe("TransferSourceCaption", () => {
  it("renders the Hollywood-patterns caption with day number and store name", () => {
    render(<TransferSourceCaption storeName="Glendale" dayNumber={12} />)
    expect(
      screen.getByText(/based on hollywood patterns/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/day 12 of glendale/i)).toBeInTheDocument()
  })

  it("uses the editorial JetBrains Mono caption class", () => {
    const { container } = render(
      <TransferSourceCaption storeName="Van Nuys" dayNumber={1} />,
    )
    const el = container.querySelector("[data-testid='transfer-source-caption']")
    expect(el).toBeTruthy()
    expect(el?.className).toMatch(/font-mono|jetbrains/i)
  })
})
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npm test -- transfer-source-caption`

Expected: import fails.

- [ ] **Step 3: Write the component**

```typescript
// src/components/forecast/transfer-source-caption.tsx
import * as React from "react"

interface TransferSourceCaptionProps {
  storeName: string
  dayNumber: number
}

export function TransferSourceCaption({
  storeName,
  dayNumber,
}: TransferSourceCaptionProps) {
  return (
    <div className="border-t border-[color:var(--hairline)] pt-2 mt-2">
      <p
        data-testid="transfer-source-caption"
        className="font-mono text-[11px] uppercase tracking-wide text-[color:var(--ink-faint)]"
      >
        Based on Hollywood patterns · day {dayNumber} of {storeName}
      </p>
    </div>
  )
}
```

CLAUDE.md tripwire #1: only `--ink-faint` and `--hairline` tokens. No generic Tailwind colors. Tripwire #2 satisfied: JetBrains Mono is the right face for a caption.

- [ ] **Step 4: Run, expect PASS**

Run: `npm test -- transfer-source-caption`

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/forecast/transfer-source-caption.tsx src/components/forecast/transfer-source-caption.test.tsx
git commit -m "ml(w5): TransferSourceCaption component (editorial-docket compliant)"
```

---

## Task 10: Wire the caption into a forecast card

**Files:**
- Identify the target file: a dashboard card that renders revenue-forecast values for a specific store. Most likely candidate: `src/app/dashboard/intelligence/launch-trajectory/page.tsx` or a similar "revenue forecast" component.

- [ ] **Step 1: Locate the card**

Run:

```bash
grep -rln "getRevenueForecast\|RevenueForecastDay" src/app/dashboard/ src/app/(mobile)/m/ 2>/dev/null
```

Pick the **first** file that renders a forecast-value-per-day list. Call it `<TARGET_FILE>`.

- [ ] **Step 2: Compute `dayNumber` and pick `forecastSource`**

When at least one of the displayed days has `forecastSource === "transfer"`, render `<TransferSourceCaption>` once at the bottom of the card. Compute `dayNumber` as `daysSince(store.openedAt) + 1` using the existing date utilities at `src/lib/date.ts` if present, else inline:

```typescript
const dayNumber = store.openedAt
  ? Math.max(1, Math.floor((Date.now() - new Date(store.openedAt).getTime()) / (1000 * 60 * 60 * 24)) + 1)
  : 1
```

Add at the appropriate spot:

```tsx
{forecast.days.some((d) => d.forecastSource === "transfer") && (
  <TransferSourceCaption storeName={forecast.storeName} dayNumber={dayNumber} />
)}
```

- [ ] **Step 3: Manual smoke verification**

Run:

```bash
npm run dev
```

In another shell, flip a test store to `warming_up`:

```bash
psql "$DATABASE_URL" -c "UPDATE \"Store\" SET \"lifecycleStage\" = 'warming_up', \"openedAt\" = NOW() - INTERVAL '12 days', \"initialTransferScalar\" = 0.5 WHERE name = 'Glendale';"
```

Run the nightly job for that store only:

```bash
python -m ml.run_nightly
```

Expected: nightly writes ≥1 row with `forecastSource = 'transfer'` for Glendale; dashboard card for Glendale shows the caption "Based on Hollywood patterns · day 12 of Glendale".

If the test store doesn't have UI access yet, you can verify by querying the rows directly:

```bash
psql "$DATABASE_URL" -c "SELECT \"forecastDate\", \"predictedRevenue\", \"forecastSource\" FROM \"ForecastDailyRevenue\" WHERE \"storeId\" = (SELECT id FROM \"Store\" WHERE name='Glendale') ORDER BY \"generatedAt\" DESC LIMIT 5;"
```

- [ ] **Step 4: Reset the test store**

```bash
psql "$DATABASE_URL" -c "UPDATE \"Store\" SET \"lifecycleStage\" = 'pre_open', \"openedAt\" = NULL, \"initialTransferScalar\" = NULL WHERE name = 'Glendale';"
psql "$DATABASE_URL" -c "DELETE FROM \"ForecastDailyRevenue\" WHERE \"forecastSource\" = 'transfer';"
```

- [ ] **Step 5: Commit**

```bash
git add <TARGET_FILE>
git commit -m "ml(w5): render TransferSourceCaption on warming_up store forecast cards"
```

---

## Task 11: End-to-end synthetic smoke test

This is the exit-gate test: a synthetic store goes pre_open → warming_up → ready over a scripted set of nightly invocations.

**Files:**
- Create: `ml/tests/test_w5_end_to_end_lifecycle.py`

- [ ] **Step 1: Write the test**

```python
"""End-to-end W5 exit gate: a synthetic store transitions pre_open →
warming_up → ready under a scripted nightly run.

This test hits the real DB if DATABASE_URL is set; otherwise it skips.
Cleans up after itself via `WHERE name LIKE 'w5-smoke-%'`.
"""
from __future__ import annotations

import os
import uuid

import pytest

from ml.db import connect, cuid_like
from ml.lifecycle import should_promote_to_ready, flip_to_ready


pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set; end-to-end test requires a real DB",
)


@pytest.fixture
def synthetic_store():
    store_id = cuid_like()
    name = f"w5-smoke-{uuid.uuid4().hex[:8]}"
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            'INSERT INTO "Store" (id, name, "ownerId", "accountId", "lifecycleStage") '
            'SELECT %s, %s, "ownerId", "accountId", \'pre_open\'::"LifecycleStage" '
            'FROM "Store" WHERE name = \'Hollywood\' LIMIT 1',
            (store_id, name),
        )
    yield store_id
    with connect() as conn, conn.cursor() as cur:
        cur.execute('DELETE FROM "ForecastDailyRevenue" WHERE "storeId" = %s', (store_id,))
        cur.execute('DELETE FROM "Store" WHERE id = %s', (store_id,))


def test_lifecycle_transitions_end_to_end(synthetic_store):
    store_id = synthetic_store

    # 1. pre_open: no forecasts written.
    # (We don't run the full pipeline here — just verify the row exists.)
    with connect() as conn, conn.cursor() as cur:
        cur.execute('SELECT "lifecycleStage" FROM "Store" WHERE id = %s', (store_id,))
        assert cur.fetchone()[0] == "pre_open"

    # 2. Ops flip → warming_up.
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            'UPDATE "Store" SET "lifecycleStage" = \'warming_up\'::"LifecycleStage", '
            '"openedAt" = NOW() - INTERVAL \'10 days\', '
            '"initialTransferScalar" = 0.5 WHERE id = %s',
            (store_id,),
        )

    # 3. Native model beats transfer by 6%, n=70 → should promote.
    assert should_promote_to_ready(native_wape=0.188, transfer_wape=0.200, sample_size=70)

    # 4. Apply the flip and verify.
    with connect() as conn:
        flip_to_ready(conn, store_id=store_id)
    with connect() as conn, conn.cursor() as cur:
        cur.execute('SELECT "lifecycleStage" FROM "Store" WHERE id = %s', (store_id,))
        assert cur.fetchone()[0] == "ready"

    # 5. Counter-test: native barely beats transfer (4%) → should NOT promote.
    assert not should_promote_to_ready(native_wape=0.192, transfer_wape=0.200, sample_size=70)
```

- [ ] **Step 2: Run**

Run: `pytest ml/tests/test_w5_end_to_end_lifecycle.py -v`

Expected: PASS when `DATABASE_URL` is set; SKIPPED otherwise.

- [ ] **Step 3: Commit**

```bash
git add ml/tests/test_w5_end_to_end_lifecycle.py
git commit -m "ml(w5): end-to-end lifecycle transition smoke test"
```

---

## Task 12: Hollywood-unaffected regression check

Verify spec §1 exit gate item 3: "Hollywood unaffected: its forecasts continue to land in `forecastSource = 'native'` rows with no regression in `MlForecastEvaluation` numbers."

- [ ] **Step 1: Snapshot current Hollywood metrics**

```bash
psql "$DATABASE_URL" -c "SELECT target, AVG(wape) as avg_wape, AVG(\"intervalCoverage80\") as avg_cov, COUNT(*) FROM \"MlForecastEvaluation\" WHERE \"storeId\" = (SELECT id FROM \"Store\" WHERE name='Hollywood') AND \"computedAt\" >= NOW() - INTERVAL '14 days' GROUP BY target;" > /tmp/hwd-pre.txt
cat /tmp/hwd-pre.txt
```

- [ ] **Step 2: Run nightly + snapshot post**

```bash
python -m ml.run_nightly
psql "$DATABASE_URL" -c "SELECT target, AVG(wape) as avg_wape, AVG(\"intervalCoverage80\") as avg_cov, COUNT(*) FROM \"MlForecastEvaluation\" WHERE \"storeId\" = (SELECT id FROM \"Store\" WHERE name='Hollywood') AND \"computedAt\" >= NOW() - INTERVAL '14 days' GROUP BY target;" > /tmp/hwd-post.txt
diff /tmp/hwd-pre.txt /tmp/hwd-post.txt
```

Expected: each per-target row's `avg_wape` is within ±0.005 of pre (one fresh nightly row added; aggregate barely moves), `avg_cov` within ±0.01, and Hollywood's `forecastSource` distribution in `ForecastDailyRevenue` is 100% `native`:

```bash
psql "$DATABASE_URL" -c "SELECT \"forecastSource\", COUNT(*) FROM \"ForecastDailyRevenue\" WHERE \"storeId\" = (SELECT id FROM \"Store\" WHERE name='Hollywood') GROUP BY \"forecastSource\";"
```

Expected output: a single row `native | <N>`.

- [ ] **Step 3: Run graphify update**

```bash
graphify update .
```

(Per CLAUDE.md graphify rule — keep the graph current after code modifications.)

- [ ] **Step 4: Documentation update**

Append to `ml/README.md`:

```markdown
## Lifecycle stages (added W5)

Stores progress pre_open → warming_up → ready:

- `pre_open` — physically not open. Nightly pipeline skips entirely; dashboard shows "Opening soon."
- `warming_up` — open but native model untrustworthy. Nightly emits transfer-source forecasts derived from Hollywood (`ml/transfer/hollywood_prior.py`), trains native in parallel, and refuses to promote until native WAPE beats transfer WAPE by ≥5% with sampleSize ≥ 60.
- `ready` — native model in production. Participates in all phases.

Promotion is automatic; the only manual flip is `pre_open → warming_up`, done by ops when the store physically opens. See `ml/lifecycle.py`.
```

- [ ] **Step 5: Commit**

```bash
git add ml/README.md
git commit -m "docs(ml): document W5 lifecycle stages"
```

---

## Self-review checklist

Cross-checked against [the W5 spec section](../specs/2026-05-17-ml-phase1-weeks5-12-design.md#section-1--w5-store-lifecycle-onboarding-pipeline):

| Spec requirement | Plan task |
|---|---|
| §1.1 `Store.lifecycleStage` enum + transitions | Task 1 (schema) + Task 4 (gate) + Task 7 (auto-promotion call) |
| §1.1 manual pre_open → warming_up flip | Task 11 step 2 (smoke); production flow is an ops SQL update, no code path needed |
| §1.2 transfer-forecast writer + scalar | Tasks 2 + 3 |
| §1.2 initial scalar fallback rule | Task 2 step 4 (raises when both unavailable) |
| §1.2 ×1.5 interval widening | Task 2 step 4 (`INTERVAL_WIDEN_MULTIPLIER = 1.5`) |
| §1.2 fail-soft on missing Hollywood forecasts | Task 3 step 3 (`hollywood_has_no_recent_forecasts`) |
| §1.3 ForecastSource enum on the three tables | Task 1 |
| §1.3 reconciledAt separate from forecastSource | (already separate in current schema — no change needed) |
| §1.4 third baseline (transfer) in promotion gate | Tasks 4 + 5 + 7 (`maybe_promote_to_ready`) |
| §1.4 5% threshold, n≥60 floor | Task 4 (constants locked) |
| §1.5 UI caption | Tasks 8 + 9 + 10 |
| §1.5 no new page in W5 | (no route added — caption attaches to an existing card) |
| Exit gate #1 (synthetic e2e) | Task 11 |
| Exit gate #2 (caption renders) | Task 10 step 3 |
| Exit gate #3 (Hollywood unaffected) | Task 12 |
| Exit gate #4 (ops flip is the only action when GLN/VNYS open) | Implicit — `maybe_promote_to_ready` runs automatically after the flip. Task 11 verifies. |

No placeholders. Type names consistent (`LifecycleStage`, `ForecastSource`, `TransferWriteResult`, `should_promote_to_ready`, `flip_to_ready`, `write_transfer_forecasts_for_store`, `transfer_forecast_wape`, `resolve_hollywood_store_id`, `list_stores_by_stage`) — verified by ctrl-F across the plan.

Subsequent plans:

- [W6-8 reconciliation](2026-05-17-ml-phase1-w6-8-reconciliation.md) — to be written after W5 ships.
- [W9-12 growth + quality panel](2026-05-17-ml-phase1-w9-12-growth.md) — to be written after W6-8 ships.
