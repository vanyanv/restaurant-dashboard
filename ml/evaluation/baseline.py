"""Seasonal-naive baselines.

`seasonal_naive_daily`:  predicts y[t] = y[t-7].
`seasonal_naive_hourly`: predicts y[t] = y[t-168] (= 7 days × 24h).
"""

from __future__ import annotations
import pandas as pd


def seasonal_naive_daily(
    history: pd.DataFrame, *, value_col: str, horizon_days: int
) -> pd.DataFrame:
    if "date" not in history.columns:
        raise ValueError("history must have a 'date' column")
    if len(history) < 7:
        raise ValueError("seasonal-naive daily requires at least 7 days of history")

    df = history.sort_values("date").reset_index(drop=True)
    last_date = df["date"].iloc[-1]

    out_dates = pd.date_range(
        start=last_date + pd.Timedelta(days=1), periods=horizon_days, freq="D"
    )
    lookup = df.set_index("date")[value_col]
    predicted = [lookup.loc[d - pd.Timedelta(days=7)] for d in out_dates]
    return pd.DataFrame({"forecastDate": out_dates, "predicted": predicted})


def seasonal_naive_hourly(
    history: pd.DataFrame, *, value_col: str, horizon_hours: int
) -> pd.DataFrame:
    if "ts" not in history.columns:
        raise ValueError("history must have a 'ts' column (hourly timestamp)")
    if len(history) < 168:
        raise ValueError("seasonal-naive hourly requires at least 168 hours of history")

    df = history.sort_values("ts").reset_index(drop=True)
    last_ts = df["ts"].iloc[-1]

    out_ts = pd.date_range(
        start=last_ts + pd.Timedelta(hours=1), periods=horizon_hours, freq="h"
    )
    lookup = df.set_index("ts")[value_col]
    predicted = [lookup.loc[t - pd.Timedelta(hours=168)] for t in out_ts]
    return pd.DataFrame({"forecastTs": out_ts, "predicted": predicted})
