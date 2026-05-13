"""XGBoost hourly order-demand forecaster.

Prediction intervals are calibrated via split conformal prediction
(MAPIE, see `ml/evaluation/conformal.py`). Chronological 80/10/10 split
keyed on row position: train -> conformal calibration -> held-out. With a
60-day hourly history that's roughly 1152 train / 144 calib / 144 holdout
hours, which clears the conformal coverage floor with margin.

When the calibration window is smaller than 24 hourly rows we fall back
to the legacy holdout-residual-std heuristic and tag the flavor with
`-fallback` so the evaluator can distinguish coverage-guaranteed runs.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd
from xgboost import XGBRegressor

from ml.evaluation.conformal import ConformalWrapper, wrap_xgboost_conformal
from ml.features.external_signals import external_signal_coverage
from ml.features.hourly_orders import (
    build_enriched_feature_matrix,
    build_feature_matrix,
    enriched_feature_columns,
    feature_columns,
    load_daily_context,
    load_harri_features,
    load_hourly_orders,
    load_order_external_signals,
    split_train_holdout,
)


# MAPIE's 95% wrapper needs >=20 samples (1/alpha). With hourly granularity
# any reasonable history clears this — 24 also rounds to a full day.
MIN_CALIBRATION_ROWS = 24


@dataclass
class TrainResult:
    model: XGBRegressor
    mape: float
    mae: float
    sample_size: int
    holdout_residual_std: float
    harri_coverage: float
    history: pd.DataFrame
    daily: pd.DataFrame
    harri_daily: pd.DataFrame
    flavor: str = "baseline"
    signal_coverage: float = 0.0
    feature_names: tuple[str, ...] = ()
    external_hourly: pd.DataFrame | None = None
    conformal: Optional[ConformalWrapper] = None
    uses_fallback_interval: bool = False
    # Holdout arrays used by the seasonal-naive promotion gate; empty arrays
    # mean "no holdout exposed" (back-compat default).
    holdout_y_true: np.ndarray = field(default_factory=lambda: np.array([], dtype=float))
    holdout_y_pred: np.ndarray = field(default_factory=lambda: np.array([], dtype=float))


@dataclass
class ForecastRow:
    forecast_date: dt.date
    hour_bucket: int
    predicted_orders: float
    p10: float
    p90: float


def _conformal_split(feats: pd.DataFrame, cols: list[str]) -> tuple[
    pd.DataFrame, pd.DataFrame, pd.DataFrame
]:
    """80/10/10 chronological split — train / calibration / held-out.

    Time-ordered by (date, hour) before slicing so the calibration set and
    the held-out window are both strictly in the future of the train set.
    """
    clean = (
        feats.dropna(subset=cols)
        .sort_values(["date", "hour"])
        .reset_index(drop=True)
    )
    n = len(clean)
    n_train = int(n * 0.80)
    n_calib = int(n * 0.10)
    train_df = clean.iloc[:n_train]
    calib_df = clean.iloc[n_train : n_train + n_calib]
    holdout_df = clean.iloc[n_train + n_calib :]
    return train_df, calib_df, holdout_df


def train(store_id: str, *, enriched: bool = False) -> Optional[TrainResult]:
    hourly = load_hourly_orders(store_id)
    if hourly.empty or hourly["date"].nunique() < 45:
        return None

    daily = load_daily_context(store_id)
    harri_daily = load_harri_features(store_id)
    external_hourly = pd.DataFrame()
    signal_coverage = 0.0
    if enriched:
        external_hourly = load_order_external_signals(
            store_id,
            hourly["date"].min().date(),
            hourly["date"].max().date(),
        )
        signal_coverage = external_signal_coverage(external_hourly)
        if signal_coverage < 0.6:
            return None
        feats = build_enriched_feature_matrix(hourly, daily, harri_daily, external_hourly)
        cols = enriched_feature_columns()
        flavor = "weather-events"
    else:
        feats = build_feature_matrix(hourly, daily, harri_daily)
        cols = feature_columns()
        flavor = "baseline"

    train_df, calib_df, holdout_df = _conformal_split(feats, cols)
    if train_df.empty or holdout_df.empty:
        return None

    base = XGBRegressor(
        n_estimators=500,
        max_depth=5,
        learning_rate=0.04,
        subsample=0.85,
        colsample_bytree=0.85,
        reg_alpha=0.1,
        reg_lambda=0.7,
        objective="reg:squarederror",
        random_state=42,
        n_jobs=2,
    )

    uses_fallback = len(calib_df) < MIN_CALIBRATION_ROWS
    conformal: Optional[ConformalWrapper] = None
    if uses_fallback:
        legacy_train, legacy_holdout = split_train_holdout(feats, holdout_days=14)
        if legacy_train.empty or legacy_holdout.empty:
            return None
        base.fit(legacy_train[cols], legacy_train["target_orders"])
        eval_df = legacy_holdout
        train_size = len(legacy_train)
    else:
        X_train = train_df[cols].to_numpy(dtype=float, na_value=np.nan)
        y_train = train_df["target_orders"].to_numpy(dtype=float)
        X_calib = calib_df[cols].to_numpy(dtype=float, na_value=np.nan)
        y_calib = calib_df["target_orders"].to_numpy(dtype=float)
        conformal = wrap_xgboost_conformal(base, X_train, y_train, X_calib, y_calib)
        eval_df = holdout_df
        train_size = len(train_df)

    preds = base.predict(eval_df[cols])
    actuals = eval_df["target_orders"].to_numpy(dtype=float)
    safe_actuals = np.where(actuals == 0, 1.0, actuals)
    mape = float(np.mean(np.abs((preds - actuals) / safe_actuals)))
    mae = float(np.mean(np.abs(preds - actuals)))
    holdout_residual_std = float(np.std(preds - actuals, ddof=1)) if len(preds) > 1 else 0.0
    harri_coverage = _harri_coverage(harri_daily, hourly["date"].max())

    if uses_fallback:
        flavor = f"{flavor}-fallback"
    else:
        flavor = f"{flavor}-conformal"

    return TrainResult(
        model=base,
        mape=mape,
        mae=mae,
        sample_size=train_size,
        holdout_residual_std=holdout_residual_std,
        harri_coverage=harri_coverage,
        history=hourly,
        daily=daily,
        harri_daily=harri_daily,
        flavor=flavor,
        signal_coverage=signal_coverage,
        feature_names=tuple(cols),
        external_hourly=external_hourly,
        conformal=conformal,
        uses_fallback_interval=uses_fallback,
        holdout_y_true=np.asarray(actuals, dtype=float),
        holdout_y_pred=np.asarray(preds, dtype=float),
    )


def forecast(
    store_id: str,
    result: TrainResult,
    horizon_days: int = 14,
) -> list[ForecastRow]:
    if result.history.empty:
        return []

    rolling_hourly = result.history[["date", "hour", "orders", "net_sales"]].copy()
    rolling_daily = _daily_from_history(rolling_hourly, result.daily)
    last_date = rolling_hourly["date"].max().date()
    cols = list(result.feature_names or feature_columns())
    is_enriched = result.flavor.startswith("weather-events")
    external_hourly = result.external_hourly
    if is_enriched:
        external_hourly = load_order_external_signals(
            store_id,
            rolling_hourly["date"].min().date(),
            last_date + dt.timedelta(days=horizon_days),
        )
    out: list[ForecastRow] = []

    for offset in range(1, horizon_days + 1):
        target_date = last_date + dt.timedelta(days=offset)
        future_hours = pd.DataFrame(
            {
                "date": [pd.Timestamp(target_date)] * 24,
                "hour": list(range(24)),
                "orders": [np.nan] * 24,
                "net_sales": [0.0] * 24,
            }
        )
        rolling_hourly = pd.concat([rolling_hourly, future_hours], ignore_index=True)
        day_predictions: list[float] = []

        for hour in range(24):
            if is_enriched:
                feats = build_enriched_feature_matrix(
                    rolling_hourly, rolling_daily, result.harri_daily, external_hourly
                )
            else:
                feats = build_feature_matrix(rolling_hourly, rolling_daily, result.harri_daily)
            row_idx = feats.index[
                (feats["date"] == pd.Timestamp(target_date)) & (feats["hour"] == hour)
            ][0]
            x = feats.loc[[row_idx], cols]
            x_arr = x.to_numpy(dtype=float, na_value=np.nan)

            if result.conformal is not None and not result.uses_fallback_interval:
                point, lower80, upper80, _, _ = result.conformal.predict_intervals(x_arr)
                pred = max(0.0, float(point[0]))
                p10 = float(lower80[0])
                p90 = float(upper80[0])
            else:
                pred = max(0.0, float(result.model.predict(x_arr)[0]))
                widening = 1.0 + 0.025 * offset
                sigma = result.holdout_residual_std * widening
                p10 = pred - 1.28 * sigma
                p90 = pred + 1.28 * sigma

            day_predictions.append(pred)
            mask = (
                (rolling_hourly["date"] == pd.Timestamp(target_date))
                & (rolling_hourly["hour"] == hour)
            )
            rolling_hourly.loc[mask, "orders"] = pred

            out.append(
                ForecastRow(
                    forecast_date=target_date,
                    hour_bucket=hour,
                    predicted_orders=pred,
                    p10=max(0.0, p10),
                    p90=max(0.0, p90),
                )
            )

        recent_avg_ticket = _recent_avg_ticket(rolling_daily)
        rolling_daily = pd.concat(
            [
                rolling_daily,
                pd.DataFrame(
                    {
                        "date": [pd.Timestamp(target_date)],
                        "orders": [sum(day_predictions)],
                        "revenue": [sum(day_predictions) * recent_avg_ticket],
                    }
                ),
            ],
            ignore_index=True,
        )

    return out


def model_safe_predict(model: XGBRegressor, x: pd.DataFrame) -> float:
    arr = x.to_numpy(dtype=float, na_value=np.nan)
    return float(model.predict(arr)[0])


def _daily_from_history(hourly: pd.DataFrame, daily: pd.DataFrame) -> pd.DataFrame:
    if not daily.empty:
        return daily[["date", "orders", "revenue"]].copy()
    return hourly.groupby("date", as_index=False).agg(
        orders=("orders", "sum"),
        revenue=("net_sales", "sum"),
    )


def _recent_avg_ticket(daily: pd.DataFrame) -> float:
    tail = daily.tail(28)
    orders = float(tail["orders"].sum())
    revenue = float(tail["revenue"].sum())
    return revenue / orders if orders > 0 else 0.0


def _harri_coverage(harri_daily: pd.DataFrame, latest_history_date: pd.Timestamp) -> float:
    if harri_daily.empty:
        return 0.0
    start = latest_history_date - pd.Timedelta(days=89)
    rows = harri_daily[
        (harri_daily["date"] >= start) & (harri_daily["date"] <= latest_history_date)
    ]
    if rows.empty or "harri_coverage" not in rows:
        return 0.0
    return float(rows["harri_coverage"].mean())
