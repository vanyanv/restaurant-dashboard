"""Per-horizon interval widths replace HORIZON_WIDENING_PER_DAY.

The constant inflated the one-step conformal width by a flat 5% per day. Against
reconciled actuals it was wrong in both directions at once: 71.1% coverage at
one day out on a ±29% band, 96.8% at eight days on ±38%. Too tight tomorrow,
uninformative next week.
"""
from __future__ import annotations

import numpy as np
import pytest

from ml.evaluation.horizon_calibration import (
    HorizonRow,
    MAX_RELATIVE_HALF_WIDTH,
    enforce_monotonic,
    relative_half_widths,
)


def _rows(horizon: int, errors: list[float], predicted: float = 1000.0) -> list[HorizonRow]:
    """Rows whose |actual-predicted|/predicted equals each given error."""
    return [
        HorizonRow(horizon=horizon, predicted=predicted, actual=predicted * (1 + e))
        for e in errors
    ]


def test_width_is_the_finite_sample_corrected_quantile_of_absolute_error():
    """At n rows the level that actually delivers `coverage` is
    ceil((n+1)*coverage)/n — above the nominal level, converging to it as n
    grows. A plain 0.80 quantile over a few dozen points under-covers."""
    errors = [i / 100 for i in range(1, 21)]
    widths = relative_half_widths(_rows(1, errors), coverage=0.80, min_samples=5)
    n = len(errors)
    level = min(1.0, np.ceil((n + 1) * 0.80) / n)
    assert widths[1] == pytest.approx(np.quantile(errors, level))
    assert widths[1] >= np.quantile(errors, 0.80)


def test_sign_of_the_error_does_not_move_the_band():
    """Signed quantiles would re-centre the interval on the old model's bias,
    and the model that produced this history under-predicted by ~5%."""
    over = relative_half_widths(_rows(1, [0.10] * 20), min_samples=5)
    under = relative_half_widths(
        [HorizonRow(horizon=1, predicted=1000.0, actual=900.0)] * 20, min_samples=5
    )
    assert over[1] == pytest.approx(under[1], rel=1e-9)


def test_thin_horizons_are_omitted_so_the_caller_can_fall_back():
    widths = relative_half_widths(_rows(9, [0.1] * 4), min_samples=12)
    assert 9 not in widths


def test_each_horizon_is_measured_separately():
    rows = _rows(1, [0.05] * 15) + _rows(10, [0.30] * 15)
    widths = relative_half_widths(rows, min_samples=12)
    assert widths[1] < widths[10]


def test_an_absurd_width_is_dropped_rather_than_shown():
    rows = _rows(1, [MAX_RELATIVE_HALF_WIDTH + 0.5] * 20)
    assert relative_half_widths(rows, min_samples=5) == {}


def test_rows_without_a_usable_actual_are_ignored():
    rows = _rows(1, [0.1] * 15) + [HorizonRow(horizon=1, predicted=0.0, actual=500.0)]
    widths = relative_half_widths(rows, min_samples=12)
    assert widths[1] == pytest.approx(0.1, rel=1e-9)


def test_no_rows_means_no_widths():
    assert relative_half_widths([], min_samples=1) == {}


class TestMonotonic:
    def test_uncertainty_never_shrinks_with_distance(self):
        # Day 8 measuring tighter than day 7 is sampling noise on a few dozen
        # rows, not a genuine claim that next Tuesday is easier than tomorrow.
        assert enforce_monotonic({1: 0.10, 2: 0.18, 3: 0.14, 4: 0.20}) == {
            1: 0.10, 2: 0.18, 3: 0.18, 4: 0.20,
        }

    def test_genuine_growth_is_preserved(self):
        assert enforce_monotonic({1: 0.10, 2: 0.15, 3: 0.22}) == {1: 0.10, 2: 0.15, 3: 0.22}

    def test_gaps_in_the_horizon_sequence_are_kept(self):
        out = enforce_monotonic({1: 0.10, 5: 0.30})
        assert out == {1: 0.10, 5: 0.30}

    def test_empty_stays_empty(self):
        assert enforce_monotonic({}) == {}


def test_measured_widths_would_have_fixed_the_observed_miscalibration():
    """Sanity-check the mechanism on the shape the production data actually had:
    a horizon whose errors are tight and one whose errors are wide should come
    out with bands that differ, rather than one width stretched by 5% a day."""
    rows = _rows(1, list(np.linspace(0.02, 0.20, 30))) + _rows(
        8, list(np.linspace(0.05, 0.45, 30))
    )
    widths = enforce_monotonic(relative_half_widths(rows, min_samples=12))
    # The constant would have made day 8 exactly 1.35x day 1 (1 + 0.05*7).
    ratio = widths[8] / widths[1]
    assert ratio > 1.35, f"measured spread {ratio:.2f}x is not distinguishable from the constant"


def test_pre_fix_residuals_are_excluded_from_calibration():
    """The history describes a model with two bugs fixed on 2026-08-19. Sizing
    today's band on yesterday's errors would calibrate for a model that has been
    replaced, so the loader filters on generatedAt >= CALIBRATION_EPOCH and
    returns {} — falling back to conformal + widening — until enough post-fix
    runs have reconciled."""
    import inspect
    from ml.evaluation.horizon_calibration import CALIBRATION_EPOCH, load_horizon_widths

    src = inspect.getsource(load_horizon_widths)
    assert '"generatedAt" >= %s::date' in src
    assert "CALIBRATION_EPOCH" in src
    assert CALIBRATION_EPOCH == "2026-08-19"
