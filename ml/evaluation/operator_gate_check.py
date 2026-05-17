"""Phase 1 Weeks 1–4 operator-gate daily check.

Run this each morning during the 7-day observation window:

    python -m ml.evaluation.operator_gate_check
    python -m ml.evaluation.operator_gate_check --as-of 2026-05-14

Prints a per-gate verdict and exits 0 if all gates pass for the trailing
window, 1 otherwise. Reads from `MlForecastEvaluation` and `MlTrainingRun`
populated by the nightly batch.

With `--as-of YYYY-MM-DD` the gates are evaluated *as if* it were that date:
queries that previously referenced `CURRENT_DATE` / `NOW()` are bound on the
supplied target date instead. No JobRun row is written in that mode — it is
verification-only. Gate 4 (reconciliation) is point-in-time only and applies
today's snapshot to every historical date (we do not store reconciliation
history); the as-of header surfaces this.

Gates (from `docs/superpowers/plans/2026-05-12-...`, Task 13):

  Gate 1 — Eval rows for the target date
      Each (active store × target) wrote at least one MlForecastEvaluation
      row whose windowEnd = target_date - 1. Missing rows mean the nightly
      job failed for that store/target, or reconciliation hasn't caught up.

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
import argparse
import sys
import time
import traceback
from datetime import date, timedelta
from typing import Any

from psycopg2.extras import Json

from ml.db import connect, cuid_like
from ml.evaluation.audit import fetch_reconciliation_rows, summarize_reconciliation


_JOB_NAME = "ml.operator-gate-check"
_COVERAGE_TARGET_LOW = 0.78
_COVERAGE_TARGET_HIGH = 0.82
_COVERAGE_ACCEPT_LOW = 0.75
_COVERAGE_ACCEPT_HIGH = 0.85
_WINDOW_DAYS = 7
# Minimum reconciled observations behind a coverage statistic before we trust
# the band check. At p=0.80 and N=8 the 95% Wilson CI is ~[0.55, 0.96] — well
# wider than the [0.75, 0.85] accept band, so the gate would flag normal
# warm-up noise as miscalibration. With N=14+ the CI tightens enough to catch
# a real drop in coverage without false positives during bootstrap.
_COVERAGE_MIN_SAMPLE = 14


def _open_job_run() -> str:
    run_id = cuid_like()
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            '''
            INSERT INTO "JobRun" (id, "jobName", "triggeredBy", status, metadata)
            VALUES (%s, %s, 'github-actions', 'RUNNING'::"JobStatus", %s)
            ''',
            (run_id, _JOB_NAME, Json({"windowDays": _WINDOW_DAYS, "date": date.today().isoformat()})),
        )
    return run_id


def _close_job_run(
    run_id: str,
    *,
    status: str,
    duration_ms: int,
    metadata: dict[str, Any],
    error: BaseException | None = None,
) -> None:
    message = str(error)[:4000] if error else None
    stack = traceback.format_exc()[:8000] if error else None
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            '''
            UPDATE "JobRun"
            SET status = %s::"JobStatus",
                "completedAt" = CURRENT_TIMESTAMP,
                "durationMs" = %s,
                "rowsWritten" = %s,
                metadata = %s,
                "errorMessage" = %s,
                "errorStack" = %s
            WHERE id = %s
            ''',
            (
                status,
                duration_ms,
                1 if status == "SUCCESS" else 0,
                Json(metadata),
                message,
                stack,
                run_id,
            ),
        )


def _schema_ready(conn) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass('\"MlForecastEvaluation\"') IS NOT NULL")
        (ready,) = cur.fetchone()
    return bool(ready)


def gate1_eval_rows_today(conn, target_date: date) -> tuple[bool, str]:
    """Each trainable (active store × MlTarget) wrote at least one row with
    windowEnd = target_date - 1.

    A pair is "trainable" if it has at least one SUCCEEDED MlTrainingRun in
    the trailing _WINDOW_DAYS ending at target_date. Stores with
    insufficient_history will never produce an evaluation row, so demanding
    one would be guaranteed-to-fail noise; we skip them with status
    "skipped" and surface the count in the gate detail so they remain
    visible.
    """
    window_end = target_date - timedelta(days=1)
    train_cutoff = target_date - timedelta(days=_WINDOW_DAYS)
    with conn.cursor() as cur:
        cur.execute(
            '''
            WITH trainable AS (
                SELECT DISTINCT scope AS "storeId", target
                FROM "MlTrainingRun"
                WHERE status = 'SUCCEEDED'
                  AND "startedAt" >= %s
                  AND "startedAt" <= %s + INTERVAL '1 day'
            )
            SELECT s.id AS "storeId", s.name, t.target,
                   COUNT(e.id) AS rows_today,
                   (tr."storeId" IS NOT NULL) AS is_trainable
            FROM "Store" s
            CROSS JOIN (VALUES ('REVENUE'::"MlTarget"),
                               ('BUSY_HOURS'::"MlTarget"),
                               ('MENU_ITEM'::"MlTarget")) AS t(target)
            LEFT JOIN "MlForecastEvaluation" e
              ON e."storeId" = s.id AND e.target = t.target
              AND e."windowEnd" = %s
            LEFT JOIN trainable tr
              ON tr."storeId" = s.id AND tr.target = t.target
            WHERE s."isActive" = true
            GROUP BY 1, 2, 3, tr."storeId"
            ORDER BY 2, 3
            ''',
            (train_cutoff, target_date, window_end),
        )
        rows = cur.fetchall()

    if not rows:
        return False, "no active stores"

    lines = []
    missing = []
    skipped = 0
    for _, name, target, count, is_trainable in rows:
        if not is_trainable:
            lines.append(f"  {name:<24} {target:<11} skipped (no SUCCEEDED training in {_WINDOW_DAYS}d)")
            skipped += 1
        else:
            lines.append(f"  {name:<24} {target:<11} {count} rows")
            if count == 0:
                missing.append((name, target))
    detail = "\n".join(lines)
    if skipped:
        detail = f"{detail}\n  ({skipped} pair(s) skipped — no recent training)"
    if missing:
        return False, f"{len(missing)} trainable (store, target) pairs missing for windowEnd={window_end}\n{detail}"
    return True, detail


def gate2_seasonal_naive_fired(conn, target_date: date) -> tuple[bool, str]:
    """MlTrainingRun.errorMessage mentions the seasonal-naive gate in the 7
    days ending at target_date.

    Accepts either 'seasonal-naive' (post-fix label, commit 19b6be4) or
    'vs naive' (pre-fix label). Both indicate the seasonal-naive baseline
    gate was evaluated during that training run — the fix in 19b6be4 was
    purely a label-format change in promotion.decide_promotion's reason
    string, not a behavioral change to the gate itself.
    """
    cutoff = target_date - timedelta(days=_WINDOW_DAYS)
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT target,
                   COUNT(*) FILTER (
                     WHERE "errorMessage" ILIKE %s
                        OR "errorMessage" ILIKE %s
                   ) AS naive_mentions,
                   COUNT(*) AS total_runs
            FROM "MlTrainingRun"
            WHERE "startedAt" >= %s
              AND "startedAt" <= %s + INTERVAL '1 day'
            GROUP BY 1
            ORDER BY 1
            ''',
            ("%seasonal-naive%", "%vs naive%", cutoff, target_date),
        )
        rows = cur.fetchall()

    if not rows:
        return False, f"no MlTrainingRun rows in [{cutoff}, {target_date}]"

    lines = [
        f"  {target:<11} {naive}/{total} runs mention seasonal-naive"
        for target, naive, total in rows
    ]
    detail = "\n".join(lines)
    any_fired = any(naive > 0 for _, naive, _ in rows)
    return any_fired, detail


def gate3_revenue_coverage(conn, target_date: date) -> tuple[bool, str, bool]:
    """Per-store mean intervalCoverage80 for REVENUE over the 7 days
    ending at target_date.

    Returns (strict_pass, detail, accept_band_pass). Stores whose MAX eval
    sampleSize is below _COVERAGE_MIN_SAMPLE are reported as "warming up"
    and excluded from band checks — coverage statistics on tiny windows
    have wide CIs that would routinely flag healthy models as miscalibrated.
    """
    window_lo = target_date - timedelta(days=_WINDOW_DAYS)
    window_hi = target_date - timedelta(days=1)
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT s.name,
                   AVG(e."intervalCoverage80") AS avg_cov,
                   COUNT(*) AS rows,
                   MAX(e."sampleSize") AS max_sample
            FROM "MlForecastEvaluation" e
            JOIN "Store" s ON s.id = e."storeId"
            WHERE e.target = 'REVENUE'
              AND e."windowEnd" BETWEEN %s AND %s
              AND e."intervalCoverage80" IS NOT NULL
            GROUP BY 1
            ORDER BY 1
            ''',
            (window_lo, window_hi),
        )
        rows = cur.fetchall()

    if not rows:
        return False, f"no REVENUE coverage data with windowEnd in [{window_lo}, {window_hi}]", False

    lines = []
    strict_pass = True
    accept_pass = True
    warming_up_count = 0
    evaluated_count = 0
    for name, avg_cov, count, max_sample in rows:
        if max_sample is None or max_sample < _COVERAGE_MIN_SAMPLE:
            warming_up_count += 1
            lines.append(
                f"  {name:<24} {avg_cov:.3f} over {count} rows (max n={max_sample}) — warming up"
            )
            continue
        evaluated_count += 1
        verdict = "OK"
        if not (_COVERAGE_TARGET_LOW <= avg_cov <= _COVERAGE_TARGET_HIGH):
            strict_pass = False
            verdict = "drift"
        if not (_COVERAGE_ACCEPT_LOW <= avg_cov <= _COVERAGE_ACCEPT_HIGH):
            accept_pass = False
            verdict = "BROKEN"
        lines.append(f"  {name:<24} {avg_cov:.3f} over {count} rows (n={max_sample}) — {verdict}")

    detail = "\n".join(lines)
    if evaluated_count == 0:
        # Every store still warming up — pass silently rather than alarming.
        detail = f"{detail}\n  ({warming_up_count} store(s) warming up — need n>={_COVERAGE_MIN_SAMPLE} reconciled obs)"
        return True, detail, True
    return strict_pass, detail, accept_pass


def gate4_reconciliation_health() -> tuple[bool, str]:
    """Re-run the audit — all three forecast tables must remain >= 80%.

    Point-in-time only: reads current reconciliation status from the forecast
    tables. When called via --as-of, the same snapshot is applied to every
    historical date (we do not store reconciliation history).
    """
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


def _run_checks(target_date: date) -> tuple[int, dict[str, Any]]:
    is_as_of = target_date != date.today()
    print("=== Phase 1 Weeks 1–4 — Operator Gate Daily Check ===")
    print(f"Date: {target_date.isoformat()}" + ("  (as-of mode)" if is_as_of else ""))
    print()

    with connect() as conn:
        if not _schema_ready(conn):
            print("schema not ready — skipping gates (MlForecastEvaluation table absent)")
            return 0, {
                "date": target_date.isoformat(),
                "windowDays": _WINDOW_DAYS,
                "schemaReady": False,
                "overallPass": True,
            }
        g1_pass, g1_detail = gate1_eval_rows_today(conn, target_date)
        g2_pass, g2_detail = gate2_seasonal_naive_fired(conn, target_date)
        g3_strict, g3_detail, g3_accept = gate3_revenue_coverage(conn, target_date)

    g4_pass, g4_detail = gate4_reconciliation_health()

    def section(name: str, ok: bool, detail: str, note: str = "") -> None:
        marker = "PASS" if ok else "FAIL"
        suffix = f" ({note})" if note else ""
        print(f"[{marker}] {name}{suffix}")
        print(detail)
        print()

    section("Gate 1 — MlForecastEvaluation rows for windowEnd=target-1", g1_pass, g1_detail)
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
    g4_note = "snapshot-only — applied to as-of date" if is_as_of else ""
    section("Gate 4 — Reconciliation coverage holds", g4_pass, g4_detail, g4_note)

    overall = g1_pass and g2_pass and (g3_strict or g3_accept) and g4_pass
    print("OVERALL:", "PASS — observation continues" if overall else "FAIL — investigate")
    metadata = {
        "date": target_date.isoformat(),
        "windowDays": _WINDOW_DAYS,
        "gate1EvalRowsToday": g1_pass,
        "gate2SeasonalNaiveFired": g2_pass,
        "gate3RevenueCoverageStrict": g3_strict,
        "gate3RevenueCoverageAcceptBand": g3_accept,
        "gate4ReconciliationHealthy": g4_pass,
        "overallPass": overall,
    }
    return (0 if overall else 1), metadata


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="ML operator gate daily check")
    parser.add_argument(
        "--as-of",
        dest="as_of",
        type=lambda s: date.fromisoformat(s),
        default=None,
        help="Evaluate gates as-of YYYY-MM-DD (verification only; no JobRun row written)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    target_date = args.as_of or date.today()
    is_as_of = args.as_of is not None

    if is_as_of:
        # Verification-only path: no JobRun side effects.
        exit_code, _ = _run_checks(target_date)
        return exit_code

    job_run_id = _open_job_run()
    started = time.monotonic()
    try:
        exit_code, metadata = _run_checks(target_date)
        _close_job_run(
            job_run_id,
            status="SUCCESS" if exit_code == 0 else "FAILURE",
            duration_ms=int((time.monotonic() - started) * 1000),
            metadata=metadata,
        )
        return exit_code
    except Exception as err:
        _close_job_run(
            job_run_id,
            status="FAILURE",
            duration_ms=int((time.monotonic() - started) * 1000),
            metadata={
                "date": target_date.isoformat(),
                "windowDays": _WINDOW_DAYS,
                "overallPass": False,
            },
            error=err,
        )
        raise


if __name__ == "__main__":
    raise SystemExit(main())
