"""Phase 1 Weeks 1–4 operator-gate daily check.

Run this each morning during the 7-day observation window:

    python -m ml.evaluation.operator_gate_check

Prints a per-gate verdict and exits 0 if all gates pass for the trailing
window, 1 otherwise. Reads from `MlForecastEvaluation` and `MlTrainingRun`
populated by the nightly batch.

Gates (from `docs/superpowers/plans/2026-05-12-...`, Task 13):

  Gate 1 — Eval rows for today
      Each (active store × target) wrote at least one MlForecastEvaluation
      row whose computedAt::date = today. Missing rows mean the nightly job
      failed for that store/target, or reconciliation hasn't caught up.

  Gate 2 — Seasonal-naive gate fired
      MlTrainingRun.errorMessage in the last 7 days mentions "seasonal-naive"
      at least once. Zero mentions = either no model retrained, or the gate
      string isn't being persisted (regression).

  Gate 3 — Empirical 80% coverage for REVENUE
      Per-store average of intervalCoverage80 over the last 7 days lands in
      [0.78, 0.82]. Wider acceptance band [0.75, 0.85] is "ship anyway, note";
      outside [0.75, 0.85] means MAPIE calibration is broken.

  Gate 4 — Reconciliation still healthy
      Re-runs the audit and confirms all three forecast tables remain >= 80%.
"""

from __future__ import annotations
import sys
from datetime import date, timedelta

from ml.db import connect
from ml.evaluation.audit import fetch_reconciliation_rows, summarize_reconciliation


_COVERAGE_TARGET_LOW = 0.78
_COVERAGE_TARGET_HIGH = 0.82
_COVERAGE_ACCEPT_LOW = 0.75
_COVERAGE_ACCEPT_HIGH = 0.85
_WINDOW_DAYS = 7


def gate1_eval_rows_today(conn) -> tuple[bool, str]:
    """Each (active store × MlTarget) wrote at least one row today."""
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT s.id AS "storeId", s.name, t.target,
                   COUNT(e.id) AS rows_today
            FROM "Store" s
            CROSS JOIN (VALUES ('REVENUE'::"MlTarget"),
                               ('BUSY_HOURS'::"MlTarget"),
                               ('MENU_ITEM'::"MlTarget")) AS t(target)
            LEFT JOIN "MlForecastEvaluation" e
              ON e."storeId" = s.id AND e.target = t.target
              AND e."computedAt"::date = CURRENT_DATE
            WHERE s."isActive" = true
            GROUP BY 1, 2, 3
            ORDER BY 2, 3
            '''
        )
        rows = cur.fetchall()

    if not rows:
        return False, "no active stores"

    missing = [r for r in rows if r[3] == 0]
    lines = [f"  {name:<24} {target:<11} {count} rows" for _, name, target, count in rows]
    detail = "\n".join(lines)
    if missing:
        return False, f"{len(missing)} (store, target) pairs missing today\n{detail}"
    return True, detail


def gate2_seasonal_naive_fired(conn) -> tuple[bool, str]:
    """MlTrainingRun.errorMessage mentions 'seasonal-naive' in the last 7 days."""
    cutoff = date.today() - timedelta(days=_WINDOW_DAYS)
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT target,
                   COUNT(*) FILTER (WHERE "errorMessage" ILIKE %s)
                     AS naive_mentions,
                   COUNT(*) AS total_runs
            FROM "MlTrainingRun"
            WHERE "startedAt" >= %s
            GROUP BY 1
            ORDER BY 1
            ''',
            ("%seasonal-naive%", cutoff),
        )
        rows = cur.fetchall()

    if not rows:
        return False, f"no MlTrainingRun rows since {cutoff}"

    lines = [
        f"  {target:<11} {naive}/{total} runs mention seasonal-naive"
        for target, naive, total in rows
    ]
    detail = "\n".join(lines)
    any_fired = any(naive > 0 for _, naive, _ in rows)
    return any_fired, detail


def gate3_revenue_coverage(conn) -> tuple[bool, str, bool]:
    """Per-store mean intervalCoverage80 for REVENUE over last 7 days.

    Returns (strict_pass, detail, accept_band_pass) where strict_pass means
    every store landed in [0.78, 0.82] and accept_band_pass widens to
    [0.75, 0.85].
    """
    cutoff_dt = f"NOW() - INTERVAL '{_WINDOW_DAYS} days'"
    with conn.cursor() as cur:
        cur.execute(
            f'''
            SELECT s.name, AVG(e."intervalCoverage80") AS avg_cov, COUNT(*) AS rows
            FROM "MlForecastEvaluation" e
            JOIN "Store" s ON s.id = e."storeId"
            WHERE e.target = 'REVENUE'
              AND e."computedAt" >= {cutoff_dt}
              AND e."intervalCoverage80" IS NOT NULL
            GROUP BY 1
            ORDER BY 1
            '''
        )
        rows = cur.fetchall()

    if not rows:
        return False, "no REVENUE coverage data in last 7 days", False

    lines = []
    strict_pass = True
    accept_pass = True
    for name, avg_cov, count in rows:
        verdict = "OK"
        if not (_COVERAGE_TARGET_LOW <= avg_cov <= _COVERAGE_TARGET_HIGH):
            strict_pass = False
            verdict = "drift"
        if not (_COVERAGE_ACCEPT_LOW <= avg_cov <= _COVERAGE_ACCEPT_HIGH):
            accept_pass = False
            verdict = "BROKEN"
        lines.append(f"  {name:<24} {avg_cov:.3f} over {count} rows — {verdict}")

    return strict_pass, "\n".join(lines), accept_pass


def gate4_reconciliation_health() -> tuple[bool, str]:
    """Re-run the audit — all three forecast tables must remain >= 80%."""
    rows = fetch_reconciliation_rows()
    summary = summarize_reconciliation(rows)
    lines = []
    all_pass = True
    for table, cov in summary.items():
        status = "OK" if cov["passes_80pct_gate"] else "FAIL"
        lines.append(
            f"  {table:<24} {cov['reconciled']}/{cov['total']} "
            f"({cov['coverage_pct']}%) — {status}"
        )
        if not cov["passes_80pct_gate"]:
            all_pass = False
    return all_pass, "\n".join(lines)


def main() -> int:
    print("=== Phase 1 Weeks 1–4 — Operator Gate Daily Check ===")
    print(f"Date: {date.today().isoformat()}")
    print()

    with connect() as conn:
        g1_pass, g1_detail = gate1_eval_rows_today(conn)
        g2_pass, g2_detail = gate2_seasonal_naive_fired(conn)
        g3_strict, g3_detail, g3_accept = gate3_revenue_coverage(conn)

    g4_pass, g4_detail = gate4_reconciliation_health()

    def section(name: str, ok: bool, detail: str, note: str = "") -> None:
        marker = "PASS" if ok else "FAIL"
        suffix = f" ({note})" if note else ""
        print(f"[{marker}] {name}{suffix}")
        print(detail)
        print()

    section("Gate 1 — MlForecastEvaluation rows for today", g1_pass, g1_detail)
    section("Gate 2 — Seasonal-naive gate has fired (7d)", g2_pass, g2_detail)

    g3_note = ""
    if not g3_strict and g3_accept:
        g3_note = "in [0.75, 0.85] accept band but outside [0.78, 0.82] target"
    section(
        "Gate 3 — 80% interval coverage for REVENUE (7d avg)",
        g3_strict or g3_accept,
        g3_detail,
        g3_note,
    )
    section("Gate 4 — Reconciliation coverage holds", g4_pass, g4_detail)

    overall = g1_pass and g2_pass and (g3_strict or g3_accept) and g4_pass
    print("OVERALL:", "PASS — observation continues" if overall else "FAIL — investigate")
    return 0 if overall else 1


if __name__ == "__main__":
    raise SystemExit(main())
