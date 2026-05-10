"""XGBoost daily-revenue forecaster.

One model per store (small scale — 5 stores). Trains on lag/rolling
features, evaluates on a 30-day held-out tail, then forecasts the next
horizon_days iteratively (each predicted day becomes the lag-1 input
for the next).
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Optional

import numpy as np
import pandas as pd
from xgboost import XGBRegressor

from ml.features.revenue import (
    build_enriched_features,
    build_features,
    enriched_feature_columns,
    feature_columns,
    load_daily_revenue,
    load_revenue_external_signals,
    split_train_holdout,
)
from ml.features.external_signals import external_signal_coverage


@dataclass
class TrainResult:
    model: XGBRegressor
    mape: float
    mae: float
    sample_size: int
    holdout_residual_std: float
    flavor: str = "baseline"
    signal_coverage: float = 0.0
    feature_names: tuple[str, ...] = ()


@dataclass
class ForecastRow:
    forecast_date: dt.date
    predicted_revenue: float
    p10: float
    p90: float


def train(store_id: str, *, enriched: bool = False) -> Optional[TrainResult]:
    history = load_daily_revenue(store_id)
    if history.empty or len(history) < 60:
        # Need enough history for lag-28 + rolling-28 to be meaningful.
        return None

    external_daily = pd.DataFrame()
    signal_coverage = 0.0
    if enriched:
        external_daily = load_revenue_external_signals(
            store_id,
            history["date"].min().date(),
            history["date"].max().date(),
        )
        signal_coverage = external_signal_coverage(external_daily)
        if signal_coverage < 0.6:
            return None
        feats = build_enriched_features(history, external_daily)
        cols = enriched_feature_columns()
        flavor = "weather-events"
    else:
        feats = build_features(history)
        cols = feature_columns()
        flavor = "baseline"
    train_df, holdout_df = split_train_holdout(feats, holdout_days=30)
    if train_df.empty or holdout_df.empty:
        return None

    model = XGBRegressor(
        n_estimators=400,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.85,
        colsample_bytree=0.85,
        reg_alpha=0.1,
        reg_lambda=0.5,
        objective="reg:squarederror",
        random_state=42,
        n_jobs=2,
    )
    model.fit(train_df[cols], train_df["revenue"])

    preds = model.predict(holdout_df[cols])
    actuals = holdout_df["revenue"].to_numpy()
    safe_actuals = np.where(actuals == 0, 1e-6, actuals)
    mape = float(np.mean(np.abs((preds - actuals) / safe_actuals)))
    mae = float(np.mean(np.abs(preds - actuals)))
    holdout_residual_std = float(np.std(preds - actuals, ddof=1)) if len(preds) > 1 else 0.0

    return TrainResult(
        model=model,
        mape=mape,
        mae=mae,
        sample_size=len(train_df),
        holdout_residual_std=holdout_residual_std,
        flavor=flavor,
        signal_coverage=signal_coverage,
        feature_names=tuple(cols),
    )


def forecast(store_id: str, result: TrainResult, horizon_days: int = 14) -> list[ForecastRow]:
    history = load_daily_revenue(store_id)
    if history.empty:
        return []

    feats = build_features(history)
    last_date = feats["date"].max().date()
    cols = list(result.feature_names or feature_columns())
    external_daily = pd.DataFrame()
    if result.flavor == "weather-events":
        external_daily = load_revenue_external_signals(
            store_id,
            history["date"].min().date(),
            last_date + dt.timedelta(days=horizon_days),
        )

    rolling = feats.copy()
    out: list[ForecastRow] = []
    # Iteratively predict, appending each prediction as if observed so the
    # next day's lag features see it. Quick hack — fine at 14d horizon.
    for offset in range(1, horizon_days + 1):
        target_date = last_date + dt.timedelta(days=offset)
        new_row_seed = pd.DataFrame({"date": [pd.Timestamp(target_date)], "revenue": [np.nan]})
        rolling = pd.concat([rolling[["date", "revenue"]], new_row_seed], ignore_index=True)
        if result.flavor == "weather-events":
            rolling = build_enriched_features(rolling, external_daily)
        else:
            rolling = build_features(rolling)
        feat_row = rolling.iloc[-1]
        x = feat_row[cols].to_frame().T
        pred = float(model_safe_predict(result.model, x))

        # Approximate ±1.28 SD = 80% PI from the holdout residual std,
        # widened by 1 + 0.05 * offset to reflect compounding uncertainty.
        widening = 1.0 + 0.05 * offset
        sigma = result.holdout_residual_std * widening
        out.append(
            ForecastRow(
                forecast_date=target_date,
                predicted_revenue=max(0.0, pred),
                p10=max(0.0, pred - 1.28 * sigma),
                p90=max(0.0, pred + 1.28 * sigma),
            )
        )
        rolling.iloc[-1, rolling.columns.get_loc("revenue")] = pred

    return out


def model_safe_predict(model: XGBRegressor, x: pd.DataFrame) -> float:
    """Predict a single row with NaN-tolerance.

    Iterative forecasting can produce a NaN in `growth_rate_90` when the
    trailing 90-day mean was zero. XGBoost handles NaN natively when
    `missing=np.nan` is passed at predict time on a numpy array.
    """
    arr = x.to_numpy(dtype=float, na_value=np.nan)
    return float(model.predict(arr)[0])
