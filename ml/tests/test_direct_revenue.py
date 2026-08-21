"""F12 + F13 — direct multi-horizon forecasting, global-capable.

`forecast()` predicts day 1, writes that prediction back as if it were
observed, and uses it as `lag_1` for day 2. Error compounds multiplicatively
across fourteen steps, which is precisely why the module needs
HORIZON_WIDENING_PER_DAY, then needed measured per-horizon widths to correct
that constant, then needed a calibration epoch to keep the measurement honest,
then needed F16 to make the horizon key line up at all. Four layers of
machinery servicing one structural choice.

Direct multi-horizon removes the choice. One model trained on
(features known at anchor a, target at a + h) pairs for h in 1..H, with the
horizon itself as a feature. No feedback loop, so nothing compounds, and each
horizon has its own residual distribution — which makes conformal calibration
exact per horizon instead of a one-step width stretched by a constant.

The global part (F13) is structural rather than immediately useful: Hollywood
is the only `ready` store, so there is nothing to pool yet. The training path
takes many stores and treats `store` as a categorical so that GLN and VNYS
join it by opening rather than by a rewrite.
"""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd
import pytest

from ml.features.revenue import build_features, feature_columns
from ml.models.direct_revenue import (
    HORIZON_COLUMN,
    STORE_COLUMN,
    TARGET_COLUMN,
    build_direct_frame,
    direct_feature_columns,
    forecast_direct,
    train_direct,
)


def _series(days: int = 420, seed: int = 3, base: float = 5000.0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    dates = pd.date_range(end=pd.Timestamp("2026-08-20"), periods=days, freq="D")
    lift = np.where(dates.weekday.to_numpy() >= 5, 1.3, 1.0)
    revenue = (base * lift + rng.normal(0.0, 200.0, size=days)).clip(min=100.0)
    return pd.DataFrame({"date": dates, "revenue": revenue})


# --- the training frame, and the leak it must not have ------------------------

def test_the_frame_stacks_one_block_per_horizon():
    feats = build_features(_series(days=200))
    frame = build_direct_frame(feats, horizons=range(1, 5))
    assert set(frame[HORIZON_COLUMN].unique()) == {1, 2, 3, 4}


def test_horizon_one_targets_the_row_its_features_describe():
    # target_mode="level" so the assertion is about which row the target is
    # taken from, not about the ratio scaling applied afterwards.
    feats = build_features(_series(days=200))
    frame = build_direct_frame(feats, horizons=[1], target_mode="level")
    merged = frame.merge(feats[["date", "revenue"]], on="date", suffixes=("", "_orig"))
    assert np.allclose(merged[TARGET_COLUMN], merged["revenue_orig"])


def test_horizon_h_targets_h_minus_one_days_later():
    feats = build_features(_series(days=200))
    frame = build_direct_frame(feats, horizons=[3], target_mode="level")
    row = frame.iloc[0]
    anchor_pos = feats.index[feats["date"] == row["date"]][0]
    assert row[TARGET_COLUMN] == pytest.approx(feats.loc[anchor_pos + 2, "revenue"])


def test_features_are_identical_across_horizons_for_the_same_anchor():
    """The only thing that may differ between horizon blocks is the horizon.

    If a feature moved with h, the model would be reading the future — that is
    the exact failure recursion hides by feeding predictions back in.
    """
    feats = build_features(_series(days=200))
    frame = build_direct_frame(feats, horizons=[1, 7, 14])
    cols = feature_columns()

    anchor = frame["date"].iloc[50]
    rows = frame[frame["date"] == anchor]
    assert len(rows) == 3
    for col in cols:
        assert rows[col].nunique(dropna=False) == 1, f"{col} varies with horizon"


def test_no_row_survives_without_an_observed_target():
    feats = build_features(_series(days=120))
    frame = build_direct_frame(feats, horizons=[1, 14])
    assert not frame[TARGET_COLUMN].isna().any()


def test_the_horizon_is_a_model_feature():
    assert HORIZON_COLUMN in direct_feature_columns()


# --- training and forecasting -------------------------------------------------

def test_training_produces_one_model_for_every_horizon():
    result = train_direct({"hollywood": _series()}, horizons=range(1, 15))
    assert result is not None
    assert result.horizons == tuple(range(1, 15))


def test_forecast_returns_one_row_per_horizon_with_its_horizon_recorded():
    hist = _series()
    result = train_direct({"hollywood": hist}, horizons=range(1, 15))
    rows = forecast_direct(result, "hollywood", hist, horizon_days=14)

    assert [r.horizon for r in rows] == list(range(1, 15))
    last_observed = hist["date"].max().date()
    for r in rows:
        assert (r.forecast_date - last_observed).days == r.horizon


def test_forecasting_never_feeds_a_prediction_back_in():
    """The structural claim, stated as a test.

    Truncating the horizon must not change the earlier predictions. Under
    recursion it cannot change them either — but under recursion the day-14
    value is a function of thirteen predictions, whereas here each horizon is
    produced independently from observed data alone. Predicting only h=14
    directly must give the same answer as predicting 1..14 and taking the last.
    """
    hist = _series()
    result = train_direct({"hollywood": hist}, horizons=range(1, 15))

    full = forecast_direct(result, "hollywood", hist, horizon_days=14)
    only_14 = forecast_direct(result, "hollywood", hist, horizons=[14])

    assert only_14[0].predicted_revenue == pytest.approx(full[-1].predicted_revenue)


def test_every_horizon_gets_a_usable_interval():
    hist = _series()
    result = train_direct({"hollywood": hist}, horizons=range(1, 15))
    rows = forecast_direct(result, "hollywood", hist, horizon_days=14)

    for r in rows:
        assert r.p10 <= r.predicted_revenue <= r.p90
        assert r.p90 > r.p10


def test_interval_width_is_measured_per_horizon_not_derived_from_the_first():
    """`_series` is level + weekday + iid noise, so the honest answer is that
    width barely grows with horizon — the day-14 forecast is genuinely almost
    as good as the day-1 one. A model that widens by formula cannot express
    that; one calibrated on each horizon's own residuals can."""
    hist = _series()
    result = train_direct({"hollywood": hist}, horizons=range(1, 15))

    ratios = sorted(result.half_widths[h] / result.half_widths[1] for h in range(1, 15))
    # Not a constant, and not a fixed per-step multiple either.
    assert len({round(x, 6) for x in ratios}) > 2, "widths look like a formula, not a measurement"
    assert max(ratios) < 3.0, "iid noise should not produce a 3x spread across horizons"


def test_width_grows_with_horizon_when_the_series_actually_diffuses():
    """A persistent AR(1) has genuinely growing uncertainty: the h-step
    variance is sigma^2 * (1 - phi^2h) / (1 - phi^2), so at phi=0.9 the
    14-step error is about 2.2x the 1-step one. The measured widths must pick
    that up without anyone telling them to.

    Deliberately mean-reverting rather than a random walk. A walk's level
    drifts outside the training range, and a tree cannot extrapolate — the
    error there is dominated by that, not by horizon, at every h alike. That
    is a real limitation of this model class and not something an interval
    calibration can paper over.
    """
    rng = np.random.default_rng(17)
    n = 900
    dates = pd.date_range(end=pd.Timestamp("2026-08-20"), periods=n, freq="D")
    mu, phi, sigma = 5000.0, 0.9, 250.0
    y = np.empty(n)
    y[0] = mu
    for t in range(1, n):
        y[t] = mu + phi * (y[t - 1] - mu) + rng.normal(0.0, sigma)
    hist = pd.DataFrame({"date": dates, "revenue": np.clip(y, 500.0, None)})

    result = train_direct({"hollywood": hist}, horizons=range(1, 15))
    assert result is not None
    assert result.half_widths[14] > result.half_widths[1] * 1.5, result.half_widths


def test_short_history_returns_none_rather_than_a_bad_model():
    assert train_direct({"hollywood": _series(days=40)}, horizons=[1]) is None


# --- F13: global capability ---------------------------------------------------

def test_two_stores_train_one_model_with_store_as_a_feature():
    result = train_direct(
        {"hollywood": _series(seed=1, base=5000.0), "glendale": _series(seed=2, base=3000.0)},
        horizons=range(1, 8),
    )
    assert result is not None
    assert STORE_COLUMN in result.feature_names
    assert set(result.stores) == {"hollywood", "glendale"}


def test_a_pooled_model_gives_each_store_its_own_level():
    """Pooling must not average the stores together — that would be worse than
    per-store models, not better."""
    hw, gl = _series(seed=1, base=6000.0), _series(seed=2, base=2500.0)
    result = train_direct({"hollywood": hw, "glendale": gl}, horizons=range(1, 8))

    hw_pred = forecast_direct(result, "hollywood", hw, horizon_days=7)[0].predicted_revenue
    gl_pred = forecast_direct(result, "glendale", gl, horizon_days=7)[0].predicted_revenue

    assert hw_pred > gl_pred * 1.5, f"levels collapsed: {hw_pred} vs {gl_pred}"


def test_forecasting_an_unknown_store_is_refused():
    result = train_direct({"hollywood": _series()}, horizons=[1])
    with pytest.raises(ValueError, match="not in the training set"):
        forecast_direct(result, "vannuys", _series(), horizon_days=1)


# --- the deployment refit -----------------------------------------------------

def test_the_shipped_model_has_seen_the_most_recent_history():
    """First production backtest: direct lost at 14 of 14 horizons with
    bias -13.7% at h1 — a uniform under-prediction, not a horizon problem.

    Cause: the model was fit on the first 85% and shipped, so on a store whose
    level is rising it had never seen the newest data. `ml/models/revenue.py`
    already documents this exact failure and refits on all history after
    scoring. This model must do the same: score honestly on a slice it did not
    see, then refit before shipping.
    """
    hist = _series()
    result = train_direct({"hollywood": hist}, horizons=range(1, 15))
    assert result is not None
    assert result.deploy_sample_size > result.sample_size, (
        "the shipped estimator was never refit on the calibration slice"
    )


def test_the_reported_score_stays_out_of_sample():
    """The refit must not be allowed to launder the score. `wape` has to remain
    the pre-refit number, measured on rows the scored model never saw."""
    hist = _series()
    result = train_direct({"hollywood": hist}, horizons=range(1, 15))
    assert result is not None
    from ml.evaluation import metrics
    assert result.wape == pytest.approx(
        metrics.wape(result.holdout_y_true, result.holdout_y_pred)
    )


def test_a_rising_series_is_not_systematically_under_predicted():
    """The property the refit exists to protect."""
    rng = np.random.default_rng(23)
    n = 500
    dates = pd.date_range(end=pd.Timestamp("2026-08-20"), periods=n, freq="D")
    trend = np.linspace(4000.0, 7000.0, n)
    lift = np.where(dates.weekday.to_numpy() >= 5, 1.25, 1.0)
    hist = pd.DataFrame({
        "date": dates,
        "revenue": (trend * lift + rng.normal(0.0, 150.0, size=n)).clip(min=100.0),
    })

    result = train_direct({"hollywood": hist}, horizons=range(1, 8))
    rows = forecast_direct(result, "hollywood", hist, horizon_days=7)
    recent = float(hist["revenue"].tail(28).mean())

    # Predictions should sit near the recent level, not far below it.
    for r in rows:
        assert r.predicted_revenue > recent * 0.80, (
            f"h{r.horizon} predicted {r.predicted_revenue:.0f} against a recent mean of {recent:.0f}"
        )


# --- ratio targets, because trees cannot extrapolate a level -------------------

def _rising(n: int = 500, seed: int = 31, start: float = 4000.0, end: float = 8000.0):
    rng = np.random.default_rng(seed)
    dates = pd.date_range(end=pd.Timestamp("2026-08-20"), periods=n, freq="D")
    trend = np.linspace(start, end, n)
    lift = np.where(dates.weekday.to_numpy() >= 5, 1.25, 1.0)
    return pd.DataFrame({
        "date": dates,
        "revenue": (trend * lift + rng.normal(0.0, 150.0, size=n)).clip(min=100.0),
    })


def test_a_level_target_under_predicts_a_rising_series():
    """The failure, pinned. A tree predicts within the range of targets it saw,
    so at the top of a rising series every leaf averages downward.

    Measured on Hollywood: direct with a level target ran bias -9.86% at h1
    even after the deployment refit.
    """
    hist = _rising()
    result = train_direct({"hollywood": hist}, horizons=range(1, 15), target_mode="level")
    rows = forecast_direct(result, "hollywood", hist, horizon_days=14)
    recent = float(hist["revenue"].tail(14).mean())
    predicted = float(np.mean([r.predicted_revenue for r in rows]))
    assert predicted < recent, "expected the documented under-prediction"


def test_a_ratio_target_tracks_a_rising_series():
    """Dividing the target by a trailing mean known at the anchor makes the
    learning problem stationary — the tree predicts a multiplier in a range it
    has seen, and the level is restored by multiplying back."""
    hist = _rising()
    result = train_direct({"hollywood": hist}, horizons=range(1, 15), target_mode="ratio")
    rows = forecast_direct(result, "hollywood", hist, horizon_days=14)
    recent = float(hist["revenue"].tail(14).mean())
    predicted = float(np.mean([r.predicted_revenue for r in rows]))
    assert 0.9 * recent < predicted < 1.25 * recent, (
        f"predicted {predicted:.0f} against a recent mean of {recent:.0f}"
    )


def test_ratio_is_the_default():
    result = train_direct({"hollywood": _series()}, horizons=[1])
    assert result.target_mode == "ratio"


def test_ratio_mode_still_reports_scores_in_dollars():
    """A WAPE on multipliers is not comparable to anything else in the repo."""
    hist = _rising()
    result = train_direct({"hollywood": hist}, horizons=range(1, 8), target_mode="ratio")
    assert result.holdout_y_true.mean() > 1000.0, "scores were left in ratio space"
    assert 0.0 < result.wape < 1.0
