"""Pure-function tests for the operator-gate daily check.

The module's gate functions take a live psycopg2 connection, so we exercise
only the small pure helpers that format/threshold the results.
"""

from __future__ import annotations

from ml.evaluation.operator_gate_check import (
    _COVERAGE_ACCEPT_HIGH,
    _COVERAGE_ACCEPT_LOW,
    _COVERAGE_TARGET_HIGH,
    _COVERAGE_TARGET_LOW,
    _WINDOW_DAYS,
)


def test_coverage_thresholds_match_spec():
    """The plan's spec is [78%, 82%] strict / [75%, 85%] accept. Lock the constants
    so future drift in the script doesn't silently slacken the gate."""
    assert _COVERAGE_TARGET_LOW == 0.78
    assert _COVERAGE_TARGET_HIGH == 0.82
    assert _COVERAGE_ACCEPT_LOW == 0.75
    assert _COVERAGE_ACCEPT_HIGH == 0.85


def test_observation_window_is_seven_days():
    """Task 13 requires a 7-day observation window before Phase 1 can close."""
    assert _WINDOW_DAYS == 7


# ---------------------------------------------------------------------------
# Gate 3 row classification.
#
# Gate 3 read a coverage number pooled by the evaluator over a trailing 35-day
# window, with no notion of which model produced the forecasts in it. Two model
# bugs were fixed on 2026-08-19 (CALIBRATION_EPOCH); every day after that the
# gate kept reporting REVENUE intervals "BROKEN" at 0.615-0.692 on a statistic
# whose rows were almost entirely pre-fix forecasts from a model that no longer
# exists. `horizon_calibration` already refuses to calibrate on that same era —
# the gate simply had no way to say so.
#
# The rule these tests pin: a store is only band-checked once the CURRENT model
# generation has produced enough reconciled observations to support the check.
# ---------------------------------------------------------------------------

from ml.evaluation.operator_gate_check import (  # noqa: E402
    _COVERAGE_MIN_SAMPLE,
    classify_coverage_row,
)

ENOUGH = _COVERAGE_MIN_SAMPLE


def test_well_calibrated_store_passes_both_bands():
    v = classify_coverage_row("Hollywood", 0.80, 7, ENOUGH, ENOUGH)
    assert v.counted and v.strict_ok and v.accept_ok
    assert "OK" in v.line


def test_mild_miscalibration_breaks_strict_but_not_accept():
    v = classify_coverage_row("Hollywood", 0.77, 7, ENOUGH, ENOUGH)
    assert v.counted and not v.strict_ok and v.accept_ok
    assert "drift" in v.line


def test_real_miscalibration_breaks_the_accept_band():
    """A genuinely broken interval must still be caught once the current
    generation has the observations to prove it."""
    v = classify_coverage_row("Hollywood", 0.648, 7, ENOUGH, ENOUGH)
    assert v.counted and not v.strict_ok and not v.accept_ok
    assert "BROKEN" in v.line


def test_thin_overall_sample_is_warming_up():
    v = classify_coverage_row("Glendale", 0.50, 3, ENOUGH - 1, ENOUGH)
    assert not v.counted and v.strict_ok and v.accept_ok
    assert "warming up" in v.line


def test_thin_post_epoch_sample_is_warming_up_not_broken():
    """The production failure: 26 pooled observations, but only 2 of them from
    the post-fix model. Reporting that as BROKEN blames the new model for the
    old one's intervals."""
    v = classify_coverage_row("Hollywood", 0.648, 7, 26, 2)
    assert not v.counted, "must not band-check a superseded model generation"
    assert v.strict_ok and v.accept_ok
    assert "BROKEN" not in v.line
    # The number stays visible — this is a deferral, not a suppression.
    assert "0.648" in v.line
    assert "2" in v.line and "current model" in v.line


def test_post_epoch_gate_does_not_mask_a_fully_reconciled_regression():
    """Once the new generation has its own observations, silence ends."""
    v = classify_coverage_row("Hollywood", 0.648, 7, 26, ENOUGH)
    assert v.counted and not v.accept_ok and "BROKEN" in v.line
