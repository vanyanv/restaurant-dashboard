"""Promotion gate orchestrator.

`select_with_gate` wraps the existing `decide_promotion` pure function with:

  1. Seasonal-naive WAPE computation on the SAME holdout rows the
     enriched/baseline TrainResult was scored on.
  2. A fallback to the legacy enriched-vs-baseline-XGBoost gate (the one in
     `ml.run_nightly.should_promote_enriched`) when the model history is
     too short for a meaningful seasonal-naive baseline (<7 days for daily
     targets, <168 hours for hourly).
  3. A returned `reason` string suitable for writing into
     `MlTrainingRun.errorMessage` for audits.

Keeping this out of `ml/run_nightly.py` keeps that file small enough that
the tripwire #5 refactor pressure doesn't kick in.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional, Tuple

import numpy as np
import pandas as pd

from ml.evaluation import metrics

_LOG = logging.getLogger(__name__)


@dataclass
class PromotionDecision:
    promoted: bool
    label: str  # "enriched" | "fallback"
    reason: str


def decide_promotion(
    *,
    enriched_wape: float,
    baseline_xgb_wape: float,
    seasonal_naive_wape: float,
    improvement_threshold: float = 0.05,
) -> PromotionDecision:
    """Gate: enriched model must beat BOTH baseline-XGBoost and seasonal-naive
    by >= `improvement_threshold` relative WAPE, else falls back.

    Phase 1 scope: this gate applies only to REVENUE and BUSY_HOURS. MENU_ITEM
    training produces a single per-SKU model (no baseline-vs-enriched pair),
    so there is nothing to gate between for that target — see
    `ml.run_nightly.run_menu_items_for_store` for the explanation.
    """
    def rel_improvement(base: float) -> float:
        if base <= 0:
            return 0.0
        return (base - enriched_wape) / base

    vs_xgb = rel_improvement(baseline_xgb_wape)
    vs_naive = rel_improvement(seasonal_naive_wape)

    if vs_xgb >= improvement_threshold and vs_naive >= improvement_threshold:
        return PromotionDecision(
            promoted=True,
            label="enriched",
            reason=(
                f"enriched WAPE {enriched_wape:.4f} beats baseline-XGB "
                f"{baseline_xgb_wape:.4f} (+{vs_xgb*100:.1f}%) and seasonal-naive "
                f"{seasonal_naive_wape:.4f} (+{vs_naive*100:.1f}%)"
            ),
        )
    return PromotionDecision(
        promoted=False,
        label="fallback",
        reason=(
            f"enriched WAPE {enriched_wape:.4f} fails gate: vs XGB +{vs_xgb*100:.1f}% "
            f"vs naive +{vs_naive*100:.1f}% (threshold {improvement_threshold*100:.0f}%)"
        ),
    )


def should_promote_enriched(baseline, enriched) -> bool:
    """Legacy accuracy gate retained for the seasonal-naive fallback path.

    Promote when enriched MAPE improves by >=3% relative, or when MAE improves
    by >=5% without material MAPE regression (<=0.5% relative worse).
    """
    if baseline is None or enriched is None:
        return False
    if baseline.mape is None or enriched.mape is None:
        return False
    if baseline.mape > 0 and enriched.mape <= baseline.mape * 0.97:
        return True
    if baseline.mae is not None and enriched.mae is not None and baseline.mae > 0:
        mae_improved = enriched.mae <= baseline.mae * 0.95
        mape_not_worse = enriched.mape <= baseline.mape * 1.005
        return bool(mae_improved and mape_not_worse)
    return False

# Minimum history sizes for seasonal-naive to be defined.
_MIN_DAILY_HISTORY = 7
_MIN_HOURLY_HISTORY = 168


def _seasonal_naive_wape_from_holdout(
    y_true: np.ndarray,
    history: pd.DataFrame,
    *,
    granularity: str,
) -> Optional[float]:
    """Compute the seasonal-naive WAPE on the same `y_true` rows.

    `granularity` is "daily" or "hourly". For daily, the seasonal-naive
    prediction for row i is history[value at i-7d]; for hourly it's
    history[value at i-168h]. We approximate by aligning the trailing
    portion of `history` against `y_true` and shifting by the season.

    Returns None when history is shorter than one full season.
    """
    if granularity == "daily":
        season = _MIN_DAILY_HISTORY
    else:
        season = _MIN_HOURLY_HISTORY

    if len(history) < season + len(y_true):
        return None

    # The naive prediction for the last len(y_true) rows is the value
    # `season` steps earlier in history. We assume `history` is the full
    # observed series including the holdout rows.
    values = history.iloc[:, -1].to_numpy(dtype=float)  # last column is the target
    if len(values) < season + len(y_true):
        return None
    holdout_preds = values[-(season + len(y_true)) : -season]
    holdout_truth = values[-len(y_true) :]
    if holdout_preds.shape != holdout_truth.shape:
        return None
    return metrics.wape(holdout_truth, holdout_preds)


def select_with_gate(
    baseline,
    enriched,
    *,
    target: str,
    model_history: pd.DataFrame,
) -> Tuple[object, str, str]:
    """Pick the result to promote and return (chosen, label, reason).

    `target` is one of 'REVENUE' | 'BUSY_HOURS' | 'MENU_ITEM'. BUSY_HOURS
    uses hourly seasonal-naive; REVENUE and MENU_ITEM use daily.

    `model_history` is the raw history dataframe used to train the model.
    The last column is taken as the target column for the seasonal-naive
    computation. For daily-revenue this is the `revenue` column; for
    hourly-orders it should be the `orders` column.
    """
    if enriched is None:
        return baseline, "enriched_skipped", "enriched model returned None (insufficient signal coverage or history)"

    granularity = "hourly" if target == "BUSY_HOURS" else "daily"
    min_history = _MIN_HOURLY_HISTORY if granularity == "hourly" else _MIN_DAILY_HISTORY

    enriched_y_true = getattr(enriched, "holdout_y_true", None)
    enriched_y_pred = getattr(enriched, "holdout_y_pred", None)
    baseline_y_true = getattr(baseline, "holdout_y_true", None)
    baseline_y_pred = getattr(baseline, "holdout_y_pred", None)

    have_arrays = (
        enriched_y_true is not None and len(enriched_y_true) > 0
        and enriched_y_pred is not None and len(enriched_y_pred) > 0
        and baseline_y_true is not None and len(baseline_y_true) > 0
        and baseline_y_pred is not None and len(baseline_y_pred) > 0
    )
    have_history = model_history is not None and len(model_history) >= min_history

    if not (have_arrays and have_history):
        # Fall back to the legacy gate: enriched-vs-baseline by mape/mae.
        _LOG.warning(
            "select_with_gate: holdout history too short for seasonal-naive (%s) — "
            "falling back to legacy gate for target=%s",
            len(model_history) if model_history is not None else 0,
            target,
        )
        promoted = should_promote_enriched(baseline, enriched)
        if promoted:
            return enriched, "promoted", (
                "fallback (seasonal-naive unavailable: holdout too short); "
                f"legacy gate promoted enriched (mape {enriched.mape:.4f} vs baseline {baseline.mape:.4f})"
            )
        return baseline, "baseline_won", (
            "fallback (seasonal-naive unavailable: holdout too short); "
            f"legacy gate kept baseline (mape {enriched.mape:.4f} vs {baseline.mape:.4f})"
        )

    # Compute WAPE on the holdout arrays for both models.
    enriched_wape = metrics.wape(np.asarray(enriched_y_true, dtype=float),
                                 np.asarray(enriched_y_pred, dtype=float))
    baseline_wape = metrics.wape(np.asarray(baseline_y_true, dtype=float),
                                 np.asarray(baseline_y_pred, dtype=float))

    naive_wape = _seasonal_naive_wape_from_holdout(
        np.asarray(enriched_y_true, dtype=float),
        model_history,
        granularity=granularity,
    )

    if enriched_wape is None or baseline_wape is None or naive_wape is None:
        # WAPE undefined (typically Σ|y|=0) — fall back to legacy gate.
        _LOG.warning(
            "select_with_gate: WAPE undefined (enriched=%s baseline=%s naive=%s) — fallback for %s",
            enriched_wape, baseline_wape, naive_wape, target,
        )
        promoted = should_promote_enriched(baseline, enriched)
        if promoted:
            return enriched, "promoted", (
                "fallback (WAPE undefined for holdout); legacy gate promoted enriched"
            )
        return baseline, "baseline_won", (
            "fallback (WAPE undefined for holdout); legacy gate kept baseline"
        )

    decision = decide_promotion(
        enriched_wape=enriched_wape,
        baseline_xgb_wape=baseline_wape,
        seasonal_naive_wape=naive_wape,
    )
    if decision.promoted:
        return enriched, "promoted", decision.reason
    return baseline, "gate_rejected", decision.reason
