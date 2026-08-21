"""F3 + F4 — anomalies scored against the day's own forecast interval.

The z-score detector pooled a 28-day mean and standard deviation. Restaurant
revenue has a large, entirely predictable weekly cycle, so that σ was inflated
by seasonality that is not surprise: the denominator grew, every z shrank, and
`|z| > 3` became close to unreachable. The detector was quiet because the
yardstick was wrong, not because operations were calm. Mean and σ also have a
breakdown point of zero, so a single outage poisoned the window for 28 days.

Separately (F3) it was the only reader in the pipeline that skipped
`trim_incomplete_trailing_days`, so it scored a business day that was still
being written — on a store that books 31.9% of net sales after 21:00.

The replacement costs almost nothing: every store-day already carries a
calibrated P10/P90. An anomaly *is* an actual outside its own day's interval.
That is seasonality-aware by construction, robust by construction, works over
any window rather than only the last observation, and yields a dollar residual
an operator can act on instead of a unitless z.
"""
from __future__ import annotations

import datetime as dt

import pandas as pd
import pytest

from ml.anomaly.interval import (
    IntervalObservation,
    score_interval_anomalies,
)


D0 = dt.date(2026, 8, 1)


def _obs(day: int, actual: float, predicted: float, p10: float, p90: float) -> IntervalObservation:
    return IntervalObservation(
        occurred_on=D0 + dt.timedelta(days=day),
        actual=actual,
        predicted=predicted,
        p10=p10,
        p90=p90,
    )


# --- the core rule -------------------------------------------------------------

def test_an_actual_inside_the_band_is_not_an_anomaly():
    assert score_interval_anomalies([_obs(0, 5000.0, 5000.0, 4000.0, 6000.0)]) == []


def test_an_actual_below_the_band_is_flagged():
    out = score_interval_anomalies([_obs(0, 3000.0, 5000.0, 4000.0, 6000.0)])
    assert len(out) == 1
    assert out[0].direction == "below"
    assert out[0].residual == pytest.approx(-2000.0)


def test_an_actual_above_the_band_is_flagged():
    out = score_interval_anomalies([_obs(0, 9000.0, 5000.0, 4000.0, 6000.0)])
    assert len(out) == 1
    assert out[0].direction == "above"
    assert out[0].residual == pytest.approx(4000.0)


def test_the_band_edges_are_inside():
    rows = [_obs(0, 4000.0, 5000.0, 4000.0, 6000.0), _obs(1, 6000.0, 5000.0, 4000.0, 6000.0)]
    assert score_interval_anomalies(rows) == []


# --- what the z-score could not do ---------------------------------------------

def test_a_saturday_is_judged_against_saturday():
    """The pooled-σ failure, stated as a test.

    Both days miss their own forecast by $2,000. A pooled 28-day distribution
    would rank the Saturday as unremarkable simply because Saturdays are large;
    scored against its own interval, it is exactly as anomalous as the Tuesday.
    """
    tuesday = _obs(0, 2000.0, 4000.0, 3500.0, 4500.0)     # $2k below a small day
    saturday = _obs(4, 8000.0, 10000.0, 9500.0, 10500.0)  # $2k below a big day
    out = score_interval_anomalies([tuesday, saturday])
    assert len(out) == 2
    assert {a.direction for a in out} == {"below"}


def test_every_day_in_the_window_is_scored_not_only_the_last():
    """The z-score detector scored one observation and never backfilled, so a
    skipped nightly left that day permanently unexamined."""
    rows = [
        _obs(0, 1000.0, 5000.0, 4000.0, 6000.0),   # anomalous
        _obs(1, 5000.0, 5000.0, 4000.0, 6000.0),   # fine
        _obs(2, 9000.0, 5000.0, 4000.0, 6000.0),   # anomalous
    ]
    out = score_interval_anomalies(rows)
    assert [a.occurred_on for a in out] == [D0, D0 + dt.timedelta(days=2)]


def test_one_outage_does_not_suppress_the_next_day():
    """A pooled σ absorbed an outage and stayed inflated for 28 days."""
    rows = [_obs(0, 0.0, 5000.0, 4000.0, 6000.0), _obs(1, 500.0, 5000.0, 4000.0, 6000.0)]
    assert len(score_interval_anomalies(rows)) == 2


# --- noise control -------------------------------------------------------------

def test_a_trivially_small_miss_outside_a_tight_band_is_not_surfaced():
    # $30 outside the band on a $5,000 day is a calibration artefact, not news.
    rows = [_obs(0, 4970.0, 5000.0, 4990.0, 5010.0)]
    assert score_interval_anomalies(rows, min_relative_residual=0.10) == []


def test_the_noise_floor_is_relative_to_the_forecast():
    rows = [_obs(0, 4000.0, 5000.0, 4990.0, 5010.0)]  # 20% below
    assert len(score_interval_anomalies(rows, min_relative_residual=0.10)) == 1


def test_severity_grows_with_distance_beyond_the_band():
    # min_severity=0.0 to isolate the ordering property from the alert bar —
    # the shallow case is deliberately below the default threshold.
    near = score_interval_anomalies([_obs(0, 3900.0, 5000.0, 4000.0, 6000.0)], min_severity=0.0)[0]
    far = score_interval_anomalies([_obs(0, 1000.0, 5000.0, 4000.0, 6000.0)], min_severity=0.0)[0]
    assert far.severity > near.severity


def test_rows_without_an_actual_are_skipped():
    """An unobserved day (F1) has no actual, and NaN is not an anomaly."""
    rows = [
        IntervalObservation(D0, actual=float("nan"), predicted=5000.0, p10=4000.0, p90=6000.0),
        IntervalObservation(D0 + dt.timedelta(days=1), actual=None, predicted=5000.0, p10=4000.0, p90=6000.0),
    ]
    assert score_interval_anomalies(rows) == []


def test_a_degenerate_band_is_skipped_rather_than_flagging_everything():
    # p10 == p90 means the interval carries no information; every actual would
    # sit "outside" it.
    rows = [_obs(0, 5100.0, 5000.0, 5000.0, 5000.0)]
    assert score_interval_anomalies(rows) == []


def test_a_zero_forecast_is_skipped():
    rows = [_obs(0, 500.0, 0.0, 0.0, 0.0)]
    assert score_interval_anomalies(rows) == []


def test_empty_input():
    assert score_interval_anomalies([]) == []


# --- F3: the trailing-day guard the z-score path skipped ------------------------

def test_revenue_zscore_reads_through_the_shared_loader(monkeypatch):
    """`detect_revenue_anomalies` issued its own SQL and therefore scored a day
    that was still being written. It must go through `load_daily_revenue`, which
    trims incomplete trailing days and fills gaps from evidence."""
    from ml.anomaly import zscore

    calls: list[str] = []

    def fake_loader(store_id: str, lookback_days: int = 540) -> pd.DataFrame:
        calls.append(store_id)
        dates = pd.date_range("2026-06-01", periods=60, freq="D")
        return pd.DataFrame({"date": dates, "revenue": [5000.0] * 60})

    monkeypatch.setattr(zscore, "load_daily_revenue", fake_loader)
    zscore.detect_revenue_anomalies("store-x")

    assert calls == ["store-x"], "detect_revenue_anomalies bypassed load_daily_revenue"


# --- writing ------------------------------------------------------------------

def test_interval_anomalies_convert_to_writable_events():
    from ml.anomaly.interval import METHOD, to_anomaly_events

    found = score_interval_anomalies([_obs(0, 3000.0, 5000.0, 4000.0, 6000.0)])
    events = to_anomaly_events(found)

    assert len(events) == 1
    e = events[0]
    assert e.target == "REVENUE"
    assert e.target_id is None
    assert e.occurred_on == D0
    assert e.residual == pytest.approx(-2000.0)
    assert e.method == METHOD
    # z-score is meaningless here and must not be invented; the column is nullable.
    assert e.z_score is None


def test_the_event_explains_itself_in_dollars():
    from ml.anomaly.interval import to_anomaly_events

    found = score_interval_anomalies([_obs(0, 3000.0, 5000.0, 4000.0, 6000.0)])
    text = to_anomaly_events(found)[0].explanation
    assert text is not None
    assert "$3,000" in text and "$5,000" in text


def test_zscore_events_still_declare_their_own_method():
    from ml.anomaly.zscore import Anomaly

    a = Anomaly(target="REVENUE", target_id=None, occurred_on=D0, residual=-1.0, z_score=-3.5)
    assert a.method == "ZSCORE"


# --- an 80% interval is breached one day in five by design ---------------------

def test_a_routine_breach_of_an_80_percent_band_is_not_an_alert():
    """Dry-run against production (2026-08-21) flagged 8 days in 26.

    That is not 8 surprises. p10/p90 is an *80%* interval, so roughly one day in
    five lands outside it when the model is working perfectly — and Hollywood's
    measured coverage is 69%, so the bands are running narrow on top of that.
    Alerting on every breach turns a calibration property into an inbox full of
    notifications that mean nothing.

    A day has to be surprising *given* the interval, not merely outside it.
    """
    # Just past p10 — the routine case, ~20% of all days.
    rows = [_obs(0, 3900.0, 5000.0, 4000.0, 6000.0)]
    assert score_interval_anomalies(rows) == []


def test_a_day_outside_the_implied_95_percent_band_is_an_alert():
    from ml.anomaly.interval import DEFAULT_MIN_SEVERITY

    # DEFAULT_MIN_SEVERITY places the bar at the 95% interval implied by the
    # 80% half-width, so this must clear it with room to spare.
    rows = [_obs(0, 2000.0, 5000.0, 4000.0, 6000.0)]
    out = score_interval_anomalies(rows)
    assert len(out) == 1
    assert out[0].severity > DEFAULT_MIN_SEVERITY


def test_the_default_bar_is_the_gaussian_95_percent_scaling():
    """Not a tuned constant. 1.96/1.2816 is how much wider a 95% interval is
    than an 80% one under the same dispersion, so the bar is derived rather
    than fitted to whatever last month happened to look like."""
    from ml.anomaly.interval import DEFAULT_MIN_SEVERITY

    assert DEFAULT_MIN_SEVERITY == pytest.approx(1.9600 / 1.2816 - 1.0, abs=1e-3)


def test_the_bar_can_be_lowered_for_a_report_that_is_not_an_alert():
    """Quality reporting wants every breach; the alert inbox does not."""
    rows = [_obs(0, 3900.0, 5000.0, 4000.0, 6000.0)]
    assert len(score_interval_anomalies(rows, min_severity=0.0)) == 1


def test_coverage_is_reportable_separately_from_alerting():
    """The breach rate is a calibration health metric in its own right — it is
    how F10 gets measured — and must not be conflated with the alert count."""
    from ml.anomaly.interval import interval_coverage_rate

    rows = [
        _obs(0, 5000.0, 5000.0, 4000.0, 6000.0),   # inside
        _obs(1, 5500.0, 5000.0, 4000.0, 6000.0),   # inside
        _obs(2, 3000.0, 5000.0, 4000.0, 6000.0),   # outside
        _obs(3, 9000.0, 5000.0, 4000.0, 6000.0),   # outside
    ]
    assert interval_coverage_rate(rows) == pytest.approx(0.5)


def test_coverage_of_an_empty_window_is_none_not_zero():
    from ml.anomaly.interval import interval_coverage_rate

    assert interval_coverage_rate([]) is None
