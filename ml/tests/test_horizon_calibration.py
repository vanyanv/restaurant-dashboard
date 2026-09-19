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


# ─────────────────────────────────────────────────────────────────────────────
# Held-out validation (2026-09-19)
#
# The widths above are an unbiased quantile on exchangeable rows. Production
# rows drift, and the module's own docstring recorded what that cost — widths
# fitted on the older half of the pre-fix history covered 60-76% of the newer
# half. Nothing acted on it, so `forecast()` shipped whatever had
# MIN_SAMPLES_PER_HORIZON rows behind it, replacing the CQR band outright.
# Hollywood's measured 80% intervals then covered 0.581 on 2026-09-14, still
# only 0.696 by 09-18. These cover the check that now stands in the way.
# ─────────────────────────────────────────────────────────────────────────────
import datetime as _dt

from ml.evaluation.horizon_calibration import (
    MAX_VALIDATION_SCALE,
    MIN_VALIDATED_COVERAGE,
    measure_coverage,
    split_fit_holdout,
    validated_half_widths,
)


def _dated_rows(
    horizon: int,
    errors: list[float],
    *,
    start_day: int = 1,
    predicted: float = 1000.0,
) -> list[HorizonRow]:
    """Rows carrying ascending generatedAt, so the split is deterministic."""
    return [
        HorizonRow(
            horizon=horizon,
            predicted=predicted,
            actual=predicted * (1 + e),
            generated_at=_dt.date(2026, 9, 1) + _dt.timedelta(days=start_day + i),
        )
        for i, e in enumerate(errors)
    ]


def test_split_puts_the_newest_rows_in_the_holdout():
    """Split on time, not at random: a random split puts the same era on both
    sides, which is exactly how drift hides."""
    rows = _dated_rows(1, [0.01] * 10)
    fit, holdout = split_fit_holdout(rows, fraction=0.30)
    assert len(fit) == 7 and len(holdout) == 3
    assert max(r.generated_at for r in fit) < min(r.generated_at for r in holdout)


def test_measure_coverage_ignores_horizons_the_widths_say_nothing_about():
    widths = {1: 0.10}
    rows = _dated_rows(1, [0.05, 0.20]) + _dated_rows(2, [0.99])
    judged, achieved = measure_coverage(widths, rows)
    assert judged == 2
    assert achieved == pytest.approx(0.5)


def test_stable_history_ships_its_measured_widths():
    """When the holdout looks like the fit rows, the widths have earned the
    band and are returned — the guard is not a blanket refusal."""
    errors = [0.02 + (i % 10) / 200 for i in range(60)]
    widths = validated_half_widths(
        _dated_rows(1, errors), min_samples=5, min_validation_rows=10
    )
    assert widths, "stable history should still produce widths"
    _, achieved = measure_coverage(widths, _dated_rows(1, errors))
    assert achieved >= MIN_VALIDATED_COVERAGE


def test_widths_are_scaled_up_when_the_holdout_undercovers():
    """The 2026-09 shape: quiet history, then errors twice the size. The old
    path shipped the quiet width and covered ~58%; the width must grow."""
    calm = [0.02] * 40
    drifted = [0.04] * 20
    rows = _dated_rows(1, calm + drifted)

    naive = relative_half_widths(rows, min_samples=5)
    guarded = validated_half_widths(rows, min_samples=5, min_validation_rows=10)

    assert guarded, "a scalable miss should still yield a band"
    assert guarded[1] > naive[1]
    # And the scaled band must actually cover the era that broke the old one.
    _, achieved = measure_coverage(guarded, _dated_rows(1, drifted))
    assert achieved >= MIN_VALIDATED_COVERAGE


def test_a_holdout_too_thin_to_judge_falls_back_rather_than_guessing():
    """Returning {} puts `forecast()` back on the CQR band. An unvalidated
    width is not better than the path it replaces."""
    assert validated_half_widths(_dated_rows(1, [0.05] * 12), min_samples=5) == {}


def test_rows_without_timestamps_cannot_be_validated():
    """No generatedAt means no time split, so nothing can be held out."""
    rows = _rows(1, [0.05] * 60)
    assert validated_half_widths(rows, min_samples=5, min_validation_rows=10) == {}


def test_a_holdout_that_disagrees_wildly_falls_back_instead_of_scaling():
    """Beyond MAX_VALIDATION_SCALE the two halves are not describing the same
    process, and a band built on the older one should not ship at all."""
    rows = _dated_rows(1, [0.01] * 40 + [0.60] * 20)
    ratio = 0.60 / 0.01
    assert ratio > MAX_VALIDATION_SCALE
    assert validated_half_widths(rows, min_samples=5, min_validation_rows=10) == {}


def _generations(
    horizons: list[int],
    errors_by_generation: list[float],
    *,
    start_day: int = 1,
    predicted: float = 1000.0,
) -> list[HorizonRow]:
    """One nightly generation per entry, writing a row for every horizon.

    This is the real shape of ForecastDailyRevenue: `run_nightly` forecasts
    the whole horizon in one pass, so every row it writes that night carries
    the same generatedAt.
    """
    rows: list[HorizonRow] = []
    for i, e in enumerate(errors_by_generation):
        stamp = _dt.date(2026, 9, 1) + _dt.timedelta(days=start_day + i)
        for h in horizons:
            rows.append(
                HorizonRow(
                    horizon=h,
                    predicted=predicted,
                    actual=predicted * (1 + e),
                    generated_at=stamp,
                )
            )
    return rows


def test_a_generation_is_never_split_across_fit_and_holdout():
    """Slicing by row count cut inside a night's rows, so the holdout held
    generations the fit had already seen. The cut belongs between them."""
    # 11 nights x 3 horizons = 33 rows; 30% of 33 is 10, which is not a whole
    # number of nights — so a count-based slice has to cut one of them in half.
    rows = _generations([1, 2, 3], [0.02] * 11)

    fit, holdout = split_fit_holdout(rows, fraction=0.30)

    fit_stamps = {r.generated_at for r in fit}
    holdout_stamps = {r.generated_at for r in holdout}
    assert not (fit_stamps & holdout_stamps), "a generation landed on both sides"
    assert max(fit_stamps) < min(holdout_stamps)
    # Whole nights, so every horizon of every held-out night is present.
    assert len(holdout) == 3 * len(holdout_stamps)


def test_the_holdout_still_measures_drift_when_horizons_share_a_timestamp():
    """The guard has to keep working on the real row shape, not just on the
    one-row-per-night shape the first tests used."""
    rows = _generations([1, 2, 3], [0.02] * 40 + [0.04] * 20)

    naive = relative_half_widths(rows, min_samples=5)
    guarded = validated_half_widths(rows, min_samples=5, min_validation_rows=10)

    assert guarded, "a scalable miss should still yield a band"
    assert guarded[1] > naive[1]


def test_rows_of_one_single_generation_cannot_be_validated():
    """Every row sharing one timestamp leaves nothing to hold out — there is
    no second generation to check the first against."""
    rows = _generations([1, 2, 3], [0.05])

    fit, holdout = split_fit_holdout(rows, fraction=0.30)

    assert len(fit) == 3 and holdout == []
    assert validated_half_widths(rows, min_samples=1, min_validation_rows=1) == {}
