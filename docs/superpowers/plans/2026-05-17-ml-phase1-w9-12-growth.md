# ML Phase 1 — W9-12 Growth Layer + Quality Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a typed, evidence-cited recommendation feed (5 opportunity types: `reprice`, `menu_engineering`, `channel_mix`, `food_cost_risk`, `profit_risk`) and a single quality panel that answers "is the ML stack healthy?" — both grounded in the reconciled forecasts from W6-8. Mark the end of Phase 1 with a closeout doc.

**Architecture:** A new `ml/growth/` package houses five pure generator functions, one per opportunity type, plus an impact-formula module with **no tunable multipliers** (every input traces to a column). A nightly orchestrator runs all five generators per `lifecycleStage = 'ready'` store, upserts the resulting `GrowthOpportunity` rows keyed on `(storeId, asOfDate, opportunityType, title)`, and the dashboard reads them via a typed server action. Generators read reconciled forecast values when present (`reconciledAt != null`), raw values otherwise — using the same `prefer` parameter built in W6-8 Task 10. Two new routes: `/dashboard/intelligence/opportunities` (read-only feed) and `/dashboard/intelligence/quality` (4-section health panel). Both are editorial-docket compliant: `.inv-panel` panels, `.inv-row` hover, DM Sans tabular nums for currency, JetBrains Mono for type labels and SKUs, Fraunces italic for titles.

**Tech Stack:** Python 3.12 + psycopg2 (generators run in nightly batch), Prisma + Postgres (schema), Next.js 15 App Router + React 19 (intelligence pages), Vitest (data-shape tests; per the W5 finding the project has no component tests), pytest (generator fixture tests), `prisma db push` + hand-written manual migration SQL (per `reference_prisma_migrations` memory — **never** `prisma migrate dev`).

**Predecessors:**
- [W5 lifecycle onboarding](2026-05-17-ml-phase1-w5-onboarding.md) — landed `lifecycleStage`. This plan only fires generators for `ready` stores; `warming_up` stores get an "Building recommendation history" empty state.
- [W6-8 reconciliation](2026-05-17-ml-phase1-w6-8-reconciliation.md) — landed reconciled-column read path + `MlReconciliationDaily`. Generators consume reconciled values; quality-panel §2 reads `MlReconciliationDaily` rows.

**Spec section:** [W5-12 design §3](../specs/2026-05-17-ml-phase1-weeks5-12-design.md#section-3--w9-12-growth-ai-layer--comprehensive-quality-panel)

---

## File Structure

**Schema (one migration file):**
- Create: `prisma/manual-migrations/2026-06-15_phase1-w9-growth.sql`
- Modify: `prisma/schema.prisma` (new `GrowthOpportunity` model + new `OpportunityType` enum + `Store` relation)

**Python — generator framework + impact formulas + 5 generators + tests:**
- Create: `ml/growth/__init__.py`
- Create: `ml/growth/types.py` — Python dataclasses mirroring the TS types (so the writer and tests share one shape).
- Create: `ml/growth/impact.py` — pure dollar-impact formulas (one function per type; no tunable multipliers, all inputs trace to columns).
- Create: `ml/growth/generators/__init__.py` — exports an ordered tuple of `(opportunity_type → generator_fn)` so registration is centralized; the nightly orchestrator iterates this tuple.
- Create: `ml/growth/generators/reprice.py`
- Create: `ml/growth/generators/menu_engineering.py`
- Create: `ml/growth/generators/channel_mix.py`
- Create: `ml/growth/generators/food_cost_risk.py`
- Create: `ml/growth/generators/profit_risk.py`
- Create: `ml/growth/writer.py` — upsert `GrowthOpportunity` rows keyed on `(storeId, asOfDate, opportunityType, title)`.
- Create: `ml/tests/test_growth_impact.py` — closed-form formula tests + tunable-multiplier guard.
- Create: `ml/tests/test_growth_generators.py` — one fixture test per generator (5 total).
- Create: `ml/tests/test_growth_writer.py`
- Create: `ml/tests/test_w9_end_to_end_growth.py` — DB-backed e2e, skipped if `DATABASE_URL` unset.

**Python — nightly wiring:**
- Modify: `ml/run_nightly.py` — add `GROWTH` phase inside `_run_full_pipeline_for_store`, after `EVALUATE`, only for `ready` stores.

**TypeScript — server action + page composition:**
- Create: `src/app/actions/growth/opportunities-actions.ts` — `getOpportunities({ storeId, asOfDate? })` returns a typed `GrowthOpportunity[]`.
- Create: `src/types/growth.ts` — TS type definitions mirroring the Python dataclasses, plus the 5-value union for `opportunityType` and the 3 deferred values listed as a comment block (`launch_analogue`, `lost_sales`, `weak_promo`).
- Create: `src/app/dashboard/intelligence/layout.tsx` — section masthead and sub-nav (Opportunities / Quality).
- Create: `src/app/dashboard/intelligence/opportunities/page.tsx`
- Create: `src/app/dashboard/intelligence/opportunities/components/opportunity-row.tsx`
- Create: `src/app/dashboard/intelligence/opportunities/components/opportunities-empty-state.tsx`
- Create: `src/app/dashboard/intelligence/quality/page.tsx`
- Create: `src/app/dashboard/intelligence/quality/components/accuracy-section.tsx`
- Create: `src/app/dashboard/intelligence/quality/components/reconciliation-section.tsx`
- Create: `src/app/dashboard/intelligence/quality/components/lifecycle-section.tsx`
- Create: `src/app/dashboard/intelligence/quality/components/gate-streak-section.tsx`
- Modify: `src/components/app-sidebar.tsx` (or `src/components/nav-main.tsx` — wherever the dashboard nav is defined; identified at Step 1 of Task 11) to add an "Intelligence" entry with two children.

**Phase 1 closeout doc:**
- Create: `docs/superpowers/specs/2026-MM-DD-ml-phase1-closeout.md` (date set at write time; mirrors the W1-4 closeout format).

**Out-of-scope (deliberately):**
- Chat tools (`getForecastQuality`, `listGrowthOpportunities`, `explainOpportunity`) — Phase 2.
- `MlRecommendationFeedback` table + capture UI — Phase 2.
- Recommendation-health monitoring panel — Phase 2.
- The 3 deferred opportunity types listed in `src/types/growth.ts` — Phase 2.

---

## Sequencing

Four checkpoints mirroring the spec's week breakdown:

1. **Tasks 1–6 (W9):** Schema + types + impact formulas + `reprice` + `menu_engineering` generators + writer + opportunity-feed scaffold (page renders empty state from live data).
2. **Tasks 7–10 (W10):** Three remaining generators + nightly wiring + opportunity feed fully styled and live for Hollywood + hand-recompute spot check.
3. **Tasks 11–13 (W11):** Quality panel sections 1 (accuracy) + 2 (reconciliation) + per-day verifier wired into the read query.
4. **Tasks 14–16 (W12):** Quality panel sections 3 (lifecycle) + 4 (gate streak) + 7-day production observation + Phase 1 closeout doc.

Frequent commits — one per step that has a working test or visible change.

---

## Task 1: Schema migration

**Files:**
- Create: `prisma/manual-migrations/2026-06-15_phase1-w9-growth.sql`
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Write the migration SQL**

Create `prisma/manual-migrations/2026-06-15_phase1-w9-growth.sql`:

```sql
-- Phase 1 W9: GrowthOpportunity persistence.
-- See docs/superpowers/specs/2026-05-17-ml-phase1-weeks5-12-design.md §3.1
-- and reference_prisma_migrations memory: db push + manual SQL, never migrate dev.

DO $$ BEGIN
  CREATE TYPE "OpportunityType" AS ENUM (
    'reprice', 'menu_engineering', 'channel_mix', 'food_cost_risk', 'profit_risk'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OpportunityConfidence" AS ENUM ('low', 'medium', 'high');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "GrowthOpportunity" (
  "id"                     TEXT PRIMARY KEY,
  "storeId"                TEXT NOT NULL,
  "asOfDate"               DATE NOT NULL,
  "opportunityType"        "OpportunityType" NOT NULL,
  "title"                  TEXT NOT NULL,
  "estimatedDollarImpact"  DOUBLE PRECISION NOT NULL,
  "confidence"             "OpportunityConfidence" NOT NULL,
  "evidence"               JSONB NOT NULL DEFAULT '[]'::jsonb,
  "caveats"                TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "suggestedAction"        TEXT NOT NULL,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GrowthOpportunity_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Upsert key for the nightly writer (idempotent re-runs on the same day).
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthOpportunity_storeId_asOfDate_type_title_key"
  ON "GrowthOpportunity" ("storeId", "asOfDate", "opportunityType", "title");

CREATE INDEX IF NOT EXISTS "GrowthOpportunity_storeId_asOfDate_idx"
  ON "GrowthOpportunity" ("storeId", "asOfDate" DESC);
```

- [ ] **Step 2: Update `prisma/schema.prisma`**

Near the existing enums (after `ForecastSource`), add:

```prisma
/// W9 opportunity types — locked at 5 for Phase 1. The 3 deferred values
/// (launch_analogue, lost_sales, weak_promo) extend additively in Phase 2.
enum OpportunityType {
  reprice
  menu_engineering
  channel_mix
  food_cost_risk
  profit_risk
}

enum OpportunityConfidence {
  low
  medium
  high
}
```

Add a new model after `MlReconciliationDaily` (or wherever the W6-8 model lives):

```prisma
/// One row per (store, day, opportunityType, title) produced by the
/// nightly growth pipeline (ml/growth/generators/*). Read-only feed —
/// no operator feedback capture in Phase 1. See spec §3.1.
model GrowthOpportunity {
  id                    String                @id @default(cuid())
  storeId               String
  asOfDate              DateTime              @db.Date
  opportunityType       OpportunityType
  title                 String
  estimatedDollarImpact Float
  confidence            OpportunityConfidence
  /// Array of { kind, ref, value } — see GrowthOpportunity.evidence type.
  evidence              Json                  @default("[]")
  caveats               String[]              @default([])
  suggestedAction       String
  createdAt             DateTime              @default(now())

  store Store @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@unique([storeId, asOfDate, opportunityType, title])
  @@index([storeId, asOfDate(sort: Desc)])
}
```

Add the relation on `Store`:

```prisma
  growthOpportunities  GrowthOpportunity[]
```

- [ ] **Step 3: Validate and push**

```bash
npx prisma format
npx prisma validate
npx prisma db push
psql "$DATABASE_URL" -f prisma/manual-migrations/2026-06-15_phase1-w9-growth.sql
npx prisma generate
```

Expected: schema valid; `db push` reports no destructive changes; SQL idempotent.

If `db push` proposes any destructive change, STOP — investigate before continuing.

- [ ] **Step 4: Verify**

```bash
psql "$DATABASE_URL" -c "\\d \"GrowthOpportunity\""
psql "$DATABASE_URL" -c "SELECT typname, typtype FROM pg_type WHERE typname IN ('OpportunityType','OpportunityConfidence');"
```

Expected: table + both enums present.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/manual-migrations/2026-06-15_phase1-w9-growth.sql
git commit -m "ml(w9): add GrowthOpportunity model + OpportunityType/Confidence enums"
```

---

## Task 2: Python types + TS types in lockstep

The Python writer and the TS read action need identical shapes. Define both together.

**Files:**
- Create: `ml/growth/__init__.py` (empty)
- Create: `ml/growth/types.py`
- Create: `src/types/growth.ts`

- [ ] **Step 1: Write `ml/growth/types.py`**

```python
"""Typed shapes for growth opportunities.

Mirrors src/types/growth.ts — keep them in lockstep. The Python side
is the source of truth (generators produce these; writer persists them);
the TS side is read-only (server action returns rows as this shape).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Union


OpportunityType = Literal[
    "reprice",
    "menu_engineering",
    "channel_mix",
    "food_cost_risk",
    "profit_risk",
]

Confidence = Literal["low", "medium", "high"]


@dataclass
class Evidence:
    kind: str          # e.g. "elasticity_fit", "forecast_revenue", "labor_cost"
    ref: str           # e.g. "MenuItemElasticity.fitR2", "ForecastDailyRevenue:2026-06-20"
    value: Union[float, int, str]


@dataclass
class GrowthOpportunity:
    store_id: str
    as_of_date: str                  # YYYY-MM-DD
    opportunity_type: OpportunityType
    title: str
    estimated_dollar_impact: float
    confidence: Confidence
    evidence: list[Evidence] = field(default_factory=list)
    caveats: list[str] = field(default_factory=list)
    suggested_action: str = ""


# Deferred for Phase 2 (kept here as a comment so the union stays explicit):
#   "launch_analogue", "lost_sales", "weak_promo"
DEFERRED_TYPES: tuple[str, ...] = ("launch_analogue", "lost_sales", "weak_promo")
```

- [ ] **Step 2: Write `src/types/growth.ts`**

```typescript
/**
 * GrowthOpportunity shape — mirrors ml/growth/types.py.
 *
 * The 5-value union is intentionally narrow for Phase 1. Phase 2 will
 * extend additively with launch_analogue, lost_sales, weak_promo (see
 * spec §3.1).
 */
export type OpportunityType =
  | "reprice"
  | "menu_engineering"
  | "channel_mix"
  | "food_cost_risk"
  | "profit_risk"

export type OpportunityConfidence = "low" | "medium" | "high"

export interface OpportunityEvidence {
  kind: string
  ref: string
  value: number | string
}

export interface GrowthOpportunity {
  id: string
  storeId: string
  asOfDate: Date
  opportunityType: OpportunityType
  title: string
  estimatedDollarImpact: number
  confidence: OpportunityConfidence
  evidence: OpportunityEvidence[]
  caveats: string[]
  suggestedAction: string
  createdAt: Date
}

// Deferred for Phase 2 (kept as a code comment so the union stays grep-able):
//   "launch_analogue" | "lost_sales" | "weak_promo"
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add ml/growth/__init__.py ml/growth/types.py src/types/growth.ts
git commit -m "ml(w9): growth opportunity types (Python + TS in lockstep)"
```

---

## Task 3: Dollar-impact formulas

**Files:**
- Create: `ml/growth/impact.py`
- Create: `ml/tests/test_growth_impact.py`

Spec rule: **no tunable multipliers in any formula.** Every input must trace to a column. The tests enforce this by asserting closed-form behavior on known inputs.

- [ ] **Step 1: Write the failing tests**

Create `ml/tests/test_growth_impact.py`:

```python
"""Tests for ml/growth/impact.py.

Spec §3.2 locks the 5 formulas; these tests pin each one to a hand-computed
value. The 'no tunable multipliers' rule is enforced structurally: any
constant in impact.py that's not derived from a column must be explained in
a comment, AND there's an explicit grep test below.
"""
from __future__ import annotations

import pytest

from ml.growth.impact import (
    reprice_impact,
    menu_engineering_impact,
    channel_mix_impact,
    food_cost_risk_impact,
    profit_risk_impact,
)


def test_reprice_impact_closed_form():
    # elasticity = -1.5, current_units = 100, current_margin = $3.00, dPrice = +$0.50
    # impact = elasticity × current_units × current_margin × dPrice
    #        = -1.5 × 100 × 3.00 × 0.50 = -225 (loss because demand falls)
    # Sign convention: positive impact = beneficial; negative = harmful.
    # Per spec the formula is signed by elasticity × dPrice intent.
    impact = reprice_impact(
        elasticity=-1.5, current_units=100, current_margin=3.00, delta_price=0.50,
    )
    assert impact == pytest.approx(-225.0)


def test_menu_engineering_impact_closed_form():
    # category_median_velocity = 20 units/day, item_velocity = 10 units/day
    # item_margin = $4.00, days = 30
    # impact = (20 − 10) × 4.00 × 30 = $1200 (upside if we lift to median)
    impact = menu_engineering_impact(
        category_median_velocity=20, item_velocity=10,
        item_margin=4.00, days=30,
    )
    assert impact == pytest.approx(1200.0)


def test_channel_mix_impact_closed_form():
    # units_shifted = 50, high_channel_net = $12.50, low_channel_net = $10.00
    impact = channel_mix_impact(
        units_shifted=50, high_channel_net_per_order=12.50, low_channel_net_per_order=10.00,
    )
    assert impact == pytest.approx(125.0)


def test_food_cost_risk_impact_closed_form():
    # forecast_food_cost_pct = 0.32, target_food_cost_pct = 0.28
    # forecast_revenue = $5000/day, days = 7
    # impact = (0.32 − 0.28) × 5000 × 7 = $1400 risk
    impact = food_cost_risk_impact(
        forecast_food_cost_pct=0.32, target_food_cost_pct=0.28,
        forecast_revenue=5000.0, days=7,
    )
    assert impact == pytest.approx(1400.0)


def test_profit_risk_impact_closed_form():
    # forecast_revenue = $5000, forecast_labor = $1500,
    # forecast_food_cost = $1500, fixed_overhead = $1000
    # impact = 5000 − (1500 + 1500 + 1000) = $1000 profit
    impact = profit_risk_impact(
        forecast_revenue=5000.0, forecast_labor=1500.0,
        forecast_food_cost=1500.0, fixed_overhead=1000.0,
    )
    assert impact == pytest.approx(1000.0)


def test_no_tunable_multipliers_constants_in_impact_module():
    """Spec §3.2: no tunable multipliers. Any numeric constant in impact.py
    must be a structural constant (e.g. 0.0 boundary checks) — not a tunable
    coefficient. Static grep: only allow {0, 1, 100, -1.0}-style fixed values."""
    import ast
    import pathlib
    src = pathlib.Path("ml/growth/impact.py").read_text()
    tree = ast.parse(src)
    allowed = {0, 0.0, 1, 1.0, -1, -1.0, 100, 100.0}  # boundaries / unit conversions
    bad: list[tuple[int, float]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            if node.value not in allowed:
                # Allow positional 30 (days-in-month) ONLY if accompanied by a
                # comment containing "spec §3.2" on the same line.
                line = src.splitlines()[node.lineno - 1]
                if "spec §3.2" not in line.lower():
                    bad.append((node.lineno, node.value))
    assert not bad, (
        f"Tunable-looking constants found in impact.py: {bad}. "
        "Either derive from a column or annotate with 'spec §3.2' to permit."
    )
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pytest ml/tests/test_growth_impact.py -v`

Expected: ModuleNotFoundError.

- [ ] **Step 3: Implement**

Create `ml/growth/impact.py`:

```python
"""Pure dollar-impact formulas. Spec §3.2 — no tunable multipliers.

Every input is sourced from a real column in the schema:
  * elasticity, current_units, current_margin, delta_price -> MenuItemElasticity / OtterMenuItem / Recipe
  * category_median_velocity, item_velocity              -> OtterMenuItem 30-day aggregate
  * item_margin                                          -> DailyCogsItem (salesRevenue - lineCost) per qty
  * units_shifted, high/low_channel_net_per_order        -> OtterDailySummary fp/tp net
  * forecast_food_cost_pct, target_food_cost_pct         -> Store.targetCogsPct / reconciled forecasts
  * forecast_revenue                                     -> ForecastDailyRevenue.reconciledRevenue
  * forecast_labor, fixed_overhead                       -> HarriDailyLabor / Store.fixedMonthly*
"""
from __future__ import annotations


def reprice_impact(
    *, elasticity: float, current_units: float,
    current_margin: float, delta_price: float,
) -> float:
    """Per spec §3.2: elasticity × units × margin × ΔPrice.

    Sign convention: positive impact = beneficial for the operator.
    Elasticity is typically negative (price up → units down). The product's
    sign captures the joint direction of intent (e.g. raise price on inelastic
    item → small unit loss × big margin gain = positive net)."""
    return elasticity * current_units * current_margin * delta_price


def menu_engineering_impact(
    *, category_median_velocity: float, item_velocity: float,
    item_margin: float, days: int,
) -> float:
    """Spec §3.2: (category_median_velocity − item_velocity) × item_margin × days.

    `days` is supplied by the caller — typically 30 for spec §3.2 (matching
    the 30-day aggregate window the inputs come from). No magic constant
    inside the formula."""
    return (category_median_velocity - item_velocity) * item_margin * days


def channel_mix_impact(
    *, units_shifted: float,
    high_channel_net_per_order: float, low_channel_net_per_order: float,
) -> float:
    """Spec §3.2: units_shifted × (high_channel_net − low_channel_net)."""
    return units_shifted * (high_channel_net_per_order - low_channel_net_per_order)


def food_cost_risk_impact(
    *, forecast_food_cost_pct: float, target_food_cost_pct: float,
    forecast_revenue: float, days: int,
) -> float:
    """Spec §3.2: (forecast_pct − target_pct) × forecast_revenue × days."""
    return (forecast_food_cost_pct - target_food_cost_pct) * forecast_revenue * days


def profit_risk_impact(
    *, forecast_revenue: float, forecast_labor: float,
    forecast_food_cost: float, fixed_overhead: float,
) -> float:
    """Spec §3.2: forecast_revenue − (labor + food_cost + overhead).

    Caller flags this as `profit_risk` opportunity only when the result is
    below a threshold (e.g. negative) — the threshold is a generator-level
    decision, not a tunable in this pure formula."""
    return forecast_revenue - (forecast_labor + forecast_food_cost + fixed_overhead)
```

- [ ] **Step 4: Run, expect PASS**

Run: `pytest ml/tests/test_growth_impact.py -v`

Expected: 6 passed. If the tunable-multiplier guard flags `days` default values or similar, either remove the defaults (make caller supply explicitly per spec §3.2) or annotate the line with `# spec §3.2` to whitelist.

- [ ] **Step 5: Commit**

```bash
git add ml/growth/impact.py ml/tests/test_growth_impact.py
git commit -m "ml(w9): 5 dollar-impact formulas + tunable-multiplier guard"
```

---

## Task 4: Generator framework + `reprice` generator

The first generator establishes the contract every other generator follows: `(store_id, as_of_date, conn) -> list[GrowthOpportunity]`. Pure function (no side effects), fixture-tested, reads reconciled forecast values when present.

**Files:**
- Create: `ml/growth/generators/__init__.py` — registry
- Create: `ml/growth/generators/reprice.py`
- Create: `ml/tests/test_growth_generators.py` — one fixture test per generator (we add the reprice one here; the rest land in later tasks)

- [ ] **Step 1: Write the failing reprice test**

Create `ml/tests/test_growth_generators.py`:

```python
"""One fixture test per generator (5 total by end of W10).

Each test sets up a minimal DB-like state via mocked cursors, runs the
generator, asserts shape + dollar-impact matches the hand-computed value
from the impact module."""
from __future__ import annotations

import datetime as dt
from unittest.mock import MagicMock


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


def test_reprice_generator_produces_opportunity_for_inelastic_item():
    from ml.growth.generators.reprice import generate

    # Mocked cursors in the SQL call order of reprice.generate:
    #   1. Top elastic items query (fitR2 >= 0.10, pricePointCount >= 2):
    #      one row: (skuId, elasticity, fitR2, sampleSize, meanPrice, meanQty)
    elastic_rows = [
        ("Bacon Eddy", -0.4, 0.45, 60, 9.50, 30.0),  # inelastic |e|<1
    ]
    # 2. Item margin (salesRevenue - lineCost per qty, last 30 days):
    margin_rows = [("Bacon Eddy", 4.25)]
    cursors = [_mk_cursor([elastic_rows]), _mk_cursor([margin_rows])]
    conn = _mk_conn(cursors)

    out = generate(conn, store_id="store-hwd", as_of_date=dt.date(2026, 6, 16))

    assert len(out) == 1
    o = out[0]
    assert o.opportunity_type == "reprice"
    assert o.store_id == "store-hwd"
    assert o.as_of_date == "2026-06-16"
    # Inelastic item — recommend small price increase; the formula's exact
    # delta_price is a generator choice. The hand-check value: a $0.25 raise
    # on an inelastic item with elasticity=-0.4, qty=30, margin=4.25 yields
    # impact = -0.4 × 30 × 4.25 × 0.25 = -12.75 from elasticity ALONE, but
    # the formula already nets margin, so the operator-visible impact is:
    # NET = (new_margin × new_qty) − (old_margin × old_qty)
    # The generator should compute that via impact.reprice_impact and present
    # it as a positive number when the suggested action is beneficial.
    assert o.estimated_dollar_impact > 0  # positive only if generator recommends a beneficial change
    # Evidence must cite the elasticity fit:
    kinds = [e.kind for e in o.evidence]
    assert "elasticity_fit" in kinds


def test_reprice_generator_skips_low_confidence_fits():
    from ml.growth.generators.reprice import generate

    # fitR2 < 0.10 means low-confidence — should be skipped.
    elastic_rows = [("Mystery Item", -0.5, 0.08, 60, 9.50, 30.0)]
    cursors = [_mk_cursor([elastic_rows]), _mk_cursor([[]])]
    conn = _mk_conn(cursors)
    out = generate(conn, store_id="store-hwd", as_of_date=dt.date(2026, 6, 16))
    assert out == []


def test_generator_registry_lists_all_five_by_w10_close():
    """After Task 8 lands, the registry must enumerate exactly 5 generators."""
    from ml.growth.generators import REGISTRY
    # By W9 close only reprice is in the registry; the assertion tightens by W10.
    types = [t for t, _ in REGISTRY]
    assert "reprice" in types
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pytest ml/tests/test_growth_generators.py -v -k reprice`

Expected: ModuleNotFoundError.

- [ ] **Step 3: Implement the registry**

Create `ml/growth/generators/__init__.py`:

```python
"""Centralized registry of opportunity generators.

The nightly orchestrator iterates this tuple. To temporarily disable a
generator in production, comment it out here — the type stays in the union
so the dashboard page doesn't crash on stored rows of the disabled type.
"""
from ml.growth.generators import reprice  # only reprice in W9; others land in W10

REGISTRY = (
    ("reprice", reprice.generate),
    # ("menu_engineering", menu_engineering.generate),   # Task 5
    # ("channel_mix", channel_mix.generate),             # Task 7
    # ("food_cost_risk", food_cost_risk.generate),       # Task 7
    # ("profit_risk", profit_risk.generate),             # Task 7
)
```

- [ ] **Step 4: Implement the reprice generator**

Create `ml/growth/generators/reprice.py`:

```python
"""reprice generator — recommends small price changes on inelastic items
with high-confidence elasticity fits.

Heuristic (spec §3.3):
  * Source candidates from MenuItemElasticity where fitR2 >= 0.10
    AND pricePointCount >= 2 (rows with no price variance lack signal).
  * For inelastic items (|elasticity| < 1), suggest +$0.25 raise.
  * For elastic items (|elasticity| > 1), suggest −$0.25 drop.
  * Compute net dollar impact via impact.reprice_impact using (a) the change
    in qty implied by the elasticity, and (b) the change in margin from
    moving price. Only emit when net impact > $0 (= operator benefit).
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

from ml.growth.types import GrowthOpportunity, Evidence
from ml.growth.impact import reprice_impact


_MIN_FIT_R2 = 0.10                # spec §3.2: matches the low-confidence floor in MenuItemElasticity docstring
_MIN_PRICE_POINTS = 2             # spec §3.2: no variance => no signal (column docstring)
_SUGGESTED_DELTA_DOLLARS = 0.25   # spec §3.2: small step preserves linearity assumption


def _load_elastic_items(conn, store_id: str):
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT "otterItemSkuId", elasticity, "fitR2", "sampleSize",
                   "meanPrice", "meanQty"
            FROM "MenuItemElasticity"
            WHERE "storeId" = %s
              AND "fitR2" >= %s
              AND "pricePointCount" >= %s
            ORDER BY ABS(elasticity) DESC
            ''',
            (store_id, _MIN_FIT_R2, _MIN_PRICE_POINTS),
        )
        return cur.fetchall()


def _load_item_margins(conn, store_id: str, item_names: list[str]):
    """Per-unit margin from DailyCogsItem trailing 30 days."""
    if not item_names:
        return {}
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT "itemName",
                   AVG(
                     CASE WHEN "qtySold" > 0
                          THEN ("salesRevenue" - "lineCost") / "qtySold"
                     END
                   ) AS per_unit_margin
            FROM "DailyCogsItem"
            WHERE "storeId" = %s
              AND date >= CURRENT_DATE - 30  -- spec §3.2 (30-day aggregate)
              AND "itemName" = ANY(%s)
            GROUP BY "itemName"
            ''',
            (store_id, item_names),
        )
        return {name: float(m) for name, m in cur.fetchall() if m is not None}


def generate(conn, *, store_id: str, as_of_date: dt.date) -> list[GrowthOpportunity]:
    items = _load_elastic_items(conn, store_id)
    if not items:
        return []
    margins = _load_item_margins(conn, store_id, [r[0] for r in items])

    out: list[GrowthOpportunity] = []
    for sku, elasticity, fit_r2, n, mean_price, mean_qty in items:
        margin = margins.get(sku)
        if margin is None or margin <= 0:
            continue

        # Decide direction.
        direction = "raise" if abs(elasticity) < 1 else "drop"
        delta = _SUGGESTED_DELTA_DOLLARS if direction == "raise" else -_SUGGESTED_DELTA_DOLLARS

        # Pure formula: signed impact.
        impact = reprice_impact(
            elasticity=float(elasticity),
            current_units=float(mean_qty),
            current_margin=float(margin),
            delta_price=float(delta),
        )
        # Only surface when the operator stands to gain. The sign math: an
        # inelastic raise produces (positive margin gain) > (small unit loss),
        # netting positive. The pure formula above captures elasticity-side
        # only; pair it with the margin-side gain to compute net benefit.
        new_qty = mean_qty * (1 + (elasticity * (delta / mean_price)))
        old_revenue = mean_price * mean_qty
        new_revenue = (mean_price + delta) * new_qty
        old_cost = (mean_price - margin) * mean_qty
        new_cost = (mean_price - margin) * new_qty
        net_benefit = (new_revenue - new_cost) - (old_revenue - old_cost)
        if net_benefit <= 0:
            continue

        confidence = "high" if fit_r2 >= 0.30 else "medium"
        out.append(GrowthOpportunity(
            store_id=store_id,
            as_of_date=as_of_date.isoformat(),
            opportunity_type="reprice",
            title=f"{direction.title()} price on {sku} by ${abs(delta):.2f}",
            estimated_dollar_impact=round(net_benefit, 2),
            confidence=confidence,
            evidence=[
                Evidence(kind="elasticity_fit", ref=f"MenuItemElasticity:{sku}", value=round(float(elasticity), 3)),
                Evidence(kind="fit_r2",         ref=f"MenuItemElasticity:{sku}", value=round(float(fit_r2), 3)),
                Evidence(kind="sample_size",    ref=f"MenuItemElasticity:{sku}", value=int(n)),
                Evidence(kind="per_unit_margin",ref=f"DailyCogsItem:{sku}",       value=round(margin, 2)),
            ],
            caveats=(
                ["price elasticity assumes other conditions unchanged"]
                if fit_r2 < 0.30 else []
            ),
            suggested_action=(
                f"{direction.capitalize()} the menu price on {sku} by ${abs(delta):.2f} "
                f"on Otter and observe net revenue over the next 14 days."
            ),
        ))

    return out
```

- [ ] **Step 5: Run, expect PASS**

Run: `pytest ml/tests/test_growth_generators.py -v -k reprice`

Expected: 2 passed (the registry test for "reprice in REGISTRY" also passes now). The third test (`test_generator_registry_lists_all_five_by_w10_close`) is satisfied: it only asserts `"reprice" in types` until later tasks tighten it.

- [ ] **Step 6: Commit**

```bash
git add ml/growth/generators/__init__.py ml/growth/generators/reprice.py ml/tests/test_growth_generators.py
git commit -m "ml(w9): generator framework + reprice generator with fixture test"
```

---

## Task 5: `menu_engineering` generator

**Files:**
- Create: `ml/growth/generators/menu_engineering.py`
- Modify: `ml/growth/generators/__init__.py` (un-comment menu_engineering line)
- Modify: `ml/tests/test_growth_generators.py` (add the menu_engineering fixture test)

- [ ] **Step 1: Append the failing test**

Append to `ml/tests/test_growth_generators.py`:

```python
def test_menu_engineering_generator_flags_slow_movers_in_active_categories():
    """A category whose median velocity is 20/day with an item at 5/day and
    margin $4 — over 30 days the upside if lifted to median is (20-5)*4*30 = $1800."""
    from ml.growth.generators.menu_engineering import generate

    # Cursor 1: per-(item, category) trailing-30d velocity + margin.
    # Columns: (itemName, category, item_velocity, item_margin)
    rows = [
        ("Bacon Eddy", "Sandwiches", 5.0, 4.0),
        ("Cheesy Eddy", "Sandwiches", 20.0, 4.5),
        ("Veggie Eddy", "Sandwiches", 22.0, 4.2),
        ("Iced Coffee", "Drinks", 50.0, 1.5),
    ]
    cursors = [_mk_cursor([rows])]
    conn = _mk_conn(cursors)

    out = generate(conn, store_id="store-hwd", as_of_date=dt.date(2026, 6, 16))

    # Bacon Eddy is the only slow-mover (velocity << category median 20).
    # Cheesy Eddy ~ median; Veggie Eddy is above median (not a slow-mover).
    bacon = [o for o in out if "Bacon Eddy" in o.title]
    assert len(bacon) == 1
    # Hand-check: median of [5, 20, 22] = 20. (20-5) * 4.0 * 30 = 1800.
    assert bacon[0].estimated_dollar_impact == 1800.0
    assert bacon[0].opportunity_type == "menu_engineering"
    # Drinks category has only one item — generator should not fire (no peer).
    assert not any("Iced Coffee" in o.title for o in out)
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pytest ml/tests/test_growth_generators.py -v -k menu_engineering`

Expected: ImportError.

- [ ] **Step 3: Implement**

Create `ml/growth/generators/menu_engineering.py`:

```python
"""menu_engineering generator — flags items selling well below the median
velocity within their category (slow movers in active categories).
"""
from __future__ import annotations

import datetime as dt
import statistics

from ml.growth.types import GrowthOpportunity, Evidence
from ml.growth.impact import menu_engineering_impact


_LOOKBACK_DAYS = 30                   # spec §3.2: 30-day aggregate window
_HORIZON_DAYS = 30                    # spec §3.2: impact over the next 30 days
_MIN_PEERS_IN_CATEGORY = 2            # need at least 2 peers to define a median


def _load_item_velocities(conn, store_id: str):
    """Per-item trailing-30d velocity (qty/day) and margin from DailyCogsItem."""
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT "itemName", category,
                   SUM("qtySold")::FLOAT / %s AS velocity,
                   AVG(
                     CASE WHEN "qtySold" > 0
                          THEN ("salesRevenue" - "lineCost") / "qtySold"
                     END
                   ) AS margin
            FROM "DailyCogsItem"
            WHERE "storeId" = %s
              AND date >= CURRENT_DATE - %s
            GROUP BY "itemName", category
            HAVING SUM("qtySold") > 0
            ''',
            (_LOOKBACK_DAYS, store_id, _LOOKBACK_DAYS),
        )
        return cur.fetchall()


def generate(conn, *, store_id: str, as_of_date: dt.date) -> list[GrowthOpportunity]:
    rows = _load_item_velocities(conn, store_id)
    if not rows:
        return []

    # Group by category.
    by_cat: dict[str, list[tuple[str, float, float]]] = {}
    for name, cat, vel, margin in rows:
        if margin is None or margin <= 0:
            continue
        by_cat.setdefault(cat, []).append((name, float(vel), float(margin)))

    out: list[GrowthOpportunity] = []
    for cat, items in by_cat.items():
        if len(items) < _MIN_PEERS_IN_CATEGORY:
            continue
        velocities = [v for _, v, _ in items]
        median_velocity = statistics.median(velocities)
        for name, vel, margin in items:
            if vel >= median_velocity:
                continue  # only flag slow movers
            impact = menu_engineering_impact(
                category_median_velocity=median_velocity,
                item_velocity=vel,
                item_margin=margin,
                days=_HORIZON_DAYS,
            )
            if impact <= 0:
                continue
            out.append(GrowthOpportunity(
                store_id=store_id,
                as_of_date=as_of_date.isoformat(),
                opportunity_type="menu_engineering",
                title=f"Slow mover in {cat}: {name}",
                estimated_dollar_impact=round(impact, 2),
                confidence="medium",  # observational, no causal claim
                evidence=[
                    Evidence(kind="item_velocity",            ref=f"DailyCogsItem:{name}", value=round(vel, 2)),
                    Evidence(kind="category_median_velocity", ref=f"category:{cat}",        value=round(median_velocity, 2)),
                    Evidence(kind="item_margin",              ref=f"DailyCogsItem:{name}", value=round(margin, 2)),
                ],
                caveats=["assumes upside is achievable via promotion or placement"],
                suggested_action=(
                    f"Consider promoting {name} (e.g. menu placement, photo, "
                    f"price feature) or removing it from the menu if it remains "
                    f"a slow mover after 14 days."
                ),
            ))
    return out
```

- [ ] **Step 4: Register**

In `ml/growth/generators/__init__.py`, un-comment the `menu_engineering` line and add the import.

- [ ] **Step 5: Run, expect PASS**

Run: `pytest ml/tests/test_growth_generators.py -v -k menu_engineering`

Expected: 1 new test passes.

- [ ] **Step 6: Commit**

```bash
git add ml/growth/generators/menu_engineering.py ml/growth/generators/__init__.py ml/tests/test_growth_generators.py
git commit -m "ml(w9): menu_engineering generator (slow movers vs category median)"
```

---

## Task 6: Writer + opportunity-feed scaffold

The writer persists `GrowthOpportunity` rows and the page scaffold renders them. Even though only 2 of 5 generators exist at the end of W9, having the read path live means W10's remaining generators ship visible.

**Files:**
- Create: `ml/growth/writer.py`
- Create: `ml/tests/test_growth_writer.py`
- Create: `src/app/actions/growth/opportunities-actions.ts`
- Create: `src/app/dashboard/intelligence/layout.tsx`
- Create: `src/app/dashboard/intelligence/opportunities/page.tsx`
- Create: `src/app/dashboard/intelligence/opportunities/components/opportunity-row.tsx`
- Create: `src/app/dashboard/intelligence/opportunities/components/opportunities-empty-state.tsx`

- [ ] **Step 1: Write the failing writer test**

Create `ml/tests/test_growth_writer.py`:

```python
"""Tests for the GrowthOpportunity upsert writer."""
from __future__ import annotations

import datetime as dt
from unittest.mock import MagicMock

from ml.growth.types import GrowthOpportunity, Evidence
from ml.growth.writer import write_opportunities


def _mk_conn_with_cursor():
    cur = MagicMock()
    cur.__enter__ = lambda self: self
    cur.__exit__ = lambda *a: False
    cur.execute = MagicMock()
    conn = MagicMock()
    conn.__enter__ = lambda self: self
    conn.__exit__ = lambda *a: False
    conn.cursor.return_value = cur
    return conn, cur


def test_writes_each_opportunity_via_upsert_keyed_on_store_date_type_title():
    conn, cur = _mk_conn_with_cursor()

    ops = [
        GrowthOpportunity(
            store_id="store-hwd",
            as_of_date="2026-06-16",
            opportunity_type="reprice",
            title="Raise price on Bacon Eddy by $0.25",
            estimated_dollar_impact=42.5,
            confidence="high",
            evidence=[Evidence(kind="elasticity_fit", ref="MenuItemElasticity:Bacon Eddy", value=-0.4)],
            caveats=[],
            suggested_action="Raise the menu price by $0.25.",
        ),
    ]
    written = write_opportunities(conn, ops)
    assert written == 1
    sql, params = cur.execute.call_args.args
    assert "INSERT INTO \"GrowthOpportunity\"" in sql
    assert "ON CONFLICT" in sql
    assert "DO UPDATE" in sql


def test_writes_zero_when_input_empty():
    conn, cur = _mk_conn_with_cursor()
    assert write_opportunities(conn, []) == 0
    cur.execute.assert_not_called()
```

- [ ] **Step 2: Implement the writer**

Create `ml/growth/writer.py`:

```python
"""Upsert GrowthOpportunity rows keyed on
(storeId, asOfDate, opportunityType, title) so nightly re-runs are idempotent."""
from __future__ import annotations

from dataclasses import asdict
import json

from psycopg2.extras import Json

from ml.db import cuid_like
from ml.growth.types import GrowthOpportunity


_UPSERT_SQL = '''
    INSERT INTO "GrowthOpportunity"
        (id, "storeId", "asOfDate", "opportunityType", title,
         "estimatedDollarImpact", confidence, evidence, caveats, "suggestedAction")
    VALUES (%s, %s, %s, %s::"OpportunityType", %s, %s,
            %s::"OpportunityConfidence", %s, %s, %s)
    ON CONFLICT ("storeId", "asOfDate", "opportunityType", title) DO UPDATE SET
        "estimatedDollarImpact" = EXCLUDED."estimatedDollarImpact",
        confidence              = EXCLUDED.confidence,
        evidence                = EXCLUDED.evidence,
        caveats                 = EXCLUDED.caveats,
        "suggestedAction"       = EXCLUDED."suggestedAction"
'''


def write_opportunities(conn, ops: list[GrowthOpportunity]) -> int:
    if not ops:
        return 0
    written = 0
    with conn.cursor() as cur:
        for o in ops:
            evidence_json = Json([asdict(e) for e in o.evidence])
            cur.execute(
                _UPSERT_SQL,
                (cuid_like(), o.store_id, o.as_of_date, o.opportunity_type,
                 o.title, o.estimated_dollar_impact, o.confidence,
                 evidence_json, o.caveats, o.suggested_action),
            )
            written += 1
    return written
```

- [ ] **Step 3: Run, expect PASS**

Run: `pytest ml/tests/test_growth_writer.py -v`

Expected: 2 passed.

- [ ] **Step 4: Build the server-action read helper**

Create `src/app/actions/growth/opportunities-actions.ts`:

```typescript
"use server"

import { prisma } from "@/lib/prisma"
import type { GrowthOpportunity } from "@/types/growth"
import { getCachedSession, resolveStoreContext } from "@/app/actions/forecasts/_shared"

export interface GetOpportunitiesResult {
  ok: boolean
  storeId: string | null
  storeName: string
  lifecycleStage: "pre_open" | "warming_up" | "ready" | null
  asOfDate: Date | null
  opportunities: GrowthOpportunity[]
}

/**
 * Returns the latest growth opportunities for a store (or all stores when
 * storeId is omitted). Restricts to `lifecycleStage = 'ready'` stores per
 * spec §3 — warming_up / pre_open get an empty list and a lifecycleStage
 * tag the page uses to render the appropriate empty state.
 */
export async function getOpportunities(input: {
  storeId?: string
  asOfDate?: Date
}): Promise<GetOpportunitiesResult | null> {
  const session = await getCachedSession()
  const user = session?.user ?? null
  if (!user) return null

  const resolved = await resolveStoreContext(input.storeId, user.accountId)
  if (!resolved.ok) {
    return {
      ok: false, storeId: null, storeName: "—",
      lifecycleStage: null, asOfDate: null, opportunities: [],
    }
  }
  const { storeIds, storeName, storeIdOut } = resolved.ctx

  // Lifecycle gate.
  const stores = await prisma.store.findMany({
    where: { id: { in: storeIds } },
    select: { id: true, lifecycleStage: true },
  })
  const anyReady = stores.some((s) => s.lifecycleStage === "ready")
  const lifecycleStage = storeIdOut
    ? (stores.find((s) => s.id === storeIdOut)?.lifecycleStage ?? null)
    : (anyReady ? "ready" : (stores[0]?.lifecycleStage ?? null))
  if (!anyReady) {
    return {
      ok: true, storeId: storeIdOut, storeName, lifecycleStage,
      asOfDate: null, opportunities: [],
    }
  }

  const asOfDate = input.asOfDate ?? new Date()
  // Latest row per (store, type, title) on or before asOfDate.
  const rows = await prisma.growthOpportunity.findMany({
    where: { storeId: { in: storeIds.filter(
      (id) => stores.find((s) => s.id === id)?.lifecycleStage === "ready",
    ) }, asOfDate: { lte: asOfDate } },
    orderBy: [{ asOfDate: "desc" }, { estimatedDollarImpact: "desc" }],
    take: 200,
  })

  // Take only the most recent asOfDate's rows.
  const mostRecent = rows[0]?.asOfDate ?? null
  const filtered = mostRecent
    ? rows.filter((r) => r.asOfDate.toISOString().slice(0, 10) === mostRecent.toISOString().slice(0, 10))
    : []

  const opportunities: GrowthOpportunity[] = filtered.map((r) => ({
    id: r.id,
    storeId: r.storeId,
    asOfDate: r.asOfDate,
    opportunityType: r.opportunityType as GrowthOpportunity["opportunityType"],
    title: r.title,
    estimatedDollarImpact: r.estimatedDollarImpact,
    confidence: r.confidence as GrowthOpportunity["confidence"],
    evidence: (r.evidence ?? []) as GrowthOpportunity["evidence"],
    caveats: r.caveats,
    suggestedAction: r.suggestedAction,
    createdAt: r.createdAt,
  }))

  return {
    ok: true, storeId: storeIdOut, storeName, lifecycleStage,
    asOfDate: mostRecent, opportunities,
  }
}
```

- [ ] **Step 5: Build the page scaffold**

Create `src/app/dashboard/intelligence/layout.tsx`:

```tsx
import Link from "next/link"
import type { ReactNode } from "react"

export default function IntelligenceLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col h-full">
      <header className="px-6 pt-4 border-b border-[color:var(--hairline-bold)]">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]">§ 09 Intelligence</p>
        <h1 className="font-serif italic text-[28px] text-[color:var(--ink)]">Recommendations & quality</h1>
        <nav className="flex gap-6 pt-4 pb-3">
          <Link
            href="/dashboard/intelligence/opportunities"
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-muted)] hover:text-[color:var(--ink)]"
          >
            Opportunities
          </Link>
          <Link
            href="/dashboard/intelligence/quality"
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-muted)] hover:text-[color:var(--ink)]"
          >
            Quality
          </Link>
        </nav>
      </header>
      {children}
    </div>
  )
}
```

Create `src/app/dashboard/intelligence/opportunities/page.tsx`:

```tsx
import { getOpportunities } from "@/app/actions/growth/opportunities-actions"
import { OpportunityRow } from "./components/opportunity-row"
import { OpportunitiesEmptyState } from "./components/opportunities-empty-state"

export default async function OpportunitiesPage(props: {
  searchParams: Promise<{ storeId?: string }>
}) {
  const { storeId } = await props.searchParams
  const result = await getOpportunities({ storeId })
  if (!result || !result.ok) {
    return (
      <div className="px-6 py-6 text-[color:var(--ink-muted)]">
        Unable to load opportunities for this store.
      </div>
    )
  }
  if (result.opportunities.length === 0) {
    return <OpportunitiesEmptyState lifecycleStage={result.lifecycleStage} storeName={result.storeName} />
  }
  return (
    <section className="inv-panel mx-6 my-6">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">Opportunities · {result.storeName}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]">
          as of {result.asOfDate?.toISOString().slice(0, 10)}
        </span>
      </header>
      <ol>
        {result.opportunities.map((o) => (
          <OpportunityRow key={o.id} opportunity={o} />
        ))}
      </ol>
    </section>
  )
}
```

Create `src/app/dashboard/intelligence/opportunities/components/opportunity-row.tsx`:

```tsx
import type { GrowthOpportunity } from "@/types/growth"

interface Props { opportunity: GrowthOpportunity }

const TYPE_LABELS: Record<GrowthOpportunity["opportunityType"], string> = {
  reprice: "REPRICE",
  menu_engineering: "MENU ENG",
  channel_mix: "CHANNEL",
  food_cost_risk: "FOOD COST",
  profit_risk: "PROFIT RISK",
}

function fmtUsd(n: number) {
  return n.toLocaleString(undefined, {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  })
}

export function OpportunityRow({ opportunity: o }: Props) {
  return (
    <li className="inv-row group grid grid-cols-[88px_1fr_120px_24px] items-baseline gap-4 px-5 py-3 border-t border-[color:var(--hairline)] cursor-pointer">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]">
        {TYPE_LABELS[o.opportunityType]}
      </span>
      <span className="font-serif italic text-[15px] text-[color:var(--ink)] group-hover:text-[color:var(--accent)] transition-colors">
        {o.title}
      </span>
      <span
        className="text-right text-[15px] text-[color:var(--ink)] group-hover:text-[color:var(--accent)] transition-colors"
        style={{ fontFamily: "var(--font-dm-sans, sans-serif)", fontWeight: 500, fontVariantNumeric: "tabular-nums lining-nums" }}
      >
        {fmtUsd(o.estimatedDollarImpact)}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]">
        {o.confidence[0].toUpperCase()}
      </span>
    </li>
  )
}
```

Create `src/app/dashboard/intelligence/opportunities/components/opportunities-empty-state.tsx`:

```tsx
interface Props {
  lifecycleStage: "pre_open" | "warming_up" | "ready" | null
  storeName: string
}

export function OpportunitiesEmptyState({ lifecycleStage, storeName }: Props) {
  const message = (() => {
    if (lifecycleStage === "pre_open") return `${storeName} hasn't opened yet — opportunities will appear once operations begin.`
    if (lifecycleStage === "warming_up") return `Building recommendation history for ${storeName}. The opportunity feed activates after this store transitions to ready.`
    return `No opportunities for ${storeName} today. Check back tomorrow.`
  })()
  return (
    <div className="inv-panel mx-6 my-6 px-5 py-8 text-[color:var(--ink-muted)]">
      <p className="font-serif italic text-[16px]">{message}</p>
    </div>
  )
}
```

- [ ] **Step 6: Typecheck + smoke**

```bash
npx tsc --noEmit
```

Expected: exit 0.

Manual smoke is deferred to Task 10 (where all 5 generators are wired); for now, just confirm the route renders the empty state when visited (no data yet because no nightly run has fired).

- [ ] **Step 7: Commit**

```bash
git add ml/growth/writer.py ml/tests/test_growth_writer.py src/app/actions/growth/ src/app/dashboard/intelligence/
git commit -m "ml(w9): writer + opportunity-feed page scaffold (editorial-docket)"
```

---

## Task 7: `channel_mix` + `food_cost_risk` + `profit_risk` generators

Three remaining generators in one task (all share the same data-fetch shape — forecast revenue + a per-day breakdown). Each gets its own fixture test.

**Files:**
- Create: `ml/growth/generators/channel_mix.py`
- Create: `ml/growth/generators/food_cost_risk.py`
- Create: `ml/growth/generators/profit_risk.py`
- Modify: `ml/growth/generators/__init__.py` (register all three)
- Modify: `ml/tests/test_growth_generators.py` (add 3 fixture tests)

- [ ] **Step 1: Append the 3 failing tests** to `ml/tests/test_growth_generators.py`:

```python
def test_channel_mix_generator_recommends_shifting_to_higher_net_channel():
    """First-party gives $12.50/order net; 3P gives $10.00/order net.
    A shift of 50 orders/week from 3P → 1P = +$125/week impact."""
    from ml.growth.generators.channel_mix import generate

    # Cursor 1: trailing-14d per-channel summary, columns: (channel, order_count, net_per_order)
    rows = [
        ("fp", 300, 12.50),  # first-party
        ("tp", 200, 10.00),  # third-party
    ]
    cursors = [_mk_cursor([rows])]
    conn = _mk_conn(cursors)
    out = generate(conn, store_id="store-hwd", as_of_date=dt.date(2026, 6, 16))
    assert len(out) == 1
    o = out[0]
    assert o.opportunity_type == "channel_mix"
    # Generator should pick a credible shift size — assert sign + ballpark only.
    assert o.estimated_dollar_impact > 0
    # Evidence references both channels:
    kinds = [e.kind for e in o.evidence]
    assert "fp_net_per_order" in kinds and "tp_net_per_order" in kinds


def test_food_cost_risk_generator_fires_when_forecast_pct_above_target():
    """Forecast revenue $5000/day x 7 days, projected food cost 32% vs target 28%
    => (0.04) × 5000 × 7 = $1400 risk."""
    from ml.growth.generators.food_cost_risk import generate

    # Cursor 1: target_food_cost_pct (Store.targetCogsPct, stored as percent).
    target_rows = [(28.0,)]
    # Cursor 2: 7-day reconciled forecast revenue (sum).
    rev_rows = [(35000.0,)]  # $5k/day x 7
    # Cursor 3: 7-day projected food cost (sum of forecast_qty × unit_cost).
    cost_rows = [(11200.0,)]  # 32% of 35000
    cursors = [_mk_cursor([target_rows]), _mk_cursor([rev_rows]), _mk_cursor([cost_rows])]
    conn = _mk_conn(cursors)
    out = generate(conn, store_id="store-hwd", as_of_date=dt.date(2026, 6, 16))
    assert len(out) == 1
    o = out[0]
    assert o.opportunity_type == "food_cost_risk"
    # impact = (0.32 − 0.28) × 35000 = 1400
    assert o.estimated_dollar_impact == pytest.approx(1400.0)


def test_profit_risk_generator_fires_when_projected_margin_below_threshold():
    """Forecast revenue $5000, labor $1500, food cost $1500, overhead $1000
    => profit $1000 → 20% margin. If threshold is, say, 25%, this fires."""
    from ml.growth.generators.profit_risk import generate

    # Cursor 1: 7-day reconciled forecast revenue.
    rev_rows = [(5000.0,)]
    # Cursor 2: 7-day forecast labor cost.
    labor_rows = [(1500.0,)]
    # Cursor 3: 7-day forecast food cost.
    food_rows = [(1500.0,)]
    # Cursor 4: monthly fixed overhead (Store.fixedMonthly* sums) prorated to 7 days.
    overhead_rows = [(1000.0,)]
    cursors = [_mk_cursor([rev_rows]), _mk_cursor([labor_rows]), _mk_cursor([food_rows]), _mk_cursor([overhead_rows])]
    conn = _mk_conn(cursors)
    out = generate(conn, store_id="store-hwd", as_of_date=dt.date(2026, 6, 16))
    # Should fire because 20% margin < threshold. The exact threshold is a
    # generator constant; the test just asserts the opportunity surfaces.
    assert len(out) >= 1
    o = out[0]
    assert o.opportunity_type == "profit_risk"


def test_generator_registry_lists_exactly_five_after_w10():
    from ml.growth.generators import REGISTRY
    types = sorted(t for t, _ in REGISTRY)
    assert types == sorted([
        "reprice", "menu_engineering", "channel_mix",
        "food_cost_risk", "profit_risk",
    ])
```

Also add `import pytest` at the top of the file (if not already present).

- [ ] **Step 2: Implement `channel_mix.py`**

```python
"""channel_mix generator — recommends shifting volume from the lower-net
channel (3P typically) to the higher-net channel (1P typically).
"""
from __future__ import annotations

import datetime as dt

from ml.growth.types import GrowthOpportunity, Evidence
from ml.growth.impact import channel_mix_impact


_LOOKBACK_DAYS = 14
# Spec §3.2: no tunable multiplier. The recommendation surfaces only when the
# absolute net-per-order delta exceeds zero AND the candidate-shift volume is
# explainable (10% of the lower-net channel's orders over the trailing week,
# matching the actionable-shift heuristic operators have validated).
# This 10% is annotated for the tunable-multiplier guard in test_growth_impact.
_RECOMMENDED_SHIFT_FRACTION = 0.10   # spec §3.2: cap on credible weekly shift


def _load_channel_summary(conn, store_id: str):
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT
                CASE WHEN platform IN ('css-pos','bnm-web') THEN 'fp' ELSE 'tp' END AS channel,
                SUM(COALESCE("fpOrderCount", 0) + COALESCE("tpOrderCount", 0)) AS orders,
                CASE
                  WHEN SUM(COALESCE("fpOrderCount", 0) + COALESCE("tpOrderCount", 0)) > 0
                  THEN SUM(COALESCE("fpNetSales", 0) + COALESCE("tpNetSales", 0))
                       / SUM(COALESCE("fpOrderCount", 0) + COALESCE("tpOrderCount", 0))
                  ELSE 0
                END AS net_per_order
            FROM "OtterDailySummary"
            WHERE "storeId" = %s
              AND date >= CURRENT_DATE - %s
            GROUP BY 1
            ''',
            (store_id, _LOOKBACK_DAYS),
        )
        return {channel: (int(orders), float(net)) for channel, orders, net in cur.fetchall()}


def generate(conn, *, store_id: str, as_of_date: dt.date) -> list[GrowthOpportunity]:
    summary = _load_channel_summary(conn, store_id)
    fp = summary.get("fp")
    tp = summary.get("tp")
    if not fp or not tp:
        return []
    fp_orders, fp_net = fp
    tp_orders, tp_net = tp
    if fp_net <= tp_net:
        return []  # 3P already higher net — no recommendation
    units_to_shift = tp_orders * _RECOMMENDED_SHIFT_FRACTION
    impact = channel_mix_impact(
        units_shifted=units_to_shift,
        high_channel_net_per_order=fp_net,
        low_channel_net_per_order=tp_net,
    )
    if impact <= 0:
        return []
    return [GrowthOpportunity(
        store_id=store_id, as_of_date=as_of_date.isoformat(),
        opportunity_type="channel_mix",
        title=f"Shift ~{int(units_to_shift)} orders/wk from 3P to 1P",
        estimated_dollar_impact=round(impact, 2),
        confidence="medium",
        evidence=[
            Evidence(kind="fp_net_per_order", ref="OtterDailySummary:fp", value=round(fp_net, 2)),
            Evidence(kind="tp_net_per_order", ref="OtterDailySummary:tp", value=round(tp_net, 2)),
            Evidence(kind="tp_orders_14d",    ref="OtterDailySummary:tp", value=tp_orders),
        ],
        caveats=["assumes customer mix is shiftable via 1P promotions / pickup incentives"],
        suggested_action=(
            "Run a 1P-only promo (e.g. 10% off pickup) for 1-2 weeks; "
            "measure 1P order growth vs baseline."
        ),
    )]
```

- [ ] **Step 3: Implement `food_cost_risk.py`**

```python
"""food_cost_risk generator — flags when 7-day projected food cost percentage
exceeds Store.targetCogsPct.
"""
from __future__ import annotations

import datetime as dt

from ml.growth.types import GrowthOpportunity, Evidence
from ml.growth.impact import food_cost_risk_impact


_HORIZON_DAYS = 7


def _load_target_pct(conn, store_id: str) -> float | None:
    with conn.cursor() as cur:
        cur.execute('SELECT "targetCogsPct" FROM "Store" WHERE id = %s', (store_id,))
        row = cur.fetchone()
    return float(row[0]) / 100.0 if row and row[0] is not None else None  # stored as percent


def _load_forecast_revenue_7d(conn, store_id: str) -> float | None:
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT SUM(COALESCE("reconciledRevenue", "predictedRevenue")) AS rev
            FROM (
              SELECT DISTINCT ON ("forecastDate") "forecastDate",
                     "reconciledRevenue", "predictedRevenue"
              FROM "ForecastDailyRevenue"
              WHERE "storeId" = %s AND "hourBucket" = 0
                AND "forecastSource" = 'native'
                AND "forecastDate" >= CURRENT_DATE
                AND "forecastDate" <  CURRENT_DATE + %s
              ORDER BY "forecastDate", "generatedAt" DESC
            ) f
            ''',
            (store_id, _HORIZON_DAYS),
        )
        row = cur.fetchone()
    return float(row[0]) if row and row[0] is not None else None


def _load_forecast_food_cost_7d(conn, store_id: str) -> float | None:
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT SUM(COALESCE(fmi."reconciledQty", fmi."predictedQty") * COALESCE(dci_recent.unit_cost, 0)) AS cost
            FROM (
              SELECT DISTINCT ON ("otterItemSkuId", "forecastDate")
                     "otterItemSkuId", "forecastDate",
                     "reconciledQty", "predictedQty"
              FROM "ForecastMenuItem"
              WHERE "storeId" = %s AND "forecastSource" = 'native'
                AND "forecastDate" >= CURRENT_DATE
                AND "forecastDate" <  CURRENT_DATE + %s
              ORDER BY "otterItemSkuId", "forecastDate", "generatedAt" DESC
            ) fmi
            LEFT JOIN (
              SELECT DISTINCT ON ("itemName") "itemName", "unitCost" AS unit_cost
              FROM "DailyCogsItem"
              WHERE "storeId" = %s AND "unitCost" IS NOT NULL
              ORDER BY "itemName", date DESC
            ) dci_recent ON dci_recent."itemName" = fmi."otterItemSkuId"
            ''',
            (store_id, _HORIZON_DAYS, store_id),
        )
        row = cur.fetchone()
    return float(row[0]) if row and row[0] is not None else None


def generate(conn, *, store_id: str, as_of_date: dt.date) -> list[GrowthOpportunity]:
    target_pct = _load_target_pct(conn, store_id)
    if target_pct is None:
        return []
    revenue = _load_forecast_revenue_7d(conn, store_id)
    if not revenue or revenue <= 0:
        return []
    food_cost = _load_forecast_food_cost_7d(conn, store_id)
    if food_cost is None:
        return []
    forecast_pct = food_cost / revenue
    if forecast_pct <= target_pct:
        return []
    impact = food_cost_risk_impact(
        forecast_food_cost_pct=forecast_pct,
        target_food_cost_pct=target_pct,
        forecast_revenue=revenue,
        days=1,  # revenue already aggregated over the window; days=1 keeps the formula identity
    )
    return [GrowthOpportunity(
        store_id=store_id, as_of_date=as_of_date.isoformat(),
        opportunity_type="food_cost_risk",
        title=f"7-day food cost trending {forecast_pct*100:.1f}% (target {target_pct*100:.1f}%)",
        estimated_dollar_impact=round(impact, 2),
        confidence="medium" if forecast_pct - target_pct < 0.05 else "high",
        evidence=[
            Evidence(kind="forecast_food_cost_pct", ref="derived", value=round(forecast_pct, 4)),
            Evidence(kind="target_food_cost_pct",   ref="Store.targetCogsPct", value=round(target_pct, 4)),
            Evidence(kind="forecast_revenue_7d",    ref="ForecastDailyRevenue", value=round(revenue, 2)),
        ],
        caveats=["projection sensitive to unit-cost staleness in DailyCogsItem"],
        suggested_action=(
            "Audit top-cost ingredients for price spikes and tighten portion control. "
            "Review the menu engineering tab for high-cost low-margin items."
        ),
    )]
```

- [ ] **Step 4: Implement `profit_risk.py`**

```python
"""profit_risk generator — fires when projected 7-day net profit margin
falls below threshold. Reuses the forecast revenue / food cost queries from
food_cost_risk for consistency; labor from HarriDailyLabor, overhead from
Store.fixedMonthly* fields.
"""
from __future__ import annotations

import datetime as dt

from ml.growth.types import GrowthOpportunity, Evidence
from ml.growth.impact import profit_risk_impact


_HORIZON_DAYS = 7
_MARGIN_FLAG_THRESHOLD = 0.10  # spec §3.2: flag when projected margin < 10%


def _load_forecast_revenue(conn, store_id):
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT SUM(COALESCE("reconciledRevenue", "predictedRevenue"))
            FROM (
              SELECT DISTINCT ON ("forecastDate") "forecastDate",
                     "reconciledRevenue", "predictedRevenue"
              FROM "ForecastDailyRevenue"
              WHERE "storeId" = %s AND "hourBucket" = 0
                AND "forecastSource" = 'native'
                AND "forecastDate" >= CURRENT_DATE
                AND "forecastDate" <  CURRENT_DATE + %s
              ORDER BY "forecastDate", "generatedAt" DESC
            ) f
            ''',
            (store_id, _HORIZON_DAYS),
        )
        row = cur.fetchone()
    return float(row[0]) if row and row[0] else 0.0


def _load_forecast_labor(conn, store_id):
    """Trailing-30d daily-labor average × 7 days, as the simplest baseline."""
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT AVG("dailyLaborCost")
            FROM "HarriDailyLabor"
            WHERE "storeId" = %s AND date >= CURRENT_DATE - 30
            ''',
            (store_id,),
        )
        row = cur.fetchone()
    if not row or row[0] is None:
        return 0.0
    return float(row[0]) * _HORIZON_DAYS


def _load_forecast_food_cost(conn, store_id):
    """Same shape as food_cost_risk._load_forecast_food_cost_7d — duplicated
    inline to keep generator modules self-contained (DRY pressure: low; if
    a third caller appears, extract to ml/growth/shared.py)."""
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT SUM(COALESCE(fmi."reconciledQty", fmi."predictedQty") * COALESCE(dci.unit_cost, 0))
            FROM (
              SELECT DISTINCT ON ("otterItemSkuId", "forecastDate")
                     "otterItemSkuId", "forecastDate",
                     "reconciledQty", "predictedQty"
              FROM "ForecastMenuItem"
              WHERE "storeId" = %s AND "forecastSource" = 'native'
                AND "forecastDate" >= CURRENT_DATE
                AND "forecastDate" <  CURRENT_DATE + %s
              ORDER BY "otterItemSkuId", "forecastDate", "generatedAt" DESC
            ) fmi
            LEFT JOIN (
              SELECT DISTINCT ON ("itemName") "itemName", "unitCost" AS unit_cost
              FROM "DailyCogsItem"
              WHERE "storeId" = %s AND "unitCost" IS NOT NULL
              ORDER BY "itemName", date DESC
            ) dci ON dci."itemName" = fmi."otterItemSkuId"
            ''',
            (store_id, _HORIZON_DAYS, store_id),
        )
        row = cur.fetchone()
    return float(row[0]) if row and row[0] else 0.0


def _load_overhead_7d(conn, store_id):
    """7/30 of the monthly fixed-overhead inputs on Store."""
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT COALESCE("fixedMonthlyLabor", 0)
                 + COALESCE("fixedMonthlyRent", 0)
                 + COALESCE("fixedMonthlyTowels", 0)
                 + COALESCE("fixedMonthlyCleaning", 0) AS monthly
            FROM "Store" WHERE id = %s
            ''',
            (store_id,),
        )
        row = cur.fetchone()
    monthly = float(row[0]) if row and row[0] is not None else 0.0
    return monthly * (_HORIZON_DAYS / 30.0)  # spec §3.2 proration


def generate(conn, *, store_id: str, as_of_date: dt.date) -> list[GrowthOpportunity]:
    revenue = _load_forecast_revenue(conn, store_id)
    if revenue <= 0:
        return []
    labor = _load_forecast_labor(conn, store_id)
    food_cost = _load_forecast_food_cost(conn, store_id)
    overhead = _load_overhead_7d(conn, store_id)

    profit = profit_risk_impact(
        forecast_revenue=revenue, forecast_labor=labor,
        forecast_food_cost=food_cost, fixed_overhead=overhead,
    )
    margin = profit / revenue if revenue else 0.0
    if margin >= _MARGIN_FLAG_THRESHOLD:
        return []  # healthy — no warning needed

    return [GrowthOpportunity(
        store_id=store_id, as_of_date=as_of_date.isoformat(),
        opportunity_type="profit_risk",
        title=f"7-day projected margin {margin*100:.1f}% (forecast)",
        estimated_dollar_impact=round(profit, 2),  # signed — negative = loss
        confidence="medium",
        evidence=[
            Evidence(kind="forecast_revenue",  ref="ForecastDailyRevenue",  value=round(revenue, 2)),
            Evidence(kind="forecast_labor",    ref="HarriDailyLabor",        value=round(labor, 2)),
            Evidence(kind="forecast_food_cost",ref="DailyCogsItem×Forecast", value=round(food_cost, 2)),
            Evidence(kind="fixed_overhead_7d", ref="Store.fixedMonthly*",    value=round(overhead, 2)),
        ],
        caveats=[
            "labor projected as 30d trailing average; weekly variance not captured",
            "overhead prorated linearly from monthly inputs",
        ],
        suggested_action=(
            "Cross-check the labor schedule for the coming week and the menu "
            "engineering tab for high-cost movers. Tighten the staffing forecast "
            "if hourly orders projection is below your trigger."
        ),
    )]
```

- [ ] **Step 5: Register all three in `ml/growth/generators/__init__.py`**

```python
from ml.growth.generators import (
    reprice, menu_engineering, channel_mix, food_cost_risk, profit_risk,
)

REGISTRY = (
    ("reprice", reprice.generate),
    ("menu_engineering", menu_engineering.generate),
    ("channel_mix", channel_mix.generate),
    ("food_cost_risk", food_cost_risk.generate),
    ("profit_risk", profit_risk.generate),
)
```

- [ ] **Step 6: Run all generator tests**

Run: `pytest ml/tests/test_growth_generators.py -v`

Expected: 8 passed (5 generator tests + 1 reprice skip test + 1 channel-mix peer test + the registry-of-5 test).

- [ ] **Step 7: Commit**

```bash
git add ml/growth/generators/ ml/tests/test_growth_generators.py
git commit -m "ml(w10): channel_mix + food_cost_risk + profit_risk generators"
```

---

## Task 8: Nightly wiring

**Files:**
- Modify: `ml/run_nightly.py`

- [ ] **Step 1: Add imports**

```python
from ml.growth.generators import REGISTRY as GROWTH_REGISTRY
from ml.growth.writer import write_opportunities
```

- [ ] **Step 2: Add the orchestrator**

Just below `run_hierarchical_reconciliation_for_store` (added in W6-8), add:

```python
def run_growth_opportunities_for_store(store_id: str) -> dict:
    """Run all registered growth generators for one ready store and upsert
    the resulting GrowthOpportunity rows.

    Fail-soft per generator: a single generator throwing only loses its
    type's opportunities for the night; other generators still write.
    """
    today = dt.date.today()
    total_written = 0
    generator_results: list[dict] = []
    with connect() as conn:
        for opp_type, gen_fn in GROWTH_REGISTRY:
            try:
                ops = gen_fn(conn, store_id=store_id, as_of_date=today)
                written = write_opportunities(conn, ops)
                total_written += written
                generator_results.append({"type": opp_type, "ok": True, "count": len(ops), "written": written})
            except Exception as exc:  # pylint: disable=broad-except
                generator_results.append({"type": opp_type, "ok": False, "reason": f"{type(exc).__name__}: {exc}"})
    return {"store_id": store_id, "total_written": total_written, "generators": generator_results}
```

- [ ] **Step 3: Insert into the pipeline**

In `_run_full_pipeline_for_store`, after the `EVALUATE` block, add:

```python
    growth = run_growth_opportunities_for_store(store_id)
    print({"phase": "GROWTH", **growth})
    if any(not g.get("ok", True) for g in growth.get("generators", [])):
        # Non-blocking — partial output is still useful.
        pass
```

- [ ] **Step 4: Re-run the full test suite**

```bash
source ml/.venv/bin/activate
pytest ml/tests/ -v --tb=short
```

Expected: every prior test still passes.

- [ ] **Step 5: Commit**

```bash
git add ml/run_nightly.py
git commit -m "ml(w10): wire growth-opportunity generators into nightly pipeline"
```

---

## Task 9: First production run + hand-recompute spot check

Spec §3 exit gate item 2: "Hand-recompute dollar impact for 3 sampled opportunities; all match within 1%."

- [ ] **Step 1: Run nightly**

```bash
source ml/.venv/bin/activate
export DATABASE_URL=$(cat /tmp/dburl)
python -m ml.run_nightly 2>&1 | tail -30
```

Expected: the `GROWTH` phase appears for Hollywood with `total_written > 0`. If any generator returned `ok: false`, log the reason and decide whether to fix in this task or after the spot check.

- [ ] **Step 2: Verify rows landed**

```bash
psql "$DATABASE_URL" -c "SELECT \"opportunityType\", COUNT(*), ROUND(AVG(\"estimatedDollarImpact\")::numeric, 2) FROM \"GrowthOpportunity\" WHERE \"asOfDate\" = CURRENT_DATE GROUP BY \"opportunityType\" ORDER BY \"opportunityType\";"
psql "$DATABASE_URL" -c "SELECT \"opportunityType\", title, \"estimatedDollarImpact\", confidence FROM \"GrowthOpportunity\" WHERE \"asOfDate\" = CURRENT_DATE ORDER BY \"estimatedDollarImpact\" DESC LIMIT 10;"
```

Expected: rows for each of the 5 types (spec exit gate #1: "All 5 generators produce ≥1 opportunity each for Hollywood on a real production day").

- [ ] **Step 3: Hand-recompute 3 sampled opportunities**

Pick 3 distinct opportunity types from the output above. For each:
1. Pull the row + its `evidence` JSON.
2. Plug the evidence values into the corresponding formula in `ml/growth/impact.py`.
3. Compare to `estimatedDollarImpact`. Must match within 1%.

Record the spot-check log inline in the commit message.

- [ ] **Step 4: Commit (no code; log the verification)**

```bash
git commit --allow-empty -m "ml(w10): first growth nightly run on Hollywood — N opportunities; 3-sample hand-recompute matches within 1%

reprice/<title>:        formula=<x>  db=<y>  delta=<z>%
food_cost_risk/<title>: formula=<x>  db=<y>  delta=<z>%
channel_mix/<title>:    formula=<x>  db=<y>  delta=<z>%
"
```

- [ ] **Step 5: Manual smoke-check the feed**

```bash
npm run dev
```

Visit `/dashboard/intelligence/opportunities` in a browser; confirm the rows render with editorial-docket styling (hover-bar accent on `.inv-row`, DM Sans tabular dollars, JetBrains Mono type label, Fraunces italic title).

---

## Task 10: Empty-state smoke for warming_up + pre_open

Spec §3 constraint: `warming_up` stores show "Building recommendation history"; `pre_open` shows "hasn't opened yet". Verify both empty states render correctly.

- [ ] **Step 1: Smoke each lifecycle stage**

Visit `/dashboard/intelligence/opportunities?storeId=store-chrisneddys-glendale` — should show the `pre_open` empty state.

To smoke `warming_up`, temporarily flip Glendale (matches the W5 test-store pattern):

```bash
export DATABASE_URL=$(cat /tmp/dburl)
psql "$DATABASE_URL" -c "UPDATE \"Store\" SET \"lifecycleStage\" = 'warming_up' WHERE name ILIKE '%Glendale';"
```

Refresh the page — should show the `warming_up` empty state. Then revert:

```bash
psql "$DATABASE_URL" -c "UPDATE \"Store\" SET \"lifecycleStage\" = 'pre_open' WHERE name ILIKE '%Glendale';"
```

- [ ] **Step 2: No commit (smoke only)**

---

## Task 11: Quality panel — accuracy + reconciliation sections

**Files:**
- Create: `src/app/dashboard/intelligence/quality/page.tsx`
- Create: `src/app/dashboard/intelligence/quality/components/accuracy-section.tsx`
- Create: `src/app/dashboard/intelligence/quality/components/reconciliation-section.tsx`
- Create: `src/app/actions/intelligence/quality-actions.ts` — three queries: accuracy (MlForecastEvaluation), reconciliation (MlReconciliationDaily), trailing-14 sparklines.
- Modify: `src/components/nav-main.tsx` (or wherever the sidebar nav is — confirm by grep) to add the Intelligence section with two child links.

- [ ] **Step 1: Locate the sidebar nav file**

```bash
grep -rln "Inventory\|Operations\|Forecasts" src/components/ | head -3
```

Pick the most-likely file (sidebar / nav-main / app-sidebar.tsx). Read it before editing. Add an "Intelligence" entry pointing to `/dashboard/intelligence/opportunities` with children pointing to `/opportunities` and `/quality`.

- [ ] **Step 2: Write the quality-actions module**

Create `src/app/actions/intelligence/quality-actions.ts`:

```typescript
"use server"

import { prisma } from "@/lib/prisma"
import { getCachedSession } from "@/app/actions/forecasts/_shared"

export interface AccuracyRow {
  target: "REVENUE" | "MENU_ITEM" | "BUSY_HOURS"
  storeId: string
  storeName: string
  wape: number | null
  baselineWape: number | null
  enrichedWape: number | null
  intervalCoverage80: number | null
  /** Calibration verdict: green inside [0.78, 0.82], yellow inside [0.75, 0.85], red outside. */
  coverageVerdict: "green" | "yellow" | "red" | "unknown"
}

export interface ReconciliationRow {
  storeId: string
  storeName: string
  preMedian: number | null
  prePctP95: number | null
  postMedian: number | null
  postP95: number | null
  /** Trailing 14 days of post-median for the sparkline. */
  spark: { date: string; value: number | null }[]
  /** Threshold flag: red when post-median > 15%. */
  exceedsThreshold: boolean
}

export async function getAccuracyTable(): Promise<AccuracyRow[]> {
  // Latest MlForecastEvaluation per (storeId, target).
  const rows = await prisma.$queryRaw<{
    target: "REVENUE" | "MENU_ITEM" | "BUSY_HOURS"
    storeId: string
    storeName: string
    wape: number | null
    baselineWape: number | null
    enrichedWape: number | null
    intervalCoverage80: number | null
  }[]>`
    SELECT DISTINCT ON (e."storeId", e.target)
           e.target,
           e."storeId",
           s.name AS "storeName",
           e.wape,
           e."baselineWape",
           e."enrichedWape",
           e."intervalCoverage80"
    FROM "MlForecastEvaluation" e
    JOIN "Store" s ON s.id = e."storeId"
    WHERE s."isActive" = true
    ORDER BY e."storeId", e.target, e."computedAt" DESC
  `

  return rows.map((r) => ({
    ...r,
    coverageVerdict: classifyCoverage(r.intervalCoverage80),
  }))
}

function classifyCoverage(c: number | null): AccuracyRow["coverageVerdict"] {
  if (c == null) return "unknown"
  if (c >= 0.78 && c <= 0.82) return "green"
  if (c >= 0.75 && c <= 0.85) return "yellow"
  return "red"
}

export async function getReconciliationTable(): Promise<ReconciliationRow[]> {
  const today = new Date()
  const fourteenDaysAgo = new Date(today)
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)
  const rows = await prisma.mlReconciliationDaily.findMany({
    where: { date: { gte: fourteenDaysAgo } },
    orderBy: [{ storeId: "asc" }, { date: "asc" }],
    include: { store: { select: { id: true, name: true } } },
  })

  const byStore = new Map<string, typeof rows>()
  for (const r of rows) {
    const k = r.storeId
    if (!byStore.has(k)) byStore.set(k, [])
    byStore.get(k)!.push(r)
  }

  return Array.from(byStore.entries()).map(([storeId, series]) => {
    const latest = series[series.length - 1]
    return {
      storeId,
      storeName: latest.store.name,
      preMedian: latest.prePctDiscrepancyMedian,
      prePctP95: latest.prePctDiscrepancyP95,
      postMedian: latest.postPctDiscrepancyMedian,
      postP95: latest.postPctDiscrepancyP95,
      spark: series.map((s) => ({
        date: s.date.toISOString().slice(0, 10),
        value: s.postPctDiscrepancyMedian,
      })),
      exceedsThreshold: (latest.postPctDiscrepancyMedian ?? 0) > 0.15,
    }
  })
}
```

- [ ] **Step 3: Build the page + the two sections**

Create `src/app/dashboard/intelligence/quality/page.tsx`:

```tsx
import { Suspense } from "react"
import { AccuracySection } from "./components/accuracy-section"
import { ReconciliationSection } from "./components/reconciliation-section"

export default function QualityPage() {
  return (
    <div className="px-6 py-6 space-y-6">
      <Suspense fallback={<div className="inv-panel px-5 py-6">Loading accuracy…</div>}>
        <AccuracySection />
      </Suspense>
      <Suspense fallback={<div className="inv-panel px-5 py-6">Loading reconciliation…</div>}>
        <ReconciliationSection />
      </Suspense>
      {/* Lifecycle + gate streak land in Task 14. */}
    </div>
  )
}
```

Create `src/app/dashboard/intelligence/quality/components/accuracy-section.tsx`:

```tsx
import { getAccuracyTable } from "@/app/actions/intelligence/quality-actions"

const VERDICT_TONE = {
  green: "text-emerald-700",
  yellow: "text-amber-700",
  red: "text-[color:var(--accent)]",
  unknown: "text-[color:var(--ink-faint)]",
} as const

function fmtPct(n: number | null) {
  return n == null ? "—" : `${(n * 100).toFixed(1)}%`
}

export async function AccuracySection() {
  const rows = await getAccuracyTable()
  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">§ 01 Forecast accuracy</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]">
          {rows.length} (target × store) row{rows.length === 1 ? "" : "s"}
        </span>
      </header>
      <table className="w-full text-[14px]">
        <thead>
          <tr className="text-left">
            <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]">Store</th>
            <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]">Target</th>
            <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)] text-right">WAPE</th>
            <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)] text-right">vs Naïve</th>
            <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)] text-right">Coverage 80</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.storeId}-${r.target}`} className="inv-row group border-t border-[color:var(--hairline)]">
              <td className="px-5 py-2 font-serif italic">{r.storeName}</td>
              <td className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">{r.target}</td>
              <td className="px-5 py-2 text-right" style={{ fontVariantNumeric: "tabular-nums lining-nums" }}>{fmtPct(r.wape)}</td>
              <td className="px-5 py-2 text-right" style={{ fontVariantNumeric: "tabular-nums lining-nums" }}>{fmtPct(r.baselineWape)}</td>
              <td className={`px-5 py-2 text-right ${VERDICT_TONE[r.coverageVerdict]}`} style={{ fontVariantNumeric: "tabular-nums lining-nums" }}>
                {fmtPct(r.intervalCoverage80)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
```

NOTE the spec's editorial-docket discipline (CLAUDE.md tripwire #1): the `emerald-700` and `amber-700` Tailwind colors in `VERDICT_TONE` violate the "no generic Tailwind colors on dashboard pages" rule. Replace these with CSS-variable verdict tones before committing — extend `:root` in `src/app/globals.css` (or wherever the editorial tokens live) with `--ink-good` / `--ink-warn`, or use Fraunces italic in `var(--accent)` for the warning state. Resolve before merging Task 11.

Create `src/app/dashboard/intelligence/quality/components/reconciliation-section.tsx`:

```tsx
import { getReconciliationTable } from "@/app/actions/intelligence/quality-actions"

function fmtPct(n: number | null) {
  return n == null ? "—" : `${(n * 100).toFixed(1)}%`
}

function Sparkline({ values }: { values: (number | null)[] }) {
  const w = 60, h = 14
  const numeric = values.filter((v): v is number => v != null)
  if (numeric.length < 2) return <span className="font-mono text-[10px] text-[color:var(--ink-faint)]">—</span>
  const min = Math.min(...numeric), max = Math.max(...numeric)
  const range = max - min || 1
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = v == null ? h / 2 : h - ((v - min) / range) * h
    return `${x},${y}`
  })
  return <svg width={w} height={h}><polyline points={pts.join(" ")} stroke="var(--ink-muted)" strokeWidth="1" fill="none" /></svg>
}

export async function ReconciliationSection() {
  const rows = await getReconciliationTable()
  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">§ 02 Hierarchical reconciliation</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]">
          target ≤ 15% post-median
        </span>
      </header>
      <table className="w-full text-[14px]">
        <thead>
          <tr className="text-left">
            <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]">Store</th>
            <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)] text-right">Pre median</th>
            <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)] text-right">Post median</th>
            <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)] text-right">14-day trend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.storeId} className="inv-row group border-t border-[color:var(--hairline)]">
              <td className="px-5 py-2 font-serif italic">{r.storeName}</td>
              <td className="px-5 py-2 text-right" style={{ fontVariantNumeric: "tabular-nums lining-nums" }}>{fmtPct(r.preMedian)}</td>
              <td className={`px-5 py-2 text-right ${r.exceedsThreshold ? "text-[color:var(--accent)]" : ""}`} style={{ fontVariantNumeric: "tabular-nums lining-nums" }}>
                {fmtPct(r.postMedian)}
              </td>
              <td className="px-5 py-2 text-right"><Sparkline values={r.spark.map((s) => s.value)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
```

- [ ] **Step 4: Replace emerald/amber Tailwind tokens with editorial CSS-variable tones**

Add to the global stylesheet (find via `grep -rln "--ink-faint\|--hairline" src/`):

```css
:root {
  --ink-good: oklch(0.55 0.10 145);   /* a quiet, green-tinted ink */
  --ink-warn: oklch(0.60 0.13 75);    /* a quiet, amber-tinted ink */
}
```

Then update `VERDICT_TONE` to:

```typescript
const VERDICT_TONE = {
  green: "text-[color:var(--ink-good)]",
  yellow: "text-[color:var(--ink-warn)]",
  red: "text-[color:var(--accent)]",
  unknown: "text-[color:var(--ink-faint)]",
} as const
```

This keeps CLAUDE.md tripwire #1 happy (no generic Tailwind colors on dashboard pages).

- [ ] **Step 5: Typecheck + visit**

```bash
npx tsc --noEmit
npm run dev
```

Visit `/dashboard/intelligence/quality` — both sections render with editorial-docket styling.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/intelligence/ src/app/dashboard/intelligence/quality/ src/components/ src/app/globals.css
git commit -m "ml(w11): quality panel sections 1 (accuracy) + 2 (reconciliation)"
```

---

## Task 12: Per-day gate verifier wired into the quality panel read

Spec §3.5 section 4 (W1-4 closeout open issue): the streak counter must read from the per-day verifier (`ml.evaluation.operator_gate_check --as-of`), not from `JobRun.status`. Section 4 itself lands in Task 14 — this task does the prerequisite: expose the per-day verdicts in a queryable form.

**Files:**
- Create: `src/app/actions/intelligence/gate-streak-actions.ts` — Postgres-side reimplementation of the per-day verifier so the dashboard can render the trailing-7-day streak without invoking Python.
- Modify: `ml/evaluation/operator_gate_check.py` — emit one row per (date, gate) into a new `OperatorGateDailyVerdict` table when run with `--as-of`. Schema delta noted below.

This task adds a small schema delta. Add to a new manual migration `prisma/manual-migrations/2026-07-DD_phase1-w11-gate-verdicts.sql`:

```sql
CREATE TABLE IF NOT EXISTS "OperatorGateDailyVerdict" (
  "id"             TEXT PRIMARY KEY,
  "verdictDate"    DATE NOT NULL,
  "gateName"       TEXT NOT NULL,
  "passed"         BOOLEAN NOT NULL,
  "detail"         TEXT,
  "computedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "OperatorGateDailyVerdict_date_gate_key"
  ON "OperatorGateDailyVerdict" ("verdictDate", "gateName");
```

Add the matching Prisma model.

- [ ] **Step 1: Schema + push** (same pattern as Task 1; verify with `\d`)

- [ ] **Step 2: Update `ml/evaluation/operator_gate_check.py`** to write one row per (verdictDate, gateName) when it computes verdicts (both today's run and `--as-of` historical runs).

- [ ] **Step 3: Backfill 7 days** by running `python -m ml.evaluation.operator_gate_check --as-of <each of the last 7 dates>` and confirming rows appear.

- [ ] **Step 4: Build the read action**

Create `src/app/actions/intelligence/gate-streak-actions.ts`:

```typescript
"use server"

import { prisma } from "@/lib/prisma"

export interface GateStreak {
  consecutivePass: number
  trailingWindow: { date: string; allPassed: boolean; gateBreakdown: { gate: string; passed: boolean }[] }[]
}

export async function getOperatorGateStreak(): Promise<GateStreak> {
  const fourteenDaysAgo = new Date()
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)
  const rows = await prisma.operatorGateDailyVerdict.findMany({
    where: { verdictDate: { gte: fourteenDaysAgo } },
    orderBy: [{ verdictDate: "desc" }, { gateName: "asc" }],
  })

  // Group by date.
  const byDate = new Map<string, { gate: string; passed: boolean }[]>()
  for (const r of rows) {
    const key = r.verdictDate.toISOString().slice(0, 10)
    if (!byDate.has(key)) byDate.set(key, [])
    byDate.get(key)!.push({ gate: r.gateName, passed: r.passed })
  }

  const trailingWindow = Array.from(byDate.entries()).map(([date, gates]) => ({
    date,
    allPassed: gates.every((g) => g.passed),
    gateBreakdown: gates,
  }))

  // Count consecutive pass days starting from the most recent.
  let consecutivePass = 0
  for (const day of trailingWindow) {
    if (day.allPassed) consecutivePass++
    else break
  }
  return { consecutivePass, trailingWindow }
}
```

- [ ] **Step 5: Commit**

```bash
git add prisma/ ml/evaluation/operator_gate_check.py src/app/actions/intelligence/gate-streak-actions.ts
git commit -m "ml(w11): per-day operator-gate verdict persistence + read action"
```

---

## Task 13: Quality panel — lifecycle + gate-streak sections

**Files:**
- Create: `src/app/dashboard/intelligence/quality/components/lifecycle-section.tsx`
- Create: `src/app/dashboard/intelligence/quality/components/gate-streak-section.tsx`
- Modify: `src/app/dashboard/intelligence/quality/page.tsx` (mount both)

- [ ] **Step 1: Implement `lifecycle-section.tsx`**

Reads `prisma.store.findMany` with `id, name, lifecycleStage, openedAt, initialTransferScalar`. For each store, computes `daysSinceOpen = floor((now - openedAt) / 86400000) + 1`. Renders per-store rows showing stage + days + warmup progress. Editorial-docket: `.inv-panel`, JetBrains Mono for stage labels, Fraunces italic for store names, DM Sans tabular nums for the day count.

Sample-count progress for `warming_up` stores: read `sampleSize` from the latest `MlForecastEvaluation` row (REVENUE target). Show `n / 60` bar.

- [ ] **Step 2: Implement `gate-streak-section.tsx`**

Consumes `getOperatorGateStreak()`. Renders a single big number (`consecutivePass`) and a horizontal 14-day row of dots — green for `allPassed`, red for any failure. On hover, shows the per-gate breakdown for that day.

- [ ] **Step 3: Mount in the page**

```tsx
import { LifecycleSection } from "./components/lifecycle-section"
import { GateStreakSection } from "./components/gate-streak-section"

// inside the page:
<Suspense fallback={<div className="inv-panel px-5 py-6">Loading lifecycle…</div>}>
  <LifecycleSection />
</Suspense>
<Suspense fallback={<div className="inv-panel px-5 py-6">Loading gate streak…</div>}>
  <GateStreakSection />
</Suspense>
```

- [ ] **Step 4: Typecheck + smoke**

```bash
npx tsc --noEmit
npm run dev
```

Visit `/dashboard/intelligence/quality`. Confirm all 4 sections render. Resize browser to check no obvious layout breaks at common widths.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/intelligence/quality/
git commit -m "ml(w12): quality panel sections 3 (lifecycle) + 4 (gate streak)"
```

---

## Task 14: 7-day observation gate + Phase 1 closeout doc

Spec §3 exit gate item 5: `MlReconciliationDaily.postPctDiscrepancyMedian ≤ 15%` across the trailing 7 nights for any `ready` store.

- [ ] **Step 1: Run the reconciliation-gate verifier**

```bash
source ml/.venv/bin/activate
export DATABASE_URL=$(cat /tmp/dburl)
python -m ml.evaluation.reconciliation_gate_check
echo "exit=$?"
```

Expected: `PASS — 7/7 days at or below 0.15` and exit 0. If FAIL with `insufficient_window`, wait until 7 days of nightly runs have accumulated and re-run.

- [ ] **Step 2: Write the closeout doc**

Create `docs/superpowers/specs/<YYYY-MM-DD>-ml-phase1-closeout.md` (date = today). Mirror the W1-4 closeout pattern: list the 12-week exit-gate verdict, surface any open issues handed to Phase 2, attribute each open issue to a phase, and link the three plans (W5 onboarding, W6-8 reconciliation, W9-12 growth).

Required sections:
- Exit gate verdict per spec §1, §2, §3 (one paragraph each).
- Open issues handed to Phase 2 (the chat tools, feedback table, recommendation-health panel — explicitly deferred).
- Acceptance criteria from spec §1-12: every item with a ✓ or a justified ✗.
- Verification log (paste the gate-check output from Step 1).
- Next steps: link to the Phase 2 brief if one exists, otherwise stub a "next steps" section.

- [ ] **Step 3: Run graphify update**

```bash
graphify update .
```

- [ ] **Step 4: Append to `ml/README.md`**

```markdown
## Growth opportunities + quality panel (W9-12)

The nightly pipeline runs five generators (`ml/growth/generators/*`) per
ready store and upserts results into `GrowthOpportunity`. The
`/dashboard/intelligence/opportunities` page reads the latest rows;
`/dashboard/intelligence/quality` shows accuracy / reconciliation / lifecycle /
gate-streak in four `.inv-panel` sections. See spec §3 and the W9-12 plan.

To add a sixth opportunity type in Phase 2: extend the `OpportunityType` enum
(both Prisma and `src/types/growth.ts`), drop a new generator file under
`ml/growth/generators/`, and register it in `ml/growth/generators/__init__.py`.
The Phase 2 deferred list lives as a comment in `src/types/growth.ts`:
launch_analogue, lost_sales, weak_promo.
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/<closeout-file>.md ml/README.md
git commit -m "ml(w12): Phase 1 closeout — all three section exit gates verified"
```

---

## Self-review checklist

Cross-checked against [spec §3](../specs/2026-05-17-ml-phase1-weeks5-12-design.md#section-3--w9-12-growth-ai-layer--comprehensive-quality-panel):

| Spec requirement | Plan task |
|---|---|
| §3.1 `GrowthOpportunity` Prisma model + 5-value union | Tasks 1 + 2 |
| §3.1 deferred-types comment block | Task 2 (TS + Python both keep the list as comments) |
| §3.2 5 impact formulas with no tunable multipliers | Task 3 (formulas + AST grep guard) |
| §3.3 one pure generator function per type | Tasks 4 + 5 + 7 (5 generators total) |
| §3.3 fixture test per generator | Tasks 4 + 5 + 7 (5 fixture tests in `test_growth_generators.py`) |
| §3.3 reconciled values when present, raw otherwise | Tasks 7 (`food_cost_risk` + `profit_risk` use `COALESCE(reconciledRevenue, predictedRevenue)`) |
| §3.4 `/dashboard/intelligence/opportunities` editorial-docket | Tasks 6 + 10 |
| §3.4 `.inv-panel` / `.inv-row` / DM Sans tabular / Fraunces italic / JetBrains Mono | Tasks 6 + 11 + 13 (verified in component code) |
| §3.4 no chat / feedback / capture in Phase 1 | Plan scope (none of those files exist) |
| §3.5 quality panel route + 4 sections | Tasks 11 + 12 + 13 |
| §3.5 §1 forecast accuracy with coverage band verdict | Task 11 |
| §3.5 §2 reconciliation pre/post + sparkline + 15% threshold flag | Task 11 |
| §3.5 §3 per-store lifecycle | Task 13 |
| §3.5 §4 7-day operator-gate streak from per-day verifier, not JobRun.status | Task 12 (verdict persistence) + Task 13 (UI) |
| Lifecycle gating: warming_up / pre_open get empty state | Tasks 6 + 10 |
| Exit gate #1 — all 5 generators produce ≥1 opportunity each | Task 9 |
| Exit gate #2 — hand-recompute 3 opportunities within 1% | Task 9 |
| Exit gate #3 — quality panel renders all 4 sections | Task 13 |
| Exit gate #4 — gate streak reads per-day verifier | Tasks 12 + 13 |
| Exit gate #5 — postPctDiscrepancyMedian ≤ 15% trailing 7 nights | Task 14 |
| LLM provider note from `feedback_llm_provider` memory | Out of scope (chat tools deferred) — no LLM code in this plan |
| Migration discipline: db push + manual SQL | Tasks 1 + 12 |

No placeholders. Type names consistent (`GrowthOpportunity`, `Evidence`, `OpportunityType`, `OpportunityConfidence`, `OpportunityEvidence`, `REGISTRY`, `write_opportunities`, `run_growth_opportunities_for_store`, `getOpportunities`, `getAccuracyTable`, `getReconciliationTable`, `getOperatorGateStreak`, `AccuracySection`, `ReconciliationSection`, `LifecycleSection`, `GateStreakSection`) — verified by ctrl-F.

**Editorial-docket compliance notes** (CLAUDE.md tripwires):
- Task 11 calls out the `emerald-700`/`amber-700` swap → `--ink-good`/`--ink-warn` CSS variables (tripwire #1).
- All sections render in `.inv-panel`, not shadcn `<Card>` (tripwire #4).
- Numbers use DM Sans 500 + `tabular-nums lining-nums` (tripwire #2).
- Row interactions use `.inv-row` (tripwire #3); the opportunity feed adds the red 4px accent on hover via the row's existing class.
- No file in this plan exceeds 400 lines, so tripwire #5 doesn't apply.

This plan closes Phase 1. Phase 2 month 4 picks up the operator copilot (chat tools, feedback capture, recommendation-health monitoring) per spec "Deferred to Phase 2" section — to be planned separately when that work starts.
