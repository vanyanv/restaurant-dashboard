"""XGBoost hourly order-demand forecaster."""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Optional

import numpy as np
import pandas as pd
from xgboost import XGBRegressor

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


@dataclass
class ForecastRow:
    forecast_date: dt.date
    hour_bucket: int
    predicted_orders: float
    p10: float
    p90: float


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
    train_df, holdout_df = split_train_holdout(feats, holdout_days=14)
    if train_df.empty or holdout_df.empty:
        return None

    model = XGBRegressor(
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
    model.fit(train_df[cols], train_df["target_orders"])

    preds = model.predict(holdout_df[cols])
    actuals = holdout_df["target_orders"].to_numpy(dtype=float)
    safe_actuals = np.where(actuals == 0, 1.0, actuals)
    mape = float(np.mean(np.abs((preds - actuals) / safe_actuals)))
    mae = float(np.mean(np.abs(preds - actuals)))
    holdout_residual_std = float(np.std(preds - actuals, ddof=1)) if len(preds) > 1 else 0.0
    harri_coverage = _harri_coverage(harri_daily, hourly["date"].max())

    return TrainResult(
        model=model,
        mape=mape,
        mae=mae,
        sample_size=len(train_df),
        holdout_residual_std=holdout_residual_std,
        harri_coverage=harri_coverage,
        history=hourly,
        daily=daily,
        harri_daily=harri_daily,
        flavor=flavor,
        signal_coverage=signal_coverage,
        feature_names=tuple(cols),
        external_hourly=external_hourly,
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
    external_hourly = result.external_hourly
    if result.flavor == "weather-events":
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
            if result.flavor == "weather-events":
                feats = build_enriched_feature_matrix(
                    rolling_hourly, rolling_daily, result.harri_daily, external_hourly
                )
            else:
                feats = build_feature_matrix(rolling_hourly, rolling_daily, result.harri_daily)
            row_idx = feats.index[
                (feats["date"] == pd.Timestamp(target_date)) & (feats["hour"] == hour)
            ][0]
            x = feats.loc[[row_idx], cols]
            pred = max(0.0, model_safe_predict(result.model, x))
            day_predictions.append(pred)
            mask = (
                (rolling_hourly["date"] == pd.Timestamp(target_date))
                & (rolling_hourly["hour"] == hour)
            )
            rolling_hourly.loc[mask, "orders"] = pred

            widening = 1.0 + 0.025 * offset
            sigma = result.holdout_residual_std * widening
            out.append(
                ForecastRow(
                    forecast_date=target_date,
                    hour_bucket=hour,
                    predicted_orders=pred,
                    p10=max(0.0, pred - 1.28 * sigma),
                    p90=max(0.0, pred + 1.28 * sigma),
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
