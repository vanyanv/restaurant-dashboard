"""The deployed estimator is refit on all history before it forecasts.

`_conformal_split` is a chronological 80/10/10, and `wrap_xgboost_conformal`
fits `base` on the train slice alone so the calibration slice stays disjoint and
conformal keeps its coverage guarantee. But `forecast()` then took its *point*
prediction from that same train-only estimator, which on Hollywood meant
predicting from a model that had never seen the last 91 days — a window whose
mean ran 7.3% above what it trained on.

This was measured twice, and the first measurement was wrong. A 1-step probe
with a model fit on a different pool said refitting made bias slightly worse, so
it was dropped. Re-running it through the *actual* train+forecast pipeline, with
recursion, over 10 chronological cutoffs and 14-day horizons (n=140):

    train-slice only     bias -5.4%   MAPE 10.4%
    refit on all history bias -1.9%   MAPE  9.4%

Per-cutoff bias improved in 7 of 10. The lesson is that a level error compounds
through recursive multi-step forecasting in a way a 1-step probe cannot see.

Order matters: `mape` picks baseline vs enriched in `_select_result`, so it is
computed on the untouched holdout *before* the refit. Only the estimator that
ships is refit. The conformal half-widths still come from the train-slice
model's residuals on the calibration slice, so they end up mildly conservative
around a better point estimate — the safe direction, given measured coverage at
one day out was 71% against an 80% target.
"""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd
import pytest

from ml.models import revenue as revenue_model
from ml.features.revenue import build_features, feature_columns


def _stepped_history(days: int = 420, seed: int = 5, late_lift: float = 1.30) -> pd.DataFrame:
    """Level shift in the final quarter — the shape a train-slice-only model
    cannot represent, because the shift lands entirely in calib+holdout."""
    rng = np.random.default_rng(seed)
    dates = pd.date_range(end=pd.Timestamp(dt.date(2026, 8, 18)), periods=days, freq="D")
    weekday_lift = np.where(dates.weekday.to_numpy() >= 5, 1.2, 1.0)
    level = np.ones(days)
    # 0.88 so the shift lands entirely inside calib+holdout: _conformal_split
    # drops NaN lag rows first, which pulls the 80% boundary earlier than it
    # looks here. At 0.80 the train slice caught part of the shift and the
    # test passed without any refit at all.
    level[int(days * 0.88):] = late_lift
    revenue = 5000.0 * weekday_lift * level + rng.normal(0, 100.0, size=days)
    return pd.DataFrame({"date": dates, "revenue": revenue.clip(min=100.0)})


@pytest.fixture
def stepped(monkeypatch):
    history = _stepped_history()
    monkeypatch.setattr(
        revenue_model, "load_daily_revenue",
        lambda store_id, lookback_days=540: history.copy(),
    )
    return history


def test_the_shipped_estimator_has_seen_the_whole_series(stepped):
    """The regression: predict the most recent rows, which live entirely in the
    calib+holdout tail the train slice never covers."""
    result = revenue_model.train("store-test", enriched=False)
    assert result is not None

    cols = feature_columns()
    clean = build_features(stepped).dropna(subset=cols)
    recent = clean.iloc[-30:]

    pred = result.model.predict(recent[cols])
    actual = recent["revenue"].to_numpy()
    bias = float(np.mean((pred - actual) / actual))

    # A train-slice-only fit sits ~20% low here, having learned the pre-shift
    # level. Anything near that means the refit did not happen.
    assert bias > -0.08, f"shipped model reads {bias:.1%} against recent actuals"


def test_selection_metric_is_still_out_of_sample(stepped):
    """`mape` chooses baseline vs enriched, so it must be scored on the holdout
    by the pre-refit model. A metric taken after the refit would be graded on
    rows the estimator had just been fit on, and would pick the wrong flavor."""
    result = revenue_model.train("store-test", enriched=False)
    assert result is not None
    assert result.mape > 0.005, (
        f"mape {result.mape:.4f} is implausibly low — it looks like an in-sample score"
    )


def test_conformal_point_and_shipped_model_agree(stepped):
    """`forecast()` reads its point from the conformal wrapper, so the wrapper
    must be pointing at the refit estimator, not a stale copy."""
    result = revenue_model.train("store-test", enriched=False)
    assert result.conformal is not None
    assert result.conformal.point_model is result.model

    cols = feature_columns()
    row = build_features(stepped).dropna(subset=cols).iloc[[-1]][cols]
    x = row.to_numpy(dtype=float, na_value=np.nan)
    point, lo80, hi80, _, _ = result.conformal.predict_intervals(x)
    assert point[0] == pytest.approx(float(result.model.predict(x)[0]), rel=1e-6)
    assert lo80[0] < point[0] < hi80[0]


def test_forecast_intervals_still_bracket_the_point(stepped):
    result = revenue_model.train("store-test", enriched=False)
    for r in revenue_model.forecast("store-test", result, horizon_days=7):
        assert r.p10 <= r.predicted_revenue <= r.p90
        assert r.p10 < r.p90


def test_fallback_path_is_untouched(monkeypatch):
    """Too little history for a calibration slice means no conformal wrapper and
    no refit — that path already fits on train+calib combined."""
    history = _stepped_history(days=95)
    monkeypatch.setattr(
        revenue_model, "load_daily_revenue",
        lambda store_id, lookback_days=540: history.copy(),
    )
    result = revenue_model.train("store-test", enriched=False)
    if result is not None and result.uses_fallback_interval:
        assert result.conformal is None
        assert "fallback" in result.flavor
