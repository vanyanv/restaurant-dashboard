"""F14 — asymmetric, conditional intervals via conformalized quantile regression.

Every interval in this pipeline is `pred ± halfwidth`, and worse, one width for
every day in the horizon. Revenue can spike 80% on an event Saturday and cannot
fall below zero, so a symmetric band is the wrong shape; and a sleepy Tuesday
and a festival Saturday are quoted the same uncertainty, so it is the wrong
width on most individual days even when it is right on average.

The production backtest shows exactly that signature: 87.5% mean coverage
against an 80% target, but horizon 3 at 58.3% and horizons 5, 12, 13 and 14 at
100%. A band that is right on average and wrong on every particular day is not
useful to someone ordering stock.

CQR (Romano, Patterson & Candès, 2019) fits the 10th and 90th conditional
quantiles directly, then conformalises *those*:

    E_i = max(q_lo(x_i) - y_i,  y_i - q_hi(x_i))       on a calibration set
    Q   = the ceil((n+1)(1-alpha))/n empirical quantile of E
    band(x) = [q_lo(x) - Q,  q_hi(x) + Q]

Width becomes a function of x, the band is free to be asymmetric, and the
finite-sample marginal coverage guarantee survives even when the quantile
models themselves are badly calibrated.
"""
from __future__ import annotations

import numpy as np
import pytest

from ml.evaluation.cqr import CQRWrapper, conformity_scores, fit_cqr


ALPHA = 0.2  # 80% interval, matching p10/p90


def _heteroscedastic(n: int = 3000, seed: int = 5):
    """Noise that grows with the first feature — the thing a single width
    cannot represent."""
    rng = np.random.default_rng(seed)
    x = rng.uniform(0.0, 1.0, size=(n, 2))
    scale = 0.2 + 4.0 * x[:, 0]
    y = 10.0 * x[:, 0] + rng.normal(0.0, scale)
    return x, y


def _split(x, y, a=0.6, b=0.8):
    n = len(y)
    i, j = int(n * a), int(n * b)
    return (x[:i], y[:i]), (x[i:j], y[i:j]), (x[j:], y[j:])


# --- the conformity score ------------------------------------------------------

def test_conformity_is_zero_inside_the_band_and_positive_outside():
    lo = np.array([0.0, 0.0, 0.0])
    hi = np.array([10.0, 10.0, 10.0])
    y = np.array([5.0, -3.0, 14.0])
    e = conformity_scores(lo, hi, y)
    assert e[0] < 0            # comfortably inside
    assert e[1] == pytest.approx(3.0)   # 3 below the floor
    assert e[2] == pytest.approx(4.0)   # 4 above the ceiling


def test_conformity_takes_the_worse_of_the_two_sides():
    e = conformity_scores(np.array([2.0]), np.array([4.0]), np.array([9.0]))
    assert e[0] == pytest.approx(5.0)


# --- the guarantee -------------------------------------------------------------

def test_coverage_lands_near_the_target_on_unseen_data():
    x, y = _heteroscedastic()
    (xt, yt), (xc, yc), (xe, ye) = _split(x, y)
    model = fit_cqr(xt, yt, xc, yc, alpha=ALPHA)

    lo, hi = model.predict_interval(xe)
    covered = float(np.mean((ye >= lo) & (ye <= hi)))
    assert 0.75 <= covered <= 0.90, covered


def test_the_offset_repairs_quantile_models_that_under_cover():
    """The whole point of conformalising. Even a deliberately crippled pair of
    quantile models must end up covering, because the offset is measured."""
    x, y = _heteroscedastic()
    (xt, yt), (xc, yc), (xe, ye) = _split(x, y)

    # n_estimators=1, depth=1: barely a model at all.
    model = fit_cqr(xt, yt, xc, yc, alpha=ALPHA, n_estimators=1, max_depth=1)

    raw_lo, raw_hi = model.raw_quantiles(xe)
    raw_cov = float(np.mean((ye >= raw_lo) & (ye <= raw_hi)))

    lo, hi = model.predict_interval(xe)
    cov = float(np.mean((ye >= lo) & (ye <= hi)))

    assert cov > raw_cov
    assert cov >= 0.70, cov


def test_the_lower_bound_never_crosses_the_upper():
    x, y = _heteroscedastic()
    (xt, yt), (xc, yc), (xe, ye) = _split(x, y)
    model = fit_cqr(xt, yt, xc, yc, alpha=ALPHA)
    lo, hi = model.predict_interval(xe)
    assert np.all(lo <= hi)


# --- the property a symmetric width cannot have --------------------------------

def test_the_band_is_wider_where_the_data_is_noisier():
    """A single conformal half-width quotes the quiet Tuesday and the noisy
    Saturday identically. This must not."""
    x, y = _heteroscedastic()
    (xt, yt), (xc, yc), (xe, ye) = _split(x, y)
    model = fit_cqr(xt, yt, xc, yc, alpha=ALPHA)

    lo, hi = model.predict_interval(xe)
    width = hi - lo
    quiet = width[xe[:, 0] < 0.2].mean()
    noisy = width[xe[:, 0] > 0.8].mean()
    assert noisy > quiet * 2.0, f"quiet={quiet:.2f} noisy={noisy:.2f}"


def test_the_band_may_be_asymmetric_about_the_median():
    """Right-skewed noise: the upper reach should exceed the lower."""
    rng = np.random.default_rng(11)
    n = 3000
    x = rng.uniform(0.0, 1.0, size=(n, 2))
    y = 10.0 + rng.lognormal(mean=0.0, sigma=0.8, size=n)
    (xt, yt), (xc, yc), (xe, _) = _split(x, y)

    model = fit_cqr(xt, yt, xc, yc, alpha=ALPHA)
    lo, hi = model.predict_interval(xe)
    mid = model.predict_median(xe)

    up = float(np.mean(hi - mid))
    down = float(np.mean(mid - lo))
    assert up > down * 1.3, f"up={up:.2f} down={down:.2f}"


# --- guards --------------------------------------------------------------------

def test_a_calibration_set_too_small_to_be_meaningful_is_refused():
    x, y = _heteroscedastic(n=200)
    with pytest.raises(ValueError, match="calibration"):
        fit_cqr(x[:150], y[:150], x[150:158], y[150:158], alpha=ALPHA)


def test_the_wrapper_reports_the_offset_it_measured():
    x, y = _heteroscedastic()
    (xt, yt), (xc, yc), _ = _split(x, y)
    model = fit_cqr(xt, yt, xc, yc, alpha=ALPHA)
    assert isinstance(model, CQRWrapper)
    assert np.isfinite(model.offset)


# --- integration with the production revenue model -----------------------------

import datetime as dt
import pandas as pd


def _revenue_history(days: int = 420, seed: int = 8) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    dates = pd.date_range(end=pd.Timestamp("2026-08-20"), periods=days, freq="D")
    weekday = dates.weekday.to_numpy()
    lift = np.where(weekday >= 5, 1.3, 1.0)
    # Weekends are both bigger AND more volatile — the conditional-width case.
    noise = rng.normal(0.0, np.where(weekday >= 5, 700.0, 150.0))
    return pd.DataFrame({"date": dates, "revenue": (5000.0 * lift + noise).clip(min=100.0)})


@pytest.fixture
def revenue_model(monkeypatch):
    from ml.models import revenue as rev
    hist = _revenue_history()
    monkeypatch.setattr(rev, "load_daily_revenue", lambda store_id, lookback_days=540: hist.copy())
    return rev, hist


def test_the_model_can_be_trained_with_cqr_intervals(revenue_model):
    rev, _ = revenue_model
    result = rev.train("s1", enriched=False, interval_method="cqr")
    assert result is not None
    assert result.cqr is not None
    assert "cqr" in result.flavor


def test_cqr_leaves_the_point_forecast_alone(revenue_model):
    """The swap is interval-only, so the backtest isolates band shape from
    point accuracy. Same seed, same split, same point predictions."""
    rev, _ = revenue_model
    a = rev.train("s1", enriched=False, interval_method="conformal")
    b = rev.train("s1", enriched=False, interval_method="cqr")

    rows_a = rev.forecast("s1", a, horizon_days=7)
    rows_b = rev.forecast("s1", b, horizon_days=7)
    for ra, rb in zip(rows_a, rows_b):
        assert rb.predicted_revenue == pytest.approx(ra.predicted_revenue, rel=1e-9)


def test_cqr_bands_vary_by_day_where_symmetric_ones_do_not(revenue_model):
    """Weekends in this fixture are 4.7x noisier than weekdays. A single
    conformal half-width cannot express that; CQR must."""
    rev, hist = revenue_model
    result = rev.train("s1", enriched=False, interval_method="cqr")
    rows = rev.forecast("s1", result, horizon_days=14)

    widths_by_weekend = {True: [], False: []}
    for r in rows:
        widths_by_weekend[r.forecast_date.weekday() >= 5].append(r.p90 - r.p10)

    weekend = float(np.mean(widths_by_weekend[True]))
    weekday = float(np.mean(widths_by_weekend[False]))
    assert weekend > weekday * 1.5, f"weekend={weekend:.0f} weekday={weekday:.0f}"


def test_the_point_forecast_always_sits_inside_the_cqr_band(revenue_model):
    """The band comes from quantile models and the point from a squared-error
    one. They can disagree; the row must never ship an interval that excludes
    its own prediction."""
    rev, _ = revenue_model
    result = rev.train("s1", enriched=False, interval_method="cqr")
    for r in rev.forecast("s1", result, horizon_days=14):
        assert r.p10 <= r.predicted_revenue <= r.p90


def test_conformal_remains_the_default(revenue_model):
    rev, _ = revenue_model
    result = rev.train("s1", enriched=False)
    assert result.cqr is None
    assert "conformal" in result.flavor
