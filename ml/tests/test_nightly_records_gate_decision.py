"""The promotion decision is persisted whether it promoted or rejected.

Gate 2 of the operator check counts MlTrainingRun rows whose errorMessage
mentions the seasonal-naive gate. `run_nightly` used to write that reason only
when the gate REJECTED, so a window in which every model was promoted — the
healthy outcome — left every errorMessage NULL and was indistinguishable from
a window in which the gate never ran at all.

That is what the 2026-09 failure was. Gate 2 read `REVENUE 7/8` and
`BUSY_HOURS 8/8` through August, then `0/8` on every target from 09-14, and
reported the check as FAILED daily for the rest of the month. Nothing had
broken in the gate; the runs had simply stopped being rejected.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


class _Result:
    """Stand-in for a TrainResult, carrying only what the close path reads."""

    def __init__(self, harri_coverage: float = 1.0):
        self.mape = 0.09
        self.mae = 120.0
        self.sample_size = 300
        self.flavor = "weather-events"
        self.harri_coverage = harri_coverage


def _revenue_patches(gate: str, reason: str):
    return [
        patch("ml.run_nightly._open_run", return_value="run-1"),
        patch("ml.run_nightly._set_run_model_version"),
        patch("ml.run_nightly.train_revenue", return_value=_Result()),
        patch(
            "ml.run_nightly._select_result",
            return_value=(_Result(), gate, reason),
        ),
        patch("ml.run_nightly.load_horizon_widths", return_value={}),
        patch("ml.run_nightly.forecast_revenue", return_value=[]),
        patch("ml.run_nightly._write_revenue_forecasts", return_value=0),
    ]


def _run_revenue(gate: str, reason: str) -> MagicMock:
    from ml.run_nightly import run_revenue_for_store

    with patch("ml.run_nightly._close_run") as close:
        patches = _revenue_patches(gate, reason)
        for p in patches:
            p.start()
        try:
            run_revenue_for_store("store-holly", "xgboost-abc-1")
        finally:
            for p in patches:
                p.stop()
    return close


PROMOTED_REASON = (
    "enriched beats baseline-XGB 0.1010 (+8.2%) and seasonal-naive "
    "0.1400 (+33.7%)"
)
REJECTED_REASON = "vs seasonal-naive +1.2% (threshold 5%)"


def test_a_promoted_revenue_run_records_the_seasonal_naive_decision():
    close = _run_revenue("promoted", PROMOTED_REASON)

    close.assert_called_once()
    error = close.call_args.kwargs["error"]
    assert error is not None, "a promoted run used to record nothing at all"
    assert "seasonal-naive" in error
    assert close.call_args.kwargs["status"] == "SUCCEEDED"


def test_a_rejected_revenue_run_still_records_its_reason():
    close = _run_revenue("gate_rejected", REJECTED_REASON)

    error = close.call_args.kwargs["error"]
    assert "gate_rejected" in error
    # Gate 2 matches either label; this is the pre-fix one.
    assert "seasonal-naive" in error


@pytest.mark.parametrize("gate", ["promoted", "gate_rejected"])
def test_the_recorded_decision_is_what_gate2_greps_for(gate):
    """Gate 2's SQL is `errorMessage ILIKE '%seasonal-naive%' OR '%vs naive%'`.
    Whatever is written has to satisfy one of those or the gate is blind."""
    reason = PROMOTED_REASON if gate == "promoted" else REJECTED_REASON
    error = _run_revenue(gate, reason).call_args.kwargs["error"].lower()

    assert "seasonal-naive" in error or "vs naive" in error


def _run_busy_hours(gate: str, reason: str, harri_coverage: float) -> MagicMock:
    from ml.run_nightly import run_busy_hours_for_store

    with patch("ml.run_nightly._close_run") as close:
        patches = [
            patch("ml.run_nightly._open_run", return_value="run-2"),
            patch("ml.run_nightly._set_run_model_version"),
            patch(
                "ml.run_nightly.train_hourly_orders",
                return_value=_Result(harri_coverage=harri_coverage),
            ),
            patch(
                "ml.run_nightly._select_result",
                return_value=(_Result(harri_coverage=harri_coverage), gate, reason),
            ),
            patch("ml.run_nightly.forecast_hourly_orders", return_value=[]),
            patch("ml.run_nightly._write_hourly_order_forecasts", return_value=0),
        ]
        for p in patches:
            p.start()
        try:
            run_busy_hours_for_store("store-holly", "xgboost-abc-1")
        finally:
            for p in patches:
                p.stop()
    return close


def test_a_promoted_busy_hours_run_records_the_decision_too():
    error = _run_busy_hours("promoted", PROMOTED_REASON, 1.0).call_args.kwargs["error"]

    assert "seasonal-naive" in error


def test_busy_hours_keeps_the_harri_warning_alongside_the_decision():
    """The low-coverage warning and the gate decision share one field, so
    adding the second must not drop the first."""
    error = _run_busy_hours("promoted", PROMOTED_REASON, 0.4).call_args.kwargs["error"]

    assert "low_harri_coverage:0.40" in error
    assert "seasonal-naive" in error
