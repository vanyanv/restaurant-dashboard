import numpy as np
import pytest

from ml.evaluation.metrics import (
    wape,
    mape,
    mae,
    bias,
    interval_coverage,
)


def test_wape_simple_case():
    actuals = np.array([100.0, 200.0, 300.0])
    preds   = np.array([110.0, 180.0, 330.0])
    # |Δ| sum = 10 + 20 + 30 = 60; actuals sum = 600 → WAPE = 0.10
    assert wape(actuals, preds) == pytest.approx(0.10, rel=1e-6)


def test_mape_handles_nonzero_actuals():
    actuals = np.array([100.0, 200.0])
    preds   = np.array([110.0, 180.0])
    # (10/100 + 20/200) / 2 = 0.10
    assert mape(actuals, preds) == pytest.approx(0.10, rel=1e-6)


def test_mape_skips_zero_actuals():
    actuals = np.array([0.0, 200.0])
    preds   = np.array([5.0, 180.0])
    # zero-actual row is dropped; remaining MAPE = 20/200 = 0.10
    assert mape(actuals, preds) == pytest.approx(0.10, rel=1e-6)


def test_mae_simple():
    actuals = np.array([10.0, 20.0, 30.0])
    preds   = np.array([12.0, 18.0, 33.0])
    assert mae(actuals, preds) == pytest.approx(7.0 / 3.0, rel=1e-6)


def test_bias_signed():
    actuals = np.array([100.0, 100.0, 100.0])
    preds   = np.array([105.0, 110.0, 115.0])
    # mean signed error (pred - actual) = +10
    assert bias(actuals, preds) == pytest.approx(10.0, rel=1e-6)


def test_interval_coverage_full():
    actuals = np.array([50.0, 60.0, 70.0])
    lower   = np.array([40.0, 55.0, 65.0])
    upper   = np.array([60.0, 65.0, 75.0])
    assert interval_coverage(actuals, lower, upper) == pytest.approx(1.0)


def test_interval_coverage_partial():
    actuals = np.array([50.0, 60.0, 70.0])
    lower   = np.array([40.0, 55.0, 75.0])  # third actual below lower
    upper   = np.array([60.0, 65.0, 80.0])
    assert interval_coverage(actuals, lower, upper) == pytest.approx(2.0 / 3.0)


def test_metrics_reject_mismatched_lengths():
    with pytest.raises(ValueError):
        wape(np.array([1.0, 2.0]), np.array([1.0]))


def test_metrics_return_none_on_empty():
    empty = np.array([])
    assert wape(empty, empty) is None
    assert mape(empty, empty) is None
    assert mae(empty, empty) is None
    assert bias(empty, empty) is None
