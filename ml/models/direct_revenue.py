"""Direct multi-horizon daily-revenue forecaster, global across stores.

The recursive forecaster in `ml/models/revenue.py` predicts day 1, writes that
prediction back as if observed, and uses it as `lag_1` for day 2. Error
compounds multiplicatively across the horizon, and every piece of interval
machinery in this package exists to paper over that: a flat 5%/day widening
constant, then measured per-horizon widths to correct the constant, then a
calibration epoch to keep the measurement honest, then F16 to make the horizon
key line up at all.

Direct multi-horizon removes the cause. One model is trained on
(features known at anchor `a`, target at `a + h`) pairs for every h in the
horizon set, with `h` itself as a feature. Nothing is fed back, so nothing
compounds; and because each horizon has its own residual distribution, the
conformal interval for h is calibrated on h's own residuals rather than
stretched from the one-step case.

**Global (F13).** `train_direct` takes a mapping of store -> history and fits a
single model with `store` as a categorical. With one `ready` store that is a
no-op, and it is built this way so GLN and VNYS join by opening rather than by
a rewrite. Pooling is what lets a thin series borrow weekday shape from a thick
one; it is also what `ml/transfer/hollywood_prior.py` was hand-built to
approximate.

**Known limitation, shared with the recursive model.** A gradient-boosted
tree cannot extrapolate: it predicts within the range of targets it was fit
on. On a series whose level drifts outside that range the error is dominated
by the drift at every horizon alike, and no interval calibration can repair
it — the widths simply come out uniformly wide. Lag and rolling features
carry the level in-range for a mean-reverting series, which is what a
restaurant's revenue is; a store in sustained growth is the case to watch,
and the fix there is to predict a ratio to a trailing mean rather than a
level. `test_width_grows_with_horizon_when_the_series_actually_diffuses`
documents the boundary.

**Measured result, 2026-08-21: this loses. It is not in the production path.**

Backtested against the recursive model on Hollywood, 12 folds x 14-day horizon
(n=168 each), three variants:

    variant                      WAPE mean   bias @ h1   horizons won
    recursive (production)          8.66%      +0.19%          --
    direct, level target           13.31%     -13.73%        0 / 14
      + deployment refit           11.30%      -9.86%        2 / 14
      + ratio target               11.25%      -8.88%        2 / 14

Each fix worked in the direction predicted and none of them closed the gap.
The residual -8.9% bias says the h-blocks are dominated by older, lower-level
history: at h=14 the model must predict from features fourteen days stale, and
with ~500 usable rows per horizon block from a single series there is not
enough signal to learn fourteen distinct mappings.

That is the textbook condition for direct multi-horizon to lose. It is a
data-hungry method whose advantage comes from pooling many series — which is
the same reason F13 is currently inert. Direct and global are a package, and
the global half is unavailable until GLN and VNYS reach `ready`.

So: keep `ml/models/revenue.py` in production, keep this tested and behind the
backtest, and re-run `python -m ml.backtest --store <id> --direct` when there
are three stores. The recursion is not costing what the audit assumed; on one
series it is buying a fresher `lag_1` at every step, and that is worth more
here than removing the compounding.
"""
from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass, field
from typing import Iterable, Mapping, Optional, Sequence

import numpy as np
import pandas as pd
from xgboost import XGBRegressor

from ml.evaluation import metrics
from ml.features.revenue import build_features, feature_columns

_LOG = logging.getLogger(__name__)

HORIZON_COLUMN = "horizon"
STORE_COLUMN = "store"
TARGET_COLUMN = "target"
SCALE_COLUMN = "target_scale"

#: Column used to normalise the target. Known at the anchor (every rolling
#: feature is shifted), so dividing by it leaks nothing.
SCALE_FEATURE = "roll_28"

#: Below this the trailing mean is too small to divide by safely.
MIN_SCALE = 1.0

#: Feature rows needed before a fit is worth attempting, per store.
MIN_ROWS_PER_STORE = 60

#: Share of each store's history held back, chronologically, to calibrate
#: interval half-widths. Split per store so one store cannot donate all the
#: calibration rows.
CALIBRATION_FRACTION = 0.15

#: Calibration rows a horizon needs before its own quantile is trusted. Below
#: this the pooled quantile across horizons is used instead — wrong in
#: direction but not wildly, and far better than a quantile of three numbers.
MIN_CALIBRATION_ROWS_PER_HORIZON = 8

#: p10/p90 is an 80% interval.
_INTERVAL_QUANTILE = 0.80


def direct_feature_columns() -> list[str]:
    """Base features, plus the two that make this model direct and global."""
    return [*feature_columns(), HORIZON_COLUMN, STORE_COLUMN]


@dataclass
class DirectTrainResult:
    model: XGBRegressor
    feature_names: tuple[str, ...]
    horizons: tuple[int, ...]
    stores: tuple[str, ...]
    #: Half-width per horizon as a fraction of the prediction, measured on that
    #: horizon's own calibration residuals.
    half_widths: dict[int, float]
    store_dtype: pd.CategoricalDtype
    wape: float
    mape: float
    mae: float
    #: Rows the *scored* model was fit on — the 85% slice, disjoint from the
    #: calibration rows the reported wape/mape/mae were measured on.
    sample_size: int
    #: Rows the *shipped* model was fit on, after the deployment refit.
    deploy_sample_size: int = 0
    #: 'ratio' predicts target / trailing-mean; 'level' predicts dollars.
    target_mode: str = "ratio"
    flavor: str = "direct-global"
    holdout_y_true: np.ndarray = field(default_factory=lambda: np.array([], dtype=float))
    holdout_y_pred: np.ndarray = field(default_factory=lambda: np.array([], dtype=float))


@dataclass
class DirectForecastRow:
    forecast_date: dt.date
    horizon: int
    predicted_revenue: float
    p10: float
    p90: float


def build_direct_frame(
    feats: pd.DataFrame,
    horizons: Iterable[int],
    target_mode: str = "ratio",
) -> pd.DataFrame:
    """Stack one block per horizon: features at an anchor, target h steps on.

    A feature row produced by `build_features` at position i is computed
    entirely from data at or before i-1 (every lag and rolling is shifted). So
    treating i-1 as the anchor, the target for horizon h sits at position
    i + h - 1, and h = 1 recovers "predict the day this feature row describes".

    Nothing in the feature block depends on h. That is the property that makes
    this leak-free, and `test_features_are_identical_across_horizons` pins it.
    """
    if feats.empty:
        return feats

    blocks: list[pd.DataFrame] = []
    for h in horizons:
        block = feats.copy()
        block[HORIZON_COLUMN] = int(h)
        block[TARGET_COLUMN] = feats["revenue"].shift(-(int(h) - 1))
        blocks.append(block)

    frame = pd.concat(blocks, ignore_index=True)
    frame = frame.dropna(subset=[TARGET_COLUMN])

    # `ratio` divides the target by a trailing mean known at the anchor. A
    # gradient-boosted tree predicts within the range of targets it was fit on,
    # so on a rising series a level target is averaged downward at every leaf —
    # measured on Hollywood as bias -9.9% at h1 even after the deployment refit.
    # A multiplier is stationary: the same 1.05 means the same thing at $4k and
    # $8k, and the level is restored by multiplying back at predict time.
    frame[SCALE_COLUMN] = (
        frame[SCALE_FEATURE] if target_mode == "ratio" else 1.0
    )
    frame = frame[frame[SCALE_COLUMN].notna() & (frame[SCALE_COLUMN] >= MIN_SCALE)]
    if target_mode == "ratio":
        frame[TARGET_COLUMN] = frame[TARGET_COLUMN] / frame[SCALE_COLUMN]
    return frame.reset_index(drop=True)


def _prepare(
    histories: Mapping[str, pd.DataFrame],
    horizons: Sequence[int],
    target_mode: str = "ratio",
) -> Optional[pd.DataFrame]:
    """Per-store features -> one stacked frame tagged with store and horizon."""
    frames: list[pd.DataFrame] = []
    for store_id, history in histories.items():
        if history is None or history.empty:
            continue
        feats = build_features(history)
        feats = feats.dropna(subset=[*feature_columns(), "revenue"])
        if len(feats) < MIN_ROWS_PER_STORE:
            _LOG.info("direct: store %s has %d usable rows, skipped", store_id, len(feats))
            continue
        frame = build_direct_frame(feats, horizons, target_mode)
        frame[STORE_COLUMN] = store_id
        frames.append(frame)

    if not frames:
        return None
    return pd.concat(frames, ignore_index=True).sort_values("date").reset_index(drop=True)


def _split_by_store(frame: pd.DataFrame, fraction: float) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Chronological per-store split. Never random, never pooled.

    Splitting the pooled frame by time would hand the whole calibration set to
    whichever store has the most recent data.
    """
    fit_parts, calib_parts = [], []
    for _store, part in frame.groupby(STORE_COLUMN, observed=True):
        part = part.sort_values("date")
        cut = int(len(part) * (1.0 - fraction))
        fit_parts.append(part.iloc[:cut])
        calib_parts.append(part.iloc[cut:])
    return (
        pd.concat(fit_parts, ignore_index=True) if fit_parts else pd.DataFrame(),
        pd.concat(calib_parts, ignore_index=True) if calib_parts else pd.DataFrame(),
    )


def _half_widths(calib: pd.DataFrame, preds: np.ndarray) -> dict[int, float]:
    """Per-horizon half-width, as a fraction of the prediction.

    Symmetric and taken on |relative error|, for the same reason
    `horizon_calibration` gives: signed quantiles would re-centre the band
    around whatever bias the calibration-era model had.
    """
    actual = calib[TARGET_COLUMN].to_numpy(dtype=float)
    safe = np.where(np.abs(preds) < 1e-9, np.nan, preds)
    rel = np.abs((actual - preds) / safe)

    pooled = float(np.nanquantile(rel, _INTERVAL_QUANTILE)) if len(rel) else 0.0

    out: dict[int, float] = {}
    for h, idx in calib.groupby(HORIZON_COLUMN, observed=True).indices.items():
        errs = rel[idx]
        errs = errs[np.isfinite(errs)]
        if len(errs) >= MIN_CALIBRATION_ROWS_PER_HORIZON:
            out[int(h)] = float(np.quantile(errs, _INTERVAL_QUANTILE))
        else:
            out[int(h)] = pooled
    return out


def train_direct(
    histories: Mapping[str, pd.DataFrame],
    horizons: Iterable[int] = range(1, 15),
    target_mode: str = "ratio",
) -> Optional[DirectTrainResult]:
    """Fit one model across all supplied stores and horizons."""
    horizons = tuple(int(h) for h in horizons)
    frame = _prepare(histories, horizons, target_mode)
    if frame is None or frame.empty:
        return None

    store_dtype = pd.CategoricalDtype(categories=sorted(frame[STORE_COLUMN].unique()))
    frame[STORE_COLUMN] = frame[STORE_COLUMN].astype(store_dtype)

    fit_df, calib_df = _split_by_store(frame, CALIBRATION_FRACTION)
    if fit_df.empty or calib_df.empty:
        return None

    cols = direct_feature_columns()
    model = XGBRegressor(
        n_estimators=500,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.85,
        colsample_bytree=0.85,
        reg_alpha=0.1,
        reg_lambda=1.0,
        objective="reg:squarederror",
        random_state=42,
        n_jobs=2,
        enable_categorical=True,
        tree_method="hist",
    )
    model.fit(fit_df[cols], fit_df[TARGET_COLUMN])

    # Back to dollars before anything is scored or calibrated: a WAPE on
    # multipliers is not comparable to any other number in this repo.
    scale = calib_df[SCALE_COLUMN].to_numpy(dtype=float)
    calib_preds = model.predict(calib_df[cols]) * scale
    dollar_calib = calib_df.assign(**{TARGET_COLUMN: calib_df[TARGET_COLUMN] * scale})
    half_widths = _half_widths(dollar_calib, calib_preds)

    actual = dollar_calib[TARGET_COLUMN].to_numpy(dtype=float)
    wape = metrics.wape(actual, calib_preds)
    mape = metrics.mape(actual, calib_preds)
    mae = metrics.mae(actual, calib_preds)

    # Deployment refit, AFTER the score above.
    #
    # `model` was fit on the first 85% so the calibration slice stayed disjoint
    # and the half-widths mean something. That left the estimator that actually
    # ships blind to the newest 15% of the window — and the first production
    # backtest showed exactly what that costs: bias -13.7% at h1, losing at 14
    # of 14 horizons against the recursive model, a uniform under-prediction on
    # a store whose level has been rising. `ml/models/revenue.py` documents the
    # same failure and takes the same remedy.
    #
    # The reported wape/mape/mae above are untouched: they score the pre-refit
    # model on rows it never saw, which is what makes them comparable to
    # anything else. The half-widths stay as calibrated, which leaves them
    # mildly conservative around a better point.
    model.fit(frame[cols], frame[TARGET_COLUMN])

    return DirectTrainResult(
        model=model,
        feature_names=tuple(cols),
        horizons=horizons,
        stores=tuple(store_dtype.categories),
        half_widths=half_widths,
        store_dtype=store_dtype,
        wape=float(wape) if wape is not None else float("inf"),
        mape=float(mape) if mape is not None else float("inf"),
        mae=float(mae or 0.0),
        sample_size=int(len(fit_df)),
        target_mode=target_mode,
        deploy_sample_size=int(len(frame)),
        holdout_y_true=actual,
        holdout_y_pred=np.asarray(calib_preds, dtype=float),
    )


def forecast_direct(
    result: DirectTrainResult,
    store_id: str,
    history: pd.DataFrame,
    horizon_days: int = 14,
    horizons: Optional[Sequence[int]] = None,
) -> list[DirectForecastRow]:
    """One independent prediction per horizon from the last observed day.

    Every row is produced from observed data alone, so truncating or reordering
    the horizon set cannot change any other row's value.
    """
    if store_id not in set(result.stores):
        raise ValueError(
            f"store {store_id!r} is not in the training set {result.stores!r}"
        )

    wanted = tuple(int(h) for h in (horizons if horizons is not None else range(1, horizon_days + 1)))
    if history is None or history.empty:
        return []

    feats = build_features(history)
    feats = feats.dropna(subset=feature_columns())
    if feats.empty:
        return []

    # The anchor is the last row whose features are fully observed; its own
    # `date` is the day horizon 1 predicts.
    anchor = feats.iloc[[-1]].copy()
    last_observed = history["date"].max().date()
    cols = list(result.feature_names)

    rows: list[DirectForecastRow] = []
    for h in wanted:
        x = anchor.copy()
        x[HORIZON_COLUMN] = h
        x[STORE_COLUMN] = pd.Categorical([store_id], dtype=result.store_dtype)
        raw = float(result.model.predict(x[cols])[0])
        if result.target_mode == "ratio":
            scale = float(anchor[SCALE_FEATURE].iloc[0])
            pred = raw * scale if np.isfinite(scale) and scale >= MIN_SCALE else raw
        else:
            pred = raw

        half = pred * result.half_widths.get(h, max(result.half_widths.values(), default=0.0))
        rows.append(DirectForecastRow(
            forecast_date=last_observed + dt.timedelta(days=h),
            horizon=h,
            predicted_revenue=max(0.0, pred),
            p10=max(0.0, pred - half),
            p90=max(0.0, pred + half),
        ))

    return rows
