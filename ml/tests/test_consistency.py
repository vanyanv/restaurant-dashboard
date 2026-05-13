import pandas as pd
import pytest

from ml.evaluation.consistency import compute_revenue_item_discrepancy


def test_discrepancy_zero_when_aligned():
    revenue = pd.DataFrame([
        {"storeId": "s1", "forecastDate": "2026-04-01", "predictedRevenue": 1000.0},
    ])
    items = pd.DataFrame([
        {"storeId": "s1", "forecastDate": "2026-04-01", "predictedQty": 10, "avgPrice": 50.0},
        {"storeId": "s1", "forecastDate": "2026-04-01", "predictedQty":  5, "avgPrice": 100.0},
    ])
    out = compute_revenue_item_discrepancy(revenue, items)
    assert out["discrepancyPct"].iloc[0] == pytest.approx(0.0, abs=1e-6)


def test_discrepancy_positive_when_items_undershoot():
    revenue = pd.DataFrame([
        {"storeId": "s1", "forecastDate": "2026-04-01", "predictedRevenue": 1000.0},
    ])
    items = pd.DataFrame([
        {"storeId": "s1", "forecastDate": "2026-04-01", "predictedQty": 10, "avgPrice": 50.0},
    ])
    out = compute_revenue_item_discrepancy(revenue, items)
    assert out["discrepancyPct"].iloc[0] == pytest.approx(50.0, abs=1e-6)


def test_discrepancy_handles_missing_item_rows():
    revenue = pd.DataFrame([
        {"storeId": "s1", "forecastDate": "2026-04-01", "predictedRevenue": 1000.0},
        {"storeId": "s1", "forecastDate": "2026-04-02", "predictedRevenue":  500.0},
    ])
    items = pd.DataFrame([
        {"storeId": "s1", "forecastDate": "2026-04-01", "predictedQty": 10, "avgPrice": 50.0},
    ])
    out = compute_revenue_item_discrepancy(revenue, items)
    apr_2 = out[out["forecastDate"] == "2026-04-02"].iloc[0]
    assert apr_2["discrepancyPct"] == pytest.approx(100.0, abs=1e-6)
