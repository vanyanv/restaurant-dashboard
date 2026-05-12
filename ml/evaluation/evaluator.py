"""Orchestrator: builds MlForecastEvaluation rows.

Pure for `build_evaluation_row` (testable without DB). The
`upsert_evaluation_row` function persists results via psycopg2.
"""

from __future__ import annotations
from dataclasses import dataclass
from datetime import date
from typing import Optional
import numpy as np

from ml.db import cuid_like
from ml.evaluation import metrics


@dataclass
class EvaluationInput:
    target: str                  # MlTarget enum value: "REVENUE" | "BUSY_HOURS" | "MENU_ITEM"
    store_id: str
    model_version: str
    horizon_day: int
    window_start: date
    window_end: date
    actuals: np.ndarray
    predictions: np.ndarray
    lower80: np.ndarray
    upper80: np.ndarray
    lower95: np.ndarray
    upper95: np.ndarray
    baseline_predictions: np.ndarray
    enriched_predictions: Optional[np.ndarray]
    stale_row_count: int


def build_evaluation_row(inp: EvaluationInput) -> dict:
    """Compute every column for one MlForecastEvaluation row.

    Returns a dict keyed by Prisma column names (camelCase) ready for INSERT.
    """
    sample_size = int(inp.actuals.size)
    baseline_wape = metrics.wape(inp.actuals, inp.baseline_predictions)
    enriched_wape = (
        metrics.wape(inp.actuals, inp.enriched_predictions)
        if inp.enriched_predictions is not None and inp.enriched_predictions.size
        else None
    )
    return {
        "target": inp.target,
        "storeId": inp.store_id,
        "modelVersion": inp.model_version,
        "horizonDay": inp.horizon_day,
        "windowStart": inp.window_start,
        "windowEnd": inp.window_end,
        "wape": metrics.wape(inp.actuals, inp.predictions),
        "mape": metrics.mape(inp.actuals, inp.predictions),
        "mae":  metrics.mae(inp.actuals, inp.predictions),
        "bias": metrics.bias(inp.actuals, inp.predictions),
        "intervalCoverage80": metrics.interval_coverage(
            inp.actuals, inp.lower80, inp.upper80
        ),
        "intervalCoverage95": metrics.interval_coverage(
            inp.actuals, inp.lower95, inp.upper95
        ),
        "baselineWape": baseline_wape,
        "enrichedWape": enriched_wape,
        "staleRowCount": inp.stale_row_count,
        "sampleSize": sample_size,
    }


_UPSERT_SQL = """
INSERT INTO "MlForecastEvaluation" (
    id,
    target,
    "storeId",
    "modelVersion",
    "horizonDay",
    "windowStart",
    "windowEnd",
    wape,
    mape,
    mae,
    bias,
    "intervalCoverage80",
    "intervalCoverage95",
    "baselineWape",
    "enrichedWape",
    "staleRowCount",
    "sampleSize",
    "computedAt"
) VALUES (
    %(id)s,
    %(target)s::"MlTarget",
    %(storeId)s,
    %(modelVersion)s,
    %(horizonDay)s,
    %(windowStart)s,
    %(windowEnd)s,
    %(wape)s,
    %(mape)s,
    %(mae)s,
    %(bias)s,
    %(intervalCoverage80)s,
    %(intervalCoverage95)s,
    %(baselineWape)s,
    %(enrichedWape)s,
    %(staleRowCount)s,
    %(sampleSize)s,
    NOW()
)
ON CONFLICT (target, "storeId", "modelVersion", "horizonDay", "windowStart", "windowEnd")
DO UPDATE SET
    wape = EXCLUDED.wape,
    mape = EXCLUDED.mape,
    mae = EXCLUDED.mae,
    bias = EXCLUDED.bias,
    "intervalCoverage80" = EXCLUDED."intervalCoverage80",
    "intervalCoverage95" = EXCLUDED."intervalCoverage95",
    "baselineWape" = EXCLUDED."baselineWape",
    "enrichedWape" = EXCLUDED."enrichedWape",
    "staleRowCount" = EXCLUDED."staleRowCount",
    "sampleSize" = EXCLUDED."sampleSize",
    "computedAt" = NOW()
"""


def upsert_evaluation_row(conn, row: dict) -> None:
    """INSERT ... ON CONFLICT DO UPDATE the row into MlForecastEvaluation.

    Uses the same `cuid_like()` ID-generation pattern as the rest of the
    nightly pipeline (see ml/db.py). The unique key for ON CONFLICT is
    (target, storeId, modelVersion, horizonDay, windowStart, windowEnd).

    The `target` value must be a valid MlTarget enum string (REVENUE /
    BUSY_HOURS / MENU_ITEM). Postgres will reject anything else.
    """
    params = dict(row)
    params["id"] = cuid_like()
    with conn.cursor() as cur:
        cur.execute(_UPSERT_SQL, params)
