"""Impacts carry a range, and the ledger ranks on the downside.

`impact.py` reported a single dollar figure per opportunity. Every input is an
estimate, and one of them — the elasticity — now reports a standard error, so
that uncertainty can be pushed through instead of thrown away. Five cards each
claiming an exact "+$170/wk" was the visible symptom; the underlying one was
that a coefficient fitted on 41 noisy days ranked identically to one fitted on
400 clean ones.
"""
from __future__ import annotations

import numpy as np
import pytest

from ml.growth.impact import reprice_impact
from ml.growth.uncertainty import (
    ImpactInterval,
    ranking_value,
    reprice_impact_interval,
)

BASE = dict(elasticity=-0.5, current_units=100.0, current_margin=4.0, delta_price=0.25)


class TestInterval:
    def test_point_matches_the_deterministic_formula(self):
        """The range is added around the existing number, not instead of it —
        a shifted point would silently restate every recommendation."""
        out = reprice_impact_interval(**BASE, elasticity_std_err=0.1)
        assert out.point == pytest.approx(reprice_impact(**BASE))

    def test_the_range_brackets_the_point(self):
        out = reprice_impact_interval(**BASE, elasticity_std_err=0.1)
        assert out.p10 < out.point < out.p90
        assert out.p10 < out.p25 < out.p90

    def test_a_shakier_fit_earns_a_wider_range(self):
        tight = reprice_impact_interval(**BASE, elasticity_std_err=0.02)
        loose = reprice_impact_interval(**BASE, elasticity_std_err=0.30)
        assert (loose.p90 - loose.p10) > (tight.p90 - tight.p10) * 5

    def test_no_standard_error_means_no_invented_range(self):
        """A fit with one price point cannot say how uncertain it is. Showing a
        tight interval there would be a fabrication, so the interval collapses
        and the caller omits it."""
        out = reprice_impact_interval(**BASE, elasticity_std_err=None)
        assert out.is_degenerate
        assert out.point == out.p10 == out.p25 == out.p90

    @pytest.mark.parametrize("bad", [0.0, -0.5, float("nan"), float("inf")])
    def test_a_nonsense_standard_error_is_treated_as_absent(self, bad):
        assert reprice_impact_interval(**BASE, elasticity_std_err=bad).is_degenerate

    def test_the_same_inputs_give_the_same_answer_every_night(self):
        """A fixed seed, so the ledger does not reshuffle between runs for
        reasons no owner could see."""
        a = reprice_impact_interval(**BASE, elasticity_std_err=0.1)
        b = reprice_impact_interval(**BASE, elasticity_std_err=0.1)
        assert (a.p10, a.p25, a.p90) == (b.p10, b.p25, b.p90)

    def test_p10_is_never_above_p90_whatever_the_signs(self):
        """The multiplier can be negative — a price drop on an elastic item —
        which flips which tail of the elasticity draw lands where."""
        for delta in (0.25, -0.25):
            for elasticity in (-1.6, -0.4):
                out = reprice_impact_interval(
                    elasticity=elasticity, elasticity_std_err=0.2,
                    current_units=100.0, current_margin=4.0, delta_price=delta,
                )
                assert out.p10 <= out.p90, f"{elasticity=} {delta=}"

    def test_the_interval_reflects_the_supplied_standard_error(self):
        """Sanity check on scale: the formula is linear in the elasticity for a
        fixed multiplier, so the p10-p90 spread should be about 2.56 standard
        errors wide times that multiplier."""
        se = 0.1
        out = reprice_impact_interval(**BASE, elasticity_std_err=se)
        multiplier = abs(BASE["current_units"] * BASE["current_margin"] * BASE["delta_price"])
        expected = 2 * 1.2816 * se * multiplier
        assert (out.p90 - out.p10) == pytest.approx(expected, rel=0.05)


class TestRanking:
    def test_ranks_on_the_downside_not_the_headline(self):
        """A wide, speculative $900 must not outrank a tight, dependable $700."""
        speculative = reprice_impact_interval(
            elasticity=-0.9, elasticity_std_err=0.6,
            current_units=100.0, current_margin=4.0, delta_price=0.25,
        )
        dependable = reprice_impact_interval(
            elasticity=-0.7, elasticity_std_err=0.03,
            current_units=100.0, current_margin=4.0, delta_price=0.25,
        )
        assert abs(speculative.point) > abs(dependable.point)
        assert ranking_value(speculative, 0.0) < ranking_value(dependable, 0.0)

    def test_an_opportunity_without_a_range_ranks_on_its_point(self):
        assert ranking_value(None, 512.0) == 512.0

    def test_a_degenerate_interval_ranks_on_its_point(self):
        out = reprice_impact_interval(**BASE, elasticity_std_err=None)
        assert ranking_value(out, 0.0) == out.point
