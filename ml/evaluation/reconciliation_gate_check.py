"""W8 exit gate: postPctDiscrepancyMedian <= 15% for 7 consecutive runs.

Run as `python -m ml.evaluation.reconciliation_gate_check` during the
observation window. Mirrors the operator_gate_check.py pattern.
"""
from __future__ import annotations

import sys
from typing import Tuple


RECONCILIATION_TARGET = 0.15
_WINDOW_DAYS = 7


def gate_reconciliation_post_median(conn) -> Tuple[bool, str]:
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT "postPctDiscrepancyMedian"
            FROM "MlReconciliationDaily"
            WHERE date >= CURRENT_DATE - %s::INTEGER
            ORDER BY date DESC
            LIMIT %s
            ''',
            (_WINDOW_DAYS, _WINDOW_DAYS),
        )
        rows = cur.fetchall()
    if len(rows) < _WINDOW_DAYS:
        return False, f"insufficient_window: {len(rows)}/{_WINDOW_DAYS} rows"
    failing = [v for (v,) in rows if v is None or v > RECONCILIATION_TARGET]
    if failing:
        return False, f"{len(failing)}/{_WINDOW_DAYS} days above {RECONCILIATION_TARGET}"
    return True, f"7/7 days at or below {RECONCILIATION_TARGET}"


def main() -> int:
    from ml.db import connect
    with connect() as conn:
        ok, detail = gate_reconciliation_post_median(conn)
    print(f"reconciliation gate: {'PASS' if ok else 'FAIL'} - {detail}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
