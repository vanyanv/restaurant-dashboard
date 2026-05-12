from ml.evaluation.audit import summarize_reconciliation


def test_summarize_reconciliation_returns_per_table_coverage():
    rows = [
        {"table": "ForecastDailyRevenue", "total": 100, "reconciled": 90},
        {"table": "ForecastHourlyOrders", "total": 200, "reconciled": 100},
        {"table": "ForecastMenuItem",    "total": 500, "reconciled": 500},
    ]
    summary = summarize_reconciliation(rows)
    assert summary["ForecastDailyRevenue"]["coverage_pct"] == 90.0
    assert summary["ForecastHourlyOrders"]["coverage_pct"] == 50.0
    assert summary["ForecastMenuItem"]["coverage_pct"] == 100.0
    assert summary["ForecastDailyRevenue"]["passes_80pct_gate"] is True
    assert summary["ForecastHourlyOrders"]["passes_80pct_gate"] is False


def test_summarize_reconciliation_handles_zero_total():
    rows = [
        {"table": "ForecastDailyRevenue", "total": 0, "reconciled": 0},
    ]
    summary = summarize_reconciliation(rows)
    assert summary["ForecastDailyRevenue"]["total"] == 0
    assert summary["ForecastDailyRevenue"]["reconciled"] == 0
    assert summary["ForecastDailyRevenue"]["coverage_pct"] == 0.0
    assert summary["ForecastDailyRevenue"]["passes_80pct_gate"] is False
