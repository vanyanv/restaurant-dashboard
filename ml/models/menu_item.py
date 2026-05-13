"""XGBoost menu-item demand forecaster (one model per store-item).

Same shape as the revenue model — small XGBoost on lag/rolling features,
chronological holdout for MAPE/MAE, iterative 7-day forecast.

Prediction intervals come from split conformal prediction (MAPIE) when
the SKU has at least 150 days of history. Below that floor the
calibration set would be too small for the coverage guarantee to mean
anything, so we keep the legacy quantile-style residual-std intervals
and tag the flavor with `-fallback`.

Per-item training is fast enough at 5 stores x top-30 items that we can
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

from ml.evaluation.conformal import ConformalWrapper, wrap_xgboost_conformal
from ml.features.menu_item import (
    build_features,
    feature_columns,
    load_daily_quantity,
    split_train_holdout,
)


# Calibration coverage only meaningful with a non-trivial conformal set.
# MAPIE requires 1/alpha samples for an alpha-coverage interval; the 95%
# wrapper needs >=20 calibration rows. At 80/10/10 that means we want at
# least ~200 clean feature rows, i.e. ~290 days of raw history. Below the
# floor we fall back to the legacy quantile-based heuristic.
MIN_HISTORY_FOR_CONFORMAL = 290
MIN_CALIBRATION_ROWS = 20


@dataclass
class TrainResult:
    model: XGBRegressor
    mape: float
    mae: float
    sample_size: int
    holdout_residual_std: float
    flavor: str = "baseline"
    conformal: Optional[ConformalWrapper] = None
    uses_fallback_interval: bool = False


@dataclass
class ForecastRow:
    forecast_date: dt.date
    predicted_qty: float
    p10: float
    p90: float


def _conformal_split(feats: pd.DataFrame, cols: list[str]) -> tuple[
    pd.DataFrame, pd.DataFrame, pd.DataFrame
]:
    # Explicit chronological sort: calibration/holdout MUST be strictly future of train.
    clean = (
        feats.dropna(subset=cols)
        .sort_values("date")
        .reset_index(drop=True)
    )
    n = len(clean)
    n_train = int(n * 0.80)
    n_calib = int(n * 0.10)
    train_df = clean.iloc[:n_train]
    calib_df = clean.iloc[n_train : n_train + n_calib]
    holdout_df = clean.iloc[n_train + n_calib :]
    return train_df, calib_df, holdout_df


def train(store_id: str, item_name: str) -> Optional[TrainResult]:
    history = load_daily_quantity(store_id, item_name)
    if history.empty or len(history) < 60:
        return None

    feats = build_features(history)
    cols = feature_columns()

    base = XGBRegressor(
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

    # Short-history SKUs keep the legacy heuristic — calibration too small to
    # produce honest conformal bands.
    use_conformal = len(history) >= MIN_HISTORY_FOR_CONFORMAL
    conformal: Optional[ConformalWrapper] = None

    if use_conformal:
        train_df, calib_df, holdout_df = _conformal_split(feats, cols)
        if train_df.empty or holdout_df.empty or len(calib_df) < MIN_CALIBRATION_ROWS:
            use_conformal = False

    if use_conformal:
        X_train = train_df[cols].to_numpy(dtype=float, na_value=np.nan)
        y_train = train_df["qty"].to_numpy(dtype=float)
        X_calib = calib_df[cols].to_numpy(dtype=float, na_value=np.nan)
        y_calib = calib_df["qty"].to_numpy(dtype=float)
        conformal = wrap_xgboost_conformal(base, X_train, y_train, X_calib, y_calib)
        eval_df = holdout_df
        train_size = len(train_df)
        flavor = "xgb-v3-conformal"
    else:
        legacy_train, legacy_holdout = split_train_holdout(feats, holdout_days=21)
        if legacy_train.empty or legacy_holdout.empty:
            return None
        base.fit(legacy_train[cols], legacy_train["qty"])
        eval_df = legacy_holdout
        train_size = len(legacy_train)
        flavor = "xgb-v3-fallback"

    preds = base.predict(eval_df[cols])
    actuals = eval_df["qty"].to_numpy()
    safe_actuals = np.where(actuals == 0, 1e-6, actuals)
    mape = float(np.mean(np.abs((preds - actuals) / safe_actuals)))
    mae = float(np.mean(np.abs(preds - actuals)))
    holdout_residual_std = float(np.std(preds - actuals, ddof=1)) if len(preds) > 1 else 0.0

    return TrainResult(
        model=base,
        mape=mape,
        mae=mae,
        sample_size=train_size,
        holdout_residual_std=holdout_residual_std,
        flavor=flavor,
        conformal=conformal,
        uses_fallback_interval=not use_conformal,
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
        x_arr = feat_row[cols].to_frame().T.to_numpy(dtype=float, na_value=np.nan)

        if result.conformal is not None and not result.uses_fallback_interval:
            point, lower80, upper80, _, _ = result.conformal.predict_intervals(x_arr)
            pred = float(point[0])
            p10 = float(lower80[0])
            p90 = float(upper80[0])
        else:
            pred = float(result.model.predict(x_arr)[0])
            widening = 1.0 + 0.07 * offset
            sigma = result.holdout_residual_std * widening
            p10 = pred - 1.28 * sigma
            p90 = pred + 1.28 * sigma

        out.append(
            ForecastRow(
                forecast_date=target_date,
                predicted_qty=max(0.0, pred),
                p10=max(0.0, p10),
                p90=max(0.0, p90),
            )
        )
        rolling.iloc[-1, rolling.columns.get_loc("qty")] = pred

    return out
