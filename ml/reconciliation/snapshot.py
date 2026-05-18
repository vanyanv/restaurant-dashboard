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
    per-item discrepancy ratios (signed); we take the absolute-value percentile."""
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
