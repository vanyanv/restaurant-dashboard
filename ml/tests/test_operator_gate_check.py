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
