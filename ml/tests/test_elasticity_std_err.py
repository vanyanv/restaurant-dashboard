"""Elasticity kept its point estimate and threw away its uncertainty.

`fit()` stored `elasticity`, `fitR2`, `sampleSize` and `pricePointCount` but not
the standard error of the coefficient — the one number that says how far to
trust it. Downstream, `reprice_impact` multiplies that elasticity by units,
margin and Δprice and reports a single dollar figure, so a coefficient fitted on
41 noisy observations produced a recommendation indistinguishable from one
fitted on 400 clean ones.

The SE falls out of the same design matrix: se(β) = sqrt(σ² · (XᵀX)⁻¹ⱼⱼ) with
σ² = RSS / (n − k).
"""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd
import pytest

from ml.elasticity.menu_item import fit


def _series(
    *, n: int = 240, elasticity: float = -0.8, noise: float = 0.05, seed: int = 3,
    price_levels: tuple[float, ...] = (9.5, 10.0, 10.5, 11.0),
) -> pd.DataFrame:
    """log(qty) = a + e*log(price) + noise, on a rotating set of price points."""
    rng = np.random.default_rng(seed)
    dates = pd.date_range(end=pd.Timestamp(dt.date(2026, 8, 18)), periods=n, freq="D")
    price = np.array([price_levels[i % len(price_levels)] for i in range(n)], dtype=float)
    log_q = 4.0 + elasticity * np.log(price) + rng.normal(0, noise, size=n)
    return pd.DataFrame({"date": dates, "qty": np.exp(log_q), "unit_price": price})


def test_recovers_the_elasticity_it_was_given():
    result = fit("Combo", _series(elasticity=-0.8))
    assert result is not None
    assert result.elasticity == pytest.approx(-0.8, abs=0.1)


def test_standard_error_is_reported():
    result = fit("Combo", _series())
    assert result.elasticity_std_err is not None
    assert result.elasticity_std_err > 0


def test_noisier_data_earns_a_wider_standard_error():
    tight = fit("Combo", _series(noise=0.02, seed=1))
    loose = fit("Combo", _series(noise=0.20, seed=1))
    assert loose.elasticity_std_err > tight.elasticity_std_err * 3


def test_more_observations_shrink_the_standard_error():
    small = fit("Combo", _series(n=40, seed=2))
    large = fit("Combo", _series(n=400, seed=2))
    assert large.elasticity_std_err < small.elasticity_std_err


def test_narrow_price_variation_widens_it():
    """Elasticity is identified by price moving. Prices that barely move carry
    little information about it, however many days are observed."""
    wide = fit("Combo", _series(price_levels=(8.0, 10.0, 12.0, 14.0), seed=4))
    narrow = fit("Combo", _series(price_levels=(9.95, 10.0, 10.05, 10.1), seed=4))
    assert narrow.elasticity_std_err > wide.elasticity_std_err


def test_the_true_value_sits_inside_two_standard_errors():
    """A sanity check that the SE is on the right scale, not merely positive."""
    inside = 0
    trials = 12
    for seed in range(trials):
        r = fit("Combo", _series(elasticity=-0.8, noise=0.08, seed=seed))
        if abs(r.elasticity - (-0.8)) <= 2 * r.elasticity_std_err:
            inside += 1
    assert inside >= trials - 2, f"only {inside}/{trials} within 2 SE — SE is mis-scaled"


def test_the_no_price_variance_branch_reports_no_standard_error():
    """One price point means elasticity is not identified at all. That branch
    returns a placeholder 0.0 elasticity, and a standard error there would imply
    a measurement that never happened."""
    flat = _series(price_levels=(10.0,))
    result = fit("Combo", flat)
    assert result is not None
    assert result.price_point_count == 1
    assert result.elasticity_std_err is None


def test_too_little_history_still_returns_nothing():
    assert fit("Combo", _series(n=10)) is None
