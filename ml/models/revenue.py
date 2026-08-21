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

import logging

import datetime as dt
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd
from xgboost import DMatrix, XGBRegressor

from ml.evaluation import metrics
from ml.evaluation.conformal import ConformalWrapper, wrap_xgboost_conformal
from ml.evaluation.cqr import CQRWrapper, fit_cqr
from ml.models.attribution import build_attribution
from ml.features.revenue import (
    build_enriched_features,
    build_features,
    enriched_feature_columns,
    feature_columns,
    load_daily_revenue,
    load_revenue_external_signals,
    split_train_holdout,
)
from ml.features.external_signals import (
    drop_dead_signal_columns,
    external_signal_coverage,
    external_signal_coverage_by_family,
    is_external_signal_column,
)


# MAPIE's 95% wrapper needs >=20 samples (1/alpha). Below that the inner
# call raises, so anything smaller forces the legacy-residual-std fallback.
_LOG = logging.getLogger(__name__)

MIN_CALIBRATION_ROWS = 20

# Per-day interval widening factor for multi-step forecasts. Iterative
# forecasting compounds error as the horizon grows, but the conformal interval
# (MAPIE method="base") is a single 1-step-calibrated half-width applied to every
# row — so without widening the long horizons systematically under-cover
# (incident #38: REVENUE 80% coverage measured ~0.60). The conformal path anchors
# at offset-1 (its calibration IS the 1-step case, so horizon 1 stays unchanged);
# the residual-std fallback anchors at offset (its holdout std already mixes
# horizons). k=0.05 → +5% width per extra day, ~+65% by day 14.
HORIZON_WIDENING_PER_DAY = 0.05


@dataclass
class TrainResult:
    model: XGBRegressor
    mape: float
    #: Weighted absolute percentage error on the same holdout rows. Scale-free
    #: and defined when an actual is zero, which MAPE is not — prefer it in gates.
    wape: float
    mae: float
    sample_size: int
    holdout_residual_std: float
    flavor: str = "baseline"
    signal_coverage: float = 0.0
    #: Per-family coverage of the external signals, e.g.
    #: {"weather": 1.0, "events": 0.0}. Empty for baseline runs.
    signal_families: dict = field(default_factory=dict)
    feature_names: tuple[str, ...] = ()
    conformal: Optional[ConformalWrapper] = None
    #: Conformalized quantile regression band (F14). When set, `forecast()`
    #: takes p10/p90 from here instead of the symmetric conformal width. The
    #: point forecast is unchanged either way, so the two are comparable.
    cqr: Optional[CQRWrapper] = None
    uses_fallback_interval: bool = False
    # Holdout arrays used by the seasonal-naive promotion gate; empty arrays
    # mean "no holdout exposed" (back-compat default).
    holdout_y_true: np.ndarray = field(default_factory=lambda: np.array([], dtype=float))
    holdout_y_pred: np.ndarray = field(default_factory=lambda: np.array([], dtype=float))


@dataclass
class ForecastRow:
    forecast_date: dt.date
    #: Steps ahead of the last *observed* day, 1-based — the offset this row
    #: was actually produced at. Recorded rather than left to be re-derived
    #: downstream: `forecastDate - generatedAt::date` is 0 for the 1-step
    #: forecast on a normal night, and shifts whenever
    #: `trim_incomplete_trailing_days` drops an extra trailing day (F16).
    horizon: int
    predicted_revenue: float
    p10: float
    p90: float
    #: TreeSHAP waterfall — {"base": float, "groups": [{"label", "value"}]} —
    #: summing to predicted_revenue. None if the booster wouldn't produce one.
    attribution: Optional[dict] = None


def _conformal_split(feats: pd.DataFrame, cols: list[str]) -> tuple[
    pd.DataFrame, pd.DataFrame, pd.DataFrame
]:
    """80/10/10 chronological split — train / calibration / held-out.

    Drops rows missing any feature so the calibration set is dense, then
    splits by index position. Returns (train, calib, holdout).

    `revenue` is dropped alongside the features because an unobserved day now
    carries NaN rather than a fabricated $0 (F1). A NaN target must never reach
    `.fit()`, and it must never be scored as if it were an actual.
    """
    # Explicit chronological sort: calibration/holdout MUST be strictly future of train.
    clean = (
        feats.dropna(subset=[*cols, "revenue"])
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


def train(
    store_id: str,
    *,
    enriched: bool = False,
    history: Optional[pd.DataFrame] = None,
    interval_method: str = "conformal",
) -> Optional[TrainResult]:
    """Fit the deployable model for one store.

    `history` overrides the DB load. The backtest harness passes a series
    truncated at a cutoff so the real training path can be replayed as it
    would have run that night — without monkeypatching production code.
    """
    if history is None:
        history = load_daily_revenue(store_id)
    if history.empty or len(history) < 60:
        # Need enough history for lag-28 + rolling-28 to be meaningful.
        return None

    external_daily = pd.DataFrame()
    signal_coverage = 0.0
    signal_families: dict[str, float] = {}
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
        # Gate per family, not on the max across families (F6). A dead feed
        # writes its columns as constant fill values; carrying them into the fit
        # dilutes every split candidate while the aggregate coverage number
        # still reads 1.0 because the *other* family landed.
        signal_families = external_signal_coverage_by_family(external_daily)
        cols, dead_cols = drop_dead_signal_columns(
            enriched_feature_columns(), signal_families
        )
        if dead_cols:
            _LOG.warning(
                "revenue.train: dropping %s dead signal column(s) — coverage %s",
                len(dead_cols),
                signal_families,
            )
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
    cqr: Optional[CQRWrapper] = None
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
        if interval_method == "cqr":
            # Same split, same rows. Only the band changes — the point
            # forecast stays the squared-error model above, so a backtest
            # comparing the two isolates band shape from point accuracy.
            try:
                cqr = fit_cqr(
                    X_train, y_train, X_calib, y_calib, alpha=0.2,
                    # The point forecast stays the squared-error model, so a
                    # median booster would be a wasted fit every night.
                    fit_median=False,
                )
            except ValueError as exc:
                _LOG.warning("cqr unavailable, falling back to conformal: %s", exc)

    preds = base.predict(eval_df[cols])
    actuals = eval_df["revenue"].to_numpy(dtype=float)
    # One definition of every metric, shared with the evaluator (F2). The
    # inline version here substituted 1e-6 for a zero actual, so a single
    # closed day turned MAPE into ~1e8 — and `should_promote_enriched` gates
    # on exactly that number. `metrics.mape` masks zeros instead; WAPE is
    # carried alongside because it stays defined when every actual is zero.
    mape = metrics.mape(actuals, preds)
    mape = float(mape) if mape is not None else float("inf")
    wape = metrics.wape(actuals, preds)
    wape = float(wape) if wape is not None else float("inf")
    mae = float(metrics.mae(actuals, preds) or 0.0)
    holdout_residual_std = float(np.std(preds - actuals, ddof=1)) if len(preds) > 1 else 0.0

    if uses_fallback:
        flavor = f"{flavor}-fallback"
    else:
        flavor = f"{flavor}-cqr" if cqr is not None else f"{flavor}-conformal"
        # Deployment refit, AFTER the holdout score above.
        #
        # `base` was fit on the train slice alone so the calibration slice stays
        # disjoint and conformal keeps its guarantee. That left the estimator
        # that actually ships blind to the newest 20% of the window — on
        # Hollywood, 91 days whose mean ran 7.3% above what it trained on — and a
        # level error like that compounds through recursive multi-step
        # forecasting. Backtested through the real train+forecast path over 10
        # chronological cutoffs at 14-day horizons (n=140):
        #
        #     train-slice only      bias -5.4%   MAPE 10.4%
        #     refit on all history  bias -1.9%   MAPE  9.4%
        #
        # `conformal.point_model` IS this object, so refitting in place moves the
        # forecast point too. The interval half-widths stay as calibrated on the
        # train-slice model's residuals, which makes them mildly conservative
        # around a better point — the safe direction, since measured coverage at
        # one day out was 71% against an 80% target.
        #
        # `mape` above is untouched: it scores the pre-refit model on a holdout
        # it never saw, and `_select_result` needs that to choose baseline vs
        # enriched honestly.
        deploy_df = feats.dropna(subset=cols)
        base.fit(deploy_df[cols], deploy_df["revenue"])

    return TrainResult(
        model=base,
        mape=mape,
        wape=wape,
        mae=mae,
        sample_size=int(len(train_df) if not uses_fallback else len(eval_df)),
        holdout_residual_std=holdout_residual_std,
        flavor=flavor,
        signal_coverage=signal_coverage,
        signal_families=signal_families,
        feature_names=tuple(cols),
        conformal=conformal,
        cqr=cqr,
        uses_fallback_interval=uses_fallback,
        holdout_y_true=np.asarray(actuals, dtype=float),
        holdout_y_pred=np.asarray(preds, dtype=float),
    )


def forecast(
    store_id: str,
    result: TrainResult,
    horizon_days: int = 14,
    horizon_widths: Optional[dict[int, float]] = None,
    history: Optional[pd.DataFrame] = None,
) -> list[ForecastRow]:
    """Forecast forward from the last observed day.

    `horizon_widths` maps horizon (1-based) to a half-width expressed as a
    fraction of the prediction, measured from reconciled history by
    `ml.evaluation.horizon_calibration`. When a horizon is present there it
    replaces HORIZON_WIDENING_PER_DAY, which inflated the one-step conformal
    width by a flat 5% a day and produced 71% coverage at one day out against
    97% at eight. Horizons with too little history fall through to the old path.
    """
    if history is None:
        history = load_daily_revenue(store_id)
    if history.empty:
        return []

    feats = build_features(history)
    last_date = feats["date"].max().date()
    cols = list(result.feature_names or feature_columns())
    # Derive enrichment from the columns actually fit, not from the flavor
    # string: a dead family is stripped from `cols` (F6) while the flavor is
    # unchanged, so the string is no longer a reliable witness of the schema.
    is_enriched = any(is_external_signal_column(c) for c in cols)
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

        measured = (horizon_widths or {}).get(offset)

        if result.cqr is not None and not result.uses_fallback_interval:
            # F14: the band comes from conditional quantiles, the point from
            # the squared-error model as before. Widths vary by day, and the
            # two sides are free to differ.
            pred = float(result.model.predict(x_arr)[0])
            cqr_lo, cqr_hi = result.cqr.predict_interval(x_arr)
            lo_raw, hi_raw = float(cqr_lo[0]), float(cqr_hi[0])
            # The quantile models and the point model can disagree; never ship
            # an interval that excludes its own prediction.
            lo_raw, hi_raw = min(lo_raw, pred), max(hi_raw, pred)
            if measured is not None:
                half = pred * measured
                p10, p90 = pred - half, pred + half
            else:
                # Same horizon widening as the conformal path, applied to each
                # side separately so asymmetry survives the stretch.
                widening = 1.0 + HORIZON_WIDENING_PER_DAY * (offset - 1)
                p10 = pred - (pred - lo_raw) * widening
                p90 = pred + (hi_raw - pred) * widening
        elif result.conformal is not None and not result.uses_fallback_interval:
            point, lower80, upper80, _, _ = result.conformal.predict_intervals(x_arr)
            pred = float(point[0])
            if measured is not None:
                half = pred * measured
                p10, p90 = pred - half, pred + half
            else:
                # The conformal half-width is 1-step-calibrated; inflate it for
                # the extra forecast steps so coverage holds across the horizon.
                # Anchor at offset-1 → horizon 1 keeps the raw 1-step width.
                widening = 1.0 + HORIZON_WIDENING_PER_DAY * (offset - 1)
                p10 = pred - (pred - float(lower80[0])) * widening
                p90 = pred + (float(upper80[0]) - pred) * widening
        else:
            pred = float(result.model.predict(x_arr)[0])
            if measured is not None:
                half = pred * measured
                p10, p90 = pred - half, pred + half
            else:
                # Legacy ±1.28 SD ≈ 80% PI from holdout residual std, widened by
                # 1 + k * offset to reflect compounding uncertainty.
                widening = 1.0 + HORIZON_WIDENING_PER_DAY * offset
                sigma = result.holdout_residual_std * widening
                p10 = pred - 1.28 * sigma
                p90 = pred + 1.28 * sigma

        out.append(
            ForecastRow(
                forecast_date=target_date,
                horizon=offset,
                predicted_revenue=max(0.0, pred),
                p10=max(0.0, p10),
                p90=max(0.0, p90),
                attribution=_attribution_for(result.model, x_arr, cols, pred),
            )
        )
        rolling.iloc[-1, rolling.columns.get_loc("revenue")] = pred

    return out


def _attribution_for(
    model: XGBRegressor,
    x_arr: "np.ndarray",
    cols: list[str],
    predicted: float,
) -> Optional[dict]:
    """Exact TreeSHAP for one row, grouped for the owner.

    `pred_contribs=True` returns one value per feature plus a trailing bias
    term, and they sum to the raw prediction — no surrogate model, no extra
    dependency, one call against the booster already in memory.

    Attribution is a nice-to-have on top of a forecast, so a failure here must
    never cost the forecast itself: the row simply ships without a waterfall.
    """
    try:
        booster = model.get_booster()
        names = list(booster.feature_names) if booster.feature_names else list(cols)
        contribs = booster.predict(
            DMatrix(x_arr, feature_names=names), pred_contribs=True
        )[0]
        base_value = float(contribs[-1])
        feature_contribs = [float(v) for v in contribs[:-1]]
        return build_attribution(
            base_value=base_value,
            feature_names=names,
            contributions=feature_contribs,
            predicted=predicted,
        )
    except Exception as exc:  # pragma: no cover - defensive
        _LOG.debug("attribution unavailable: %s", exc)
        return None


def model_safe_predict(model: XGBRegressor, x: pd.DataFrame) -> float:
    """Predict a single row with NaN-tolerance.

    Retained for callers that imported the helper. Iterative forecasting can
    produce a NaN in `growth_rate_90` when the trailing 90-day mean was zero.
    XGBoost handles NaN natively when called on a numpy array.
    """
    arr = x.to_numpy(dtype=float, na_value=np.nan)
    return float(model.predict(arr)[0])
