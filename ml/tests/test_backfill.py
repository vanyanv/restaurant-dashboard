from ml.evaluation.audit import summarize_reconciliation


def test_audit_summary_reflects_reconciled_rows():
    """After backfill, audit must report passes_80pct_gate=True per table."""
    fake_rows = [
        {"table": "ForecastDailyRevenue", "total": 10, "reconciled": 9},
        {"table": "ForecastHourlyOrders", "total": 10, "reconciled": 8},
        {"table": "ForecastMenuItem",    "total": 10, "reconciled": 10},
    ]
    summary = summarize_reconciliation(fake_rows)
    assert summary["ForecastDailyRevenue"]["passes_80pct_gate"] is True
    assert summary["ForecastHourlyOrders"]["passes_80pct_gate"] is True
    assert summary["ForecastMenuItem"]["passes_80pct_gate"] is True
