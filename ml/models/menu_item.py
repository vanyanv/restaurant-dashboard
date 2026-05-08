"""XGBoost menu-item demand forecaster (one model per store-item).

Same shape as the revenue model — small XGBoost on lag/rolling features,
chronological 21-day holdout for MAPE/MAE, iterative 7-day forecast.

Per-item training is fast enough at 5 stores × top-30 items that we can
afford one model per (store, item). When that ceases to be true, the
next move is to fit a single multi-task booster keyed on a per-item id
embedding — but YAGNI until then.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Optional

import numpy as np
import pandas as pd
from xgboost import XGBRegressor

from ml.features.menu_item import (
    build_features,
    feature_columns,
    load_daily_quantity,
    split_train_holdout,
)


@dataclass
class TrainResult:
    model: XGBRegressor
    mape: float
    mae: float
    sample_size: int
    holdout_residual_std: float


@dataclass
class ForecastRow:
    forecast_date: dt.date
    predicted_qty: float
    p10: float
    p90: float


def train(store_id: str, item_name: str) -> Optional[TrainResult]:
    history = load_daily_quantity(store_id, item_name)
    if history.empty or len(history) < 60:
        return None

    feats = build_features(history)
    train_df, holdout_df = split_train_holdout(feats, holdout_days=21)
    if train_df.empty or holdout_df.empty:
        return None

    cols = feature_columns()
    model = XGBRegressor(
        n_estimators=300,
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
    model.fit(train_df[cols], train_df["qty"])

    preds = model.predict(holdout_df[cols])
    actuals = holdout_df["qty"].to_numpy()
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
    )


def forecast(
    store_id: str, item_name: str, result: TrainResult, horizon_days: int = 7
) -> list[ForecastRow]:
    history = load_daily_quantity(store_id, item_name)
    if history.empty:
        return []

    feats = build_features(history)
    last_date = feats["date"].max().date()
    cols = feature_columns()

    rolling = feats.copy()
    out: list[ForecastRow] = []
    for offset in range(1, horizon_days + 1):
        target_date = last_date + dt.timedelta(days=offset)
        new_row_seed = pd.DataFrame({"date": [pd.Timestamp(target_date)], "qty": [np.nan]})
        rolling = pd.concat([rolling[["date", "qty"]], new_row_seed], ignore_index=True)
        rolling = build_features(rolling)
        feat_row = rolling.iloc[-1]
        x = feat_row[cols].to_frame().T.to_numpy(dtype=float, na_value=np.nan)
        pred = float(result.model.predict(x)[0])

        widening = 1.0 + 0.07 * offset
        sigma = result.holdout_residual_std * widening
        out.append(
            ForecastRow(
                forecast_date=target_date,
                predicted_qty=max(0.0, pred),
                p10=max(0.0, pred - 1.28 * sigma),
                p90=max(0.0, pred + 1.28 * sigma),
            )
        )
        rolling.iloc[-1, rolling.columns.get_loc("qty")] = pred

    return out
