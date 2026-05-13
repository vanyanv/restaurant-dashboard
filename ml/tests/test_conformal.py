import numpy as np
import pytest
from xgboost import XGBRegressor

from ml.evaluation.conformal import wrap_xgboost_conformal


@pytest.fixture
def synthetic_regression():
    rng = np.random.default_rng(seed=42)
    n = 600
    X = rng.normal(size=(n, 4))
    y = (
        2.0 * X[:, 0]
        + 1.0 * X[:, 1]
        - 0.5 * X[:, 2]
        + rng.normal(scale=1.0, size=n)
    )
    return X, y


def test_wrap_xgboost_conformal_returns_intervals(synthetic_regression):
    X, y = synthetic_regression
    base = XGBRegressor(n_estimators=80, max_depth=3, learning_rate=0.1, random_state=0)
    wrapper = wrap_xgboost_conformal(base, X[:400], y[:400], X[400:500], y[400:500])
    point, lower80, upper80, lower95, upper95 = wrapper.predict_intervals(X[500:])

    assert point.shape == (100,)
    assert lower80.shape == upper80.shape == (100,)
    assert lower95.shape == upper95.shape == (100,)
    assert np.all(lower95 <= lower80)
    assert np.all(upper80 <= upper95)


def test_conformal_coverage_is_approximately_target(synthetic_regression):
    X, y = synthetic_regression
    base = XGBRegressor(n_estimators=80, max_depth=3, learning_rate=0.1, random_state=0)
    wrapper = wrap_xgboost_conformal(base, X[:400], y[:400], X[400:500], y[400:500])
    _, lower80, upper80, _, _ = wrapper.predict_intervals(X[500:])
    cov = np.mean((y[500:] >= lower80) & (y[500:] <= upper80))
    # Coverage on a small held-out set has wide finite-sample variance; widen bounds.
    assert 0.65 <= cov <= 0.92
