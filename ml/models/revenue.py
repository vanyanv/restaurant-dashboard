"""XGBoost daily-revenue forecaster.

One model per store (small scale — 5 stores). Trains on lag/rolling
features with an 80/10/10 chronological split (train / conformal calibration
/ held-out evaluation), then forecasts the next horizon_days iteratively
(each predicted day becomes the lag-1 input for the next).

Prediction intervals are calibrated via split conformal prediction
(MAPIE, see `ml/evaluation/conformal.py`). When the calibration window
would be smaller than 10 rows we fall back to the legacy residual-std
heuristic and tag the flavor with `-fallback`.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd
from xgboost import XGBRegressor

from ml.evaluation.conformal import ConformalWrapper, wrap_xgboost_conformal
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


# MAPIE's 95% wrapper needs >=20 samples (1/alpha). Below that the inner
# call raises, so anything smaller forces the legacy-residual-std fallback.
MIN_CALIBRATION_ROWS = 20


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
    conformal: Optional[ConformalWrapper] = None
    uses_fallback_interval: bool = False


@dataclass
class ForecastRow:
    forecast_date: dt.date
    predicted_revenue: float
    p10: float
    p90: float


def _conformal_split(feats: pd.DataFrame, cols: list[str]) -> tuple[
    pd.DataFrame, pd.DataFrame, pd.DataFrame
]:
    """80/10/10 chronological split — train / calibration / held-out.

    Drops rows missing any feature so the calibration set is dense, then
    splits by index position. Returns (train, calib, holdout).
    """
    clean = feats.dropna(subset=cols).reset_index(drop=True)
    n = len(clean)
    n_train = int(n * 0.80)
    n_calib = int(n * 0.10)
    train_df = clean.iloc[:n_train]
    calib_df = clean.iloc[n_train : n_train + n_calib]
    holdout_df = clean.iloc[n_train + n_calib :]
    return train_df, calib_df, holdout_df


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

    train_df, calib_df, holdout_df = _conformal_split(feats, cols)
    if train_df.empty or holdout_df.empty:
        return None

    base = XGBRegressor(
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

    uses_fallback = len(calib_df) < MIN_CALIBRATION_ROWS
    conformal: Optional[ConformalWrapper] = None
    if uses_fallback:
        # Recombine train + calib to keep the fitting set as large as possible
        # when conformal coverage isn't available anyway.
        legacy_train, legacy_holdout = split_train_holdout(feats, holdout_days=30)
        if legacy_train.empty or legacy_holdout.empty:
            return None
        base.fit(legacy_train[cols], legacy_train["revenue"])
        eval_df = legacy_holdout
    else:
        X_train = train_df[cols].to_numpy(dtype=float, na_value=np.nan)
        y_train = train_df["revenue"].to_numpy(dtype=float)
        X_calib = calib_df[cols].to_numpy(dtype=float, na_value=np.nan)
        y_calib = calib_df["revenue"].to_numpy(dtype=float)
        conformal = wrap_xgboost_conformal(base, X_train, y_train, X_calib, y_calib)
        eval_df = holdout_df

    preds = base.predict(eval_df[cols])
    actuals = eval_df["revenue"].to_numpy()
    safe_actuals = np.where(actuals == 0, 1e-6, actuals)
    mape = float(np.mean(np.abs((preds - actuals) / safe_actuals)))
    mae = float(np.mean(np.abs(preds - actuals)))
    holdout_residual_std = float(np.std(preds - actuals, ddof=1)) if len(preds) > 1 else 0.0

    if uses_fallback:
        flavor = f"{flavor}-fallback"
    else:
        flavor = f"{flavor}-conformal"

    return TrainResult(
        model=base,
        mape=mape,
        mae=mae,
        sample_size=int(len(train_df) if not uses_fallback else len(eval_df)),
        holdout_residual_std=holdout_residual_std,
        flavor=flavor,
        signal_coverage=signal_coverage,
        feature_names=tuple(cols),
        conformal=conformal,
        uses_fallback_interval=uses_fallback,
    )


def forecast(store_id: str, result: TrainResult, horizon_days: int = 14) -> list[ForecastRow]:
    history = load_daily_revenue(store_id)
    if history.empty:
        return []

    feats = build_features(history)
    last_date = feats["date"].max().date()
    cols = list(result.feature_names or feature_columns())
    # The pipeline always uses weather-events when the flavor starts with it.
    is_enriched = result.flavor.startswith("weather-events")
    external_daily = pd.DataFrame()
    if is_enriched:
        external_daily = load_revenue_external_signals(
            store_id,
            history["date"].min().date(),
            last_date + dt.timedelta(days=horizon_days),
        )

    rolling = feats.copy()
    out: list[ForecastRow] = []
    # Iteratively predict, appending each prediction as if observed so the
    # next day's lag features see it.
    for offset in range(1, horizon_days + 1):
        target_date = last_date + dt.timedelta(days=offset)
        new_row_seed = pd.DataFrame({"date": [pd.Timestamp(target_date)], "revenue": [np.nan]})
        rolling = pd.concat([rolling[["date", "revenue"]], new_row_seed], ignore_index=True)
        if is_enriched:
            rolling = build_enriched_features(rolling, external_daily)
        else:
            rolling = build_features(rolling)
        feat_row = rolling.iloc[-1]
        x = feat_row[cols].to_frame().T
        x_arr = x.to_numpy(dtype=float, na_value=np.nan)

        if result.conformal is not None and not result.uses_fallback_interval:
            point, lower80, upper80, _, _ = result.conformal.predict_intervals(x_arr)
            pred = float(point[0])
            p10 = float(lower80[0])
            p90 = float(upper80[0])
        else:
            pred = float(result.model.predict(x_arr)[0])
            # Legacy ±1.28 SD ≈ 80% PI from holdout residual std, widened by
            # 1 + 0.05 * offset to reflect compounding uncertainty.
            widening = 1.0 + 0.05 * offset
            sigma = result.holdout_residual_std * widening
            p10 = pred - 1.28 * sigma
            p90 = pred + 1.28 * sigma

        out.append(
            ForecastRow(
                forecast_date=target_date,
                predicted_revenue=max(0.0, pred),
                p10=max(0.0, p10),
                p90=max(0.0, p90),
            )
        )
        rolling.iloc[-1, rolling.columns.get_loc("revenue")] = pred

    return out


def model_safe_predict(model: XGBRegressor, x: pd.DataFrame) -> float:
    """Predict a single row with NaN-tolerance.

    Retained for callers that imported the helper. Iterative forecasting can
    produce a NaN in `growth_rate_90` when the trailing 90-day mean was zero.
    XGBoost handles NaN natively when called on a numpy array.
    """
    arr = x.to_numpy(dtype=float, na_value=np.nan)
    return float(model.predict(arr)[0])
