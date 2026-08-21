"""Conformalized quantile regression — asymmetric, conditional intervals.

`ml/evaluation/conformal.py` gives a marginal coverage guarantee, but it does
it with a single half-width applied to every row. That band is symmetric about
the point forecast, and it is the same width on a sleepy Tuesday as on a
festival Saturday. Revenue is neither symmetric (it can spike 80% and cannot go
below zero) nor homoscedastic, so a band that is right on average is wrong on
most individual days.

The production backtest shows the signature plainly: 87.5% mean coverage
against an 80% target, with horizon 3 at 58.3% and horizons 5, 12, 13 and 14 at
100%. Nothing about a single width can fix both ends of that at once.

CQR (Romano, Patterson & Candès, 2019) fits the conditional quantiles directly
and conformalises those instead of the point forecast:

    E_i = max(q_lo(x_i) − y_i,  y_i − q_hi(x_i))      on a calibration set
    Q   = the ceil((n+1)(1−α))/n empirical quantile of E
    band(x) = [q_lo(x) − Q,  q_hi(x) + Q]

`E_i` is negative when y_i sits comfortably inside the predicted quantiles, so
a *well*-calibrated pair of quantile models produces a negative Q and the band
tightens rather than widens. The finite-sample marginal guarantee survives
regardless of how badly the quantile models themselves are calibrated — the
offset is measured, not assumed. That is the property that makes this safe to
ship on top of a model nobody has tuned.

XGBoost 2.0+ fits both quantiles in one booster via `reg:quantileerror` with a
vector `quantile_alpha`, so this costs one extra fit, not two.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import Optional

import numpy as np
from xgboost import XGBRegressor

_LOG = logging.getLogger(__name__)

#: Calibration rows needed for the empirical quantile to mean anything. The
#: conformal guarantee needs ceil((n+1)(1-alpha)) <= n, i.e. n >= 1/alpha; this
#: floor is well above that so the quantile is not decided by one point.
MIN_CALIBRATION_ROWS = 20


def conformity_scores(
    lower: np.ndarray,
    upper: np.ndarray,
    actual: np.ndarray,
) -> np.ndarray:
    """CQR conformity: how far outside the predicted band each actual fell.

    Negative when the actual sat inside — that is deliberate, and it is what
    lets the offset *shrink* an over-wide band rather than only widen a narrow
    one.
    """
    lower = np.asarray(lower, dtype=float)
    upper = np.asarray(upper, dtype=float)
    actual = np.asarray(actual, dtype=float)
    return np.maximum(lower - actual, actual - upper)


def conformal_offset(scores: np.ndarray, alpha: float) -> float:
    """The finite-sample quantile of the conformity scores.

    `ceil((n + 1)(1 - alpha)) / n` rather than the plain `1 - alpha` quantile:
    the +1 is what makes the coverage guarantee hold at finite n instead of
    only asymptotically.
    """
    scores = np.asarray(scores, dtype=float)
    scores = scores[np.isfinite(scores)]
    n = len(scores)
    if n == 0:
        return 0.0
    rank = math.ceil((n + 1) * (1.0 - alpha))
    if rank >= n:
        return float(np.max(scores))
    return float(np.sort(scores)[rank - 1])


@dataclass
class CQRWrapper:
    """Fitted quantile booster plus the calibration offset it earned."""
    model: XGBRegressor
    median_model: Optional[XGBRegressor]
    offset: float
    alpha: float

    def raw_quantiles(self, X: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """The quantile models' own output, before conformalisation.

        Exposed so a caller can see how much the offset is doing — a large
        positive offset means the quantile models are under-covering and the
        guarantee is carrying the result.
        """
        pred = np.asarray(self.model.predict(X), dtype=float)
        if pred.ndim == 1:
            return pred, pred
        return pred[:, 0], pred[:, 1]

    def predict_interval(self, X: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Conformalised band. Lower is clamped never to cross upper."""
        lo, hi = self.raw_quantiles(X)
        lo = lo - self.offset
        hi = hi + self.offset
        mid = (lo + hi) / 2.0
        crossed = lo > hi
        if np.any(crossed):
            # Can only happen when a negative offset over-tightens; collapse to
            # the midpoint rather than emit an inverted interval.
            lo = np.where(crossed, mid, lo)
            hi = np.where(crossed, mid, hi)
        return lo, hi

    def predict_median(self, X: np.ndarray) -> np.ndarray:
        """Conditional median, for callers that want a point inside the band.

        Not the same estimator as the squared-error point forecast; the median
        is the natural centre of a quantile band and the two differ on a skewed
        target, which is the case this module exists for.
        """
        if self.median_model is None:
            lo, hi = self.raw_quantiles(X)
            return (lo + hi) / 2.0
        return np.asarray(self.median_model.predict(X), dtype=float)


def fit_cqr(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_calib: np.ndarray,
    y_calib: np.ndarray,
    *,
    alpha: float = 0.2,
    n_estimators: int = 400,
    max_depth: int = 4,
    learning_rate: float = 0.05,
    fit_median: bool = True,
) -> CQRWrapper:
    """Fit both conditional quantiles on train, calibrate the offset on calib.

    `X_calib` MUST be disjoint from `X_train` and, for a time series,
    chronologically after it. The caller owns that split.
    """
    y_calib = np.asarray(y_calib, dtype=float)
    if len(y_calib) < MIN_CALIBRATION_ROWS:
        raise ValueError(
            f"calibration set has {len(y_calib)} rows, need at least "
            f"{MIN_CALIBRATION_ROWS} for the conformal quantile to mean anything"
        )

    lo_a, hi_a = alpha / 2.0, 1.0 - alpha / 2.0
    common = dict(
        n_estimators=n_estimators,
        max_depth=max_depth,
        learning_rate=learning_rate,
        subsample=0.85,
        colsample_bytree=0.85,
        random_state=42,
        n_jobs=2,
        tree_method="hist",
    )

    model = XGBRegressor(
        objective="reg:quantileerror",
        quantile_alpha=np.array([lo_a, hi_a]),
        **common,
    )
    model.fit(X_train, y_train)

    median_model: Optional[XGBRegressor] = None
    if fit_median:
        median_model = XGBRegressor(
            objective="reg:quantileerror", quantile_alpha=0.5, **common
        )
        median_model.fit(X_train, y_train)

    pred = np.asarray(model.predict(X_calib), dtype=float)
    lower, upper = (pred[:, 0], pred[:, 1]) if pred.ndim > 1 else (pred, pred)
    offset = conformal_offset(conformity_scores(lower, upper, y_calib), alpha)

    _LOG.debug(
        "cqr: alpha=%.2f calib=%d offset=%.4f (positive means the quantile "
        "models were under-covering)",
        alpha, len(y_calib), offset,
    )
    return CQRWrapper(model=model, median_model=median_model, offset=offset, alpha=alpha)
