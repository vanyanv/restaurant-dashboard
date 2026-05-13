from datetime import date
import numpy as np
import pandas as pd
import pytest

from ml.evaluation.baseline import seasonal_naive_daily, seasonal_naive_hourly


def _daily_history():
    return pd.DataFrame({
        "date":  pd.date_range("2026-04-01", periods=14, freq="D"),
        "value": np.arange(1, 15, dtype=float),
    })


def test_seasonal_naive_daily_predicts_t_minus_7():
    df = _daily_history()
    preds = seasonal_naive_daily(df, value_col="value", horizon_days=7)
    assert list(preds["predicted"].values) == [8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0]
    assert preds["forecastDate"].iloc[0] == pd.Timestamp("2026-04-15")


def test_seasonal_naive_daily_raises_on_short_history():
    df = _daily_history().head(5)
    with pytest.raises(ValueError, match="at least 7 days"):
        seasonal_naive_daily(df, value_col="value", horizon_days=1)


def test_seasonal_naive_hourly_predicts_t_minus_168():
    rng = pd.date_range("2026-04-01 00:00", periods=336, freq="h")
    df = pd.DataFrame({"ts": rng, "value": np.arange(336, dtype=float)})
    preds = seasonal_naive_hourly(df, value_col="value", horizon_hours=24)
    assert preds["predicted"].iloc[0] == 168.0
    assert preds["forecastTs"].iloc[0] == pd.Timestamp("2026-04-15 00:00")
    assert len(preds) == 24


def test_seasonal_naive_hourly_raises_on_short_history():
    rng = pd.date_range("2026-04-01 00:00", periods=24 * 5, freq="h")
    df = pd.DataFrame({"ts": rng, "value": np.zeros(24 * 5)})
    with pytest.raises(ValueError, match="at least 168 hours"):
        seasonal_naive_hourly(df, value_col="value", horizon_hours=1)
