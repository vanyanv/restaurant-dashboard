"""Hollywood-prior transfer forecasts.

For each `warming_up` store, project Hollywood's recent forecasts onto the
new store using a multiplicative scalar (ratio of trailing 14-day actuals).
Used until the store accumulates enough native history to beat the transfer
forecast on WAPE - see ml.lifecycle.

Architectural rule (per spec §1.2): no codebase default for the initial
scalar - operators set it per store at registration so the choice is intentional.
If a store has fewer than 7 actuals AND no initialTransferScalar, the writer
emits a JobRun warning and skips the store for that night.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


_MIN_ACTUALS_FOR_RATIO = 7
INTERVAL_WIDEN_MULTIPLIER = 1.5


def compute_transfer_scalar(
    *,
    new_store_actuals: list[float],
    hollywood_actuals_same_window: list[float],
    initial_scalar: Optional[float],
) -> float:
    """Return the multiplicative scalar that maps Hollywood forecasts to the
    new store's expected revenue.

    Rule (spec §1.2):
      * >= 7 actuals and Hollywood mean > 0 -> scalar = mean(new) / mean(holly).
      * Otherwise -> use `initial_scalar` (operator-set).
      * If neither path is available, raise ValueError so the caller fails
        loud and the nightly job records a JobRun warning.
    """
    n = min(len(new_store_actuals), len(hollywood_actuals_same_window))
    if n >= _MIN_ACTUALS_FOR_RATIO:
        new_mean = sum(new_store_actuals[:n]) / n
        holly_mean = sum(hollywood_actuals_same_window[:n]) / n
        if holly_mean > 0:
            return new_mean / holly_mean
        # Hollywood window happens to be zero - fall through to initial.
    if initial_scalar is None:
        raise ValueError(
            "initial_scalar required: store has fewer than "
            f"{_MIN_ACTUALS_FOR_RATIO} actuals and no operator-set "
            "initialTransferScalar to fall back on"
        )
    return float(initial_scalar)


def widened_interval(
    *,
    point: float,
    p10: Optional[float],
    p90: Optional[float],
) -> tuple[float, Optional[float], Optional[float]]:
    """Widen a (p10, p90) interval by INTERVAL_WIDEN_MULTIPLIER about the point.

    Half-width grows by the multiplier; p10 clamped at 0 (no negative revenue
    or quantities). When either bound is None, return it unchanged.
    """
    if p10 is None or p90 is None:
        return point, p10, p90
    new_p10 = point - (point - p10) * INTERVAL_WIDEN_MULTIPLIER
    new_p90 = point + (p90 - point) * INTERVAL_WIDEN_MULTIPLIER
    if new_p10 < 0:
        new_p10 = 0.0
    return point, new_p10, new_p90
