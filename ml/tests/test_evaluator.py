from datetime import date, timedelta
import numpy as np
import pandas as pd
import pytest

from ml.evaluation.evaluator import build_evaluation_row, EvaluationInput


def _make_input():
    actuals = np.array([100.0, 200.0, 300.0, 250.0, 180.0, 220.0, 270.0])
    preds   = np.array([110.0, 180.0, 330.0, 240.0, 200.0, 230.0, 260.0])
    p10     = preds - 30.0
    p90     = preds + 30.0
    p2_5    = preds - 60.0
    p97_5   = preds + 60.0
    baseline_preds = np.array([105.0, 195.0, 295.0, 245.0, 195.0, 215.0, 265.0])
    return EvaluationInput(
        target="REVENUE",
        store_id="s1",
        model_version="rev-2026-05-12",
        horizon_day=0,
        window_start=date(2026, 4, 1),
        window_end=date(2026, 4, 7),
        actuals=actuals,
        predictions=preds,
        lower80=p10,
        upper80=p90,
        lower95=p2_5,
        upper95=p97_5,
        baseline_predictions=baseline_preds,
        enriched_predictions=None,
        stale_row_count=0,
    )


def test_build_evaluation_row_populates_all_metrics():
    inp = _make_input()
    row = build_evaluation_row(inp)

    assert row["target"] == "REVENUE"
    assert row["storeId"] == "s1"
    assert row["sampleSize"] == 7
    assert row["wape"] is not None
    assert row["mape"] is not None
    assert row["mae"]  is not None
    assert row["bias"] is not None
    assert 0.0 <= row["intervalCoverage80"] <= 1.0
    assert 0.0 <= row["intervalCoverage95"] <= 1.0
    assert row["baselineWape"] is not None
    assert row["enrichedWape"] is None
    assert row["staleRowCount"] == 0


def test_build_evaluation_row_handles_zero_sample():
    inp = EvaluationInput(
        target="REVENUE",
        store_id="s1",
        model_version="rev-2026-05-12",
        horizon_day=0,
        window_start=date(2026, 4, 1),
        window_end=date(2026, 4, 7),
        actuals=np.array([]),
        predictions=np.array([]),
        lower80=np.array([]),
        upper80=np.array([]),
        lower95=np.array([]),
        upper95=np.array([]),
        baseline_predictions=np.array([]),
        enriched_predictions=None,
        stale_row_count=7,
    )
    row = build_evaluation_row(inp)
    assert row["sampleSize"] == 0
    assert row["wape"] is None
    assert row["staleRowCount"] == 7
