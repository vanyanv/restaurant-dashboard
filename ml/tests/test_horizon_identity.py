"""F16 — the stored horizon was one less than the horizon the model forecast at.

`forecast()` iterates `offset in range(1, horizon_days + 1)` from the last
*observed* day. The nightly runs at 10:00 UTC and the last observed day is
normally the previous date, so `offset = 1` produces a row whose
`forecastDate` equals `generatedAt::date`. Every consumer derived the horizon
as `forecastDate - generatedAt::date`, which made that row horizon **0**.

Production confirms it: `ForecastDailyRevenue` holds horizons 0-13 for a
14-day forecast.

Two things were broken by this and neither announced itself:

- `horizon_calibration.load_horizon_widths` filters `BETWEEN 1 AND 21`, so it
  silently discarded the next-day forecast — the single most-used horizon —
  and returned a dict keyed 1..13 that `forecast()` then looked up by
  `offset` 1..14. Every measured width was applied to the horizon one step
  short of the one it was measured on, and offset 14 got nothing. The
  coverage table in that module's own docstring is mislabelled for the same
  reason.

- `split_rows_by_horizon` drops non-positive horizons, so it would have
  written no per-horizon evaluation rows at all in production.

The offset is not even constant: `trim_incomplete_trailing_days` can drop an
extra trailing day, which shifts the whole relationship for that night. So
the horizon is not reliably *derivable* and must be *recorded*. `ForecastRow`
now carries the offset it was produced at, and the writer persists it.
"""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd
import pytest

from ml.evaluation.nightly_integration import split_rows_by_horizon
from ml.models import revenue as revenue_model


def _history(days: int = 400, seed: int = 9) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    dates = pd.date_range(end=pd.Timestamp("2026-08-20"), periods=days, freq="D")
    lift = np.where(dates.weekday.to_numpy() >= 5, 1.3, 1.0)
    revenue = (5000.0 * lift + rng.normal(0.0, 200.0, size=days)).clip(min=100.0)
    return pd.DataFrame({"date": dates, "revenue": revenue})


@pytest.fixture
def trained(monkeypatch):
    history = _history()
    monkeypatch.setattr(
        revenue_model, "load_daily_revenue",
        lambda store_id, lookback_days=540: history.copy(),
    )
    return revenue_model.train("store-test", enriched=False), history


def test_each_forecast_row_records_the_horizon_it_was_made_at(trained):
    result, _ = trained
    rows = revenue_model.forecast("store-test", result, horizon_days=14)

    assert [r.horizon for r in rows] == list(range(1, 15)), (
        "horizon must be the model's own offset, 1-based, not inferred later"
    )


def test_the_horizon_matches_the_gap_from_the_last_observed_day(trained):
    result, history = trained
    last_observed = history["date"].max().date()
    rows = revenue_model.forecast("store-test", result, horizon_days=5)

    for r in rows:
        assert (r.forecast_date - last_observed).days == r.horizon


def test_horizon_one_can_land_on_the_generation_date(trained):
    """The case that produced the off-by-one.

    With the last observed day being yesterday, the 1-step-ahead forecast is
    for *today* — so `forecastDate - generatedAt::date` is 0 while the true
    horizon is 1. Recording the horizon is what makes the two independent.
    """
    result, history = trained
    rows = revenue_model.forecast("store-test", result, horizon_days=1)
    generated_on = history["date"].max().date() + dt.timedelta(days=1)

    assert rows[0].horizon == 1
    assert rows[0].forecast_date == generated_on
    assert (rows[0].forecast_date - generated_on).days == 0


def test_the_evaluation_grouper_keeps_horizon_one(trained):
    """`split_rows_by_horizon` dropped horizon <= 0, which under the old
    derivation meant dropping the next-day forecast in production."""
    rows = [
        (dt.date(2026, 8, 1) + dt.timedelta(days=i), 5000.0, 5100.0, 4000.0, 6000.0, "v1", 1)
        for i in range(6)
    ]
    grouped = split_rows_by_horizon(rows)
    assert set(grouped) == {1}
    assert len(grouped[1]) == 6


def test_the_writer_persists_the_horizon():
    """The column has to be in the INSERT or the recording is decorative."""
    import inspect

    from ml import run_nightly

    src = inspect.getsource(run_nightly._write_revenue_forecasts)
    assert '"horizonDay"' in src, "horizonDay is not written by _write_revenue_forecasts"
    assert "r.horizon" in src, "the row's own horizon is not the value being written"
