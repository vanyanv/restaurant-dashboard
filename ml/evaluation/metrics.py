"""Pure-function metrics for forecast evaluation.

Inputs are 1-D numpy arrays of equal length. Functions return `None` on
empty input and raise `ValueError` on length mismatch. No I/O, no globals.
"""

from __future__ import annotations
import numpy as np


def _validate(actuals: np.ndarray, preds: np.ndarray) -> None:
    if actuals.shape != preds.shape:
        raise ValueError(
            f"actuals shape {actuals.shape} != preds shape {preds.shape}"
        )


def wape(actuals: np.ndarray, preds: np.ndarray) -> float | None:
    _validate(actuals, preds)
    if actuals.size == 0:
        return None
    denom = float(np.sum(np.abs(actuals)))
    if denom == 0.0:
        return None
    return float(np.sum(np.abs(actuals - preds))) / denom


def mape(actuals: np.ndarray, preds: np.ndarray) -> float | None:
    _validate(actuals, preds)
    if actuals.size == 0:
        return None
    mask = actuals != 0.0
    if not mask.any():
        return None
    return float(np.mean(np.abs((actuals[mask] - preds[mask]) / actuals[mask])))


def mae(actuals: np.ndarray, preds: np.ndarray) -> float | None:
    _validate(actuals, preds)
    if actuals.size == 0:
        return None
    return float(np.mean(np.abs(actuals - preds)))


def bias(actuals: np.ndarray, preds: np.ndarray) -> float | None:
    _validate(actuals, preds)
    if actuals.size == 0:
        return None
    return float(np.mean(preds - actuals))


def interval_coverage(
    actuals: np.ndarray, lower: np.ndarray, upper: np.ndarray
) -> float | None:
    _validate(actuals, lower)
    _validate(actuals, upper)
    if actuals.size == 0:
        return None
    inside = (actuals >= lower) & (actuals <= upper)
    return float(np.mean(inside))
