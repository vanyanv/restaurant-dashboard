"""Audit reconciliation coverage on existing forecast tables.

Pre-build gate for Phase 1 Feature 1.2. If any forecast table has <80%
of historical rows reconciled (actual* + reconciledAt populated), the
reconciliation hardening task must run before MlForecastEvaluation
can produce meaningful rows.
"""

from __future__ import annotations
from typing import TypedDict
from ml.db import connect as get_connection


class TableCoverage(TypedDict):
    total: int
    reconciled: int
    coverage_pct: float
    passes_80pct_gate: bool


_TABLES = [
    ("ForecastDailyRevenue", "actualRevenue"),
    ("ForecastHourlyOrders", "actualOrders"),
    ("ForecastMenuItem", "actualQty"),
]


def fetch_reconciliation_rows() -> list[dict]:
    """Query Postgres for total vs reconciled row counts per forecast table.

    Only counts forecast rows whose forecastDate is in the past (we cannot
    reconcile future forecasts). Returns rows like
    {"table": "...", "total": N, "reconciled": M}.
    """
    rows: list[dict] = []
    with get_connection() as conn, conn.cursor() as cur:
        for table, actual_col in _TABLES:
            cur.execute(
                f'''
                SELECT
                    COUNT(*) AS total,
                    COUNT("{actual_col}") AS reconciled
                FROM "{table}"
                WHERE "forecastDate" < CURRENT_DATE
                '''
            )
            total, reconciled = cur.fetchone()
            rows.append({"table": table, "total": total, "reconciled": reconciled})
    return rows


def summarize_reconciliation(rows: list[dict]) -> dict[str, TableCoverage]:
    """Convert raw count rows into per-table coverage dict with gate verdict."""
    summary: dict[str, TableCoverage] = {}
    for row in rows:
        total = max(row["total"], 0)
        reconciled = max(row["reconciled"], 0)
        pct = (reconciled / total * 100.0) if total > 0 else 0.0
        summary[row["table"]] = {
            "total": total,
            "reconciled": reconciled,
            "coverage_pct": round(pct, 2),
            "passes_80pct_gate": pct >= 80.0,
        }
    return summary


def main() -> int:
    rows = fetch_reconciliation_rows()
    summary = summarize_reconciliation(rows)
    print("=== Reconciliation Coverage Audit ===")
    all_pass = True
    for table, cov in summary.items():
        status = "PASS" if cov["passes_80pct_gate"] else "FAIL"
        print(
            f"  {table}: {cov['reconciled']}/{cov['total']} "
            f"({cov['coverage_pct']}%) — {status}"
        )
        if not cov["passes_80pct_gate"]:
            all_pass = False
    print()
    print("VERDICT:", "PROCEED to Task 2 (skip Task 1)" if all_pass else "RUN Task 1 first")
    return 0 if all_pass else 1


if __name__ == "__main__":
    raise SystemExit(main())
