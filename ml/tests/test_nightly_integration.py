"""Tests for ml.evaluation.nightly_integration.

`run_evaluation_pass` and `run_consistency_check` are the two entry points
the nightly pipeline calls per active store. Both take a live psycopg2
connection — we mock that with unittest.mock.MagicMock and assert on the
SQL/calls they make.
"""
from __future__ import annotations

import datetime as dt
import inspect
import logging
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from ml.evaluation import nightly_integration as ni


def _mk_cursor_for_revenue(rows: list[tuple]) -> MagicMock:
    """Return a MagicMock cursor whose fetchall() yields `rows`."""
    cur = MagicMock()
    cur.fetchall.return_value = rows
    cur.__enter__ = lambda self: self
    cur.__exit__ = lambda self, *a: None
    return cur


def _mk_conn_with_rowsets(rowsets: list[list[tuple]]) -> MagicMock:
    """A MagicMock connection that hands out a fresh cursor per `cursor()` call,
    each cursor pre-loaded with the next rowset's fetchall() result."""
    cursors = []
    for rows in rowsets:
        c = MagicMock()
        c.fetchall.return_value = rows
        cursors.append(c)

    iter_cursors = iter(cursors)

    def cursor_factory(*args, **kwargs):
        try:
            nxt = next(iter_cursors)
        except StopIteration:
            nxt = MagicMock()
            nxt.fetchall.return_value = []
        cm = MagicMock()
        cm.__enter__ = lambda self, _c=nxt: _c
        cm.__exit__ = lambda self, *a: None
        return cm

    conn = MagicMock()
    conn.cursor.side_effect = cursor_factory
    return conn


def test_run_evaluation_pass_upserts_one_row_per_target():
    today = dt.date(2026, 5, 12)

    # Build mocked rowsets for the 3 fetches inside run_evaluation_pass.
    # Each fetch tuple shape is (forecastDate, predicted, actual, p10, p90, modelVersion, baseline_predicted)
    # Our fetch helpers return rich dict-like rows; the function flattens them.
    # We expose a simpler tuple here and let the implementation normalize.
    rev_rows = [
        (dt.date(2026, 5, d), 1000.0 + d, 950.0 + d, 900.0 + d, 1100.0 + d, "rev-v1", 980.0 + d)
        for d in range(1, 12)
    ]
    hr_rows = [
        (dt.date(2026, 5, d), 10.0, 9.5, 8.0, 12.0, "hr-v1", 9.0)
        for d in range(1, 12)
    ]
    item_rows = [
        (dt.date(2026, 5, d), 5.0, 4.5, 3.0, 7.0, "mi-v1", 4.0)
        for d in range(1, 12)
    ]

    conn = _mk_conn_with_rowsets([rev_rows, hr_rows, item_rows])

    upserts: list[dict] = []

    def fake_upsert(_conn, row):
        upserts.append(row)

    with patch.object(ni, "upsert_evaluation_row", side_effect=fake_upsert):
        ni.run_evaluation_pass(conn, store_id="s1", today=today)

    targets = {r["target"] for r in upserts}
    assert targets == {"REVENUE", "BUSY_HOURS", "MENU_ITEM"}
    # Each row has the expected store + non-null wape/baselineWape
    for r in upserts:
        assert r["storeId"] == "s1"
        assert r["wape"] is not None
        assert r["baselineWape"] is not None
        assert r["sampleSize"] > 0


def test_run_evaluation_pass_skips_target_with_no_reconciled_rows():
    today = dt.date(2026, 5, 12)
    # All three fetches return empty.
    conn = _mk_conn_with_rowsets([[], [], []])

    upserts: list[dict] = []

    def fake_upsert(_conn, row):
        upserts.append(row)

    with patch.object(ni, "upsert_evaluation_row", side_effect=fake_upsert):
        ni.run_evaluation_pass(conn, store_id="s1", today=today)

    assert upserts == []


def test_run_evaluation_pass_returns_count_of_rows_written():
    # run_evaluation_pass must report how many MlForecastEvaluation rows it wrote
    # so the nightly orchestrator can tell "wrote 3 rows" from "silently wrote 0"
    # (the latter previously still printed ok:True).
    today = dt.date(2026, 5, 12)
    rev_rows = [
        (dt.date(2026, 5, d), 1000.0 + d, 950.0 + d, 900.0 + d, 1100.0 + d, "rev-v1", 980.0 + d)
        for d in range(1, 12)
    ]
    hr_rows = [(dt.date(2026, 5, d), 10.0, 9.5, 8.0, 12.0, "hr-v1", 9.0) for d in range(1, 12)]
    item_rows = [(dt.date(2026, 5, d), 5.0, 4.5, 3.0, 7.0, "mi-v1", 4.0) for d in range(1, 12)]
    conn = _mk_conn_with_rowsets([rev_rows, hr_rows, item_rows])

    with patch.object(ni, "upsert_evaluation_row", side_effect=lambda *_: None):
        written = ni.run_evaluation_pass(conn, store_id="s1", today=today)

    assert written == 3


def test_run_evaluation_pass_returns_zero_when_no_reconciled_rows():
    today = dt.date(2026, 5, 12)
    conn = _mk_conn_with_rowsets([[], [], []])

    with patch.object(ni, "upsert_evaluation_row", side_effect=lambda *_: None):
        written = ni.run_evaluation_pass(conn, store_id="s1", today=today)

    assert written == 0


def test_run_consistency_check_logs_warning_on_large_discrepancy(caplog):
    today = dt.date(2026, 5, 12)
    # Future revenue: large numbers; future items: tiny qty * tiny price => big gap.
    rev_future = [
        (dt.date(2026, 5, 13), 1000.0),
        (dt.date(2026, 5, 14), 1100.0),
    ]
    items_future = [
        (dt.date(2026, 5, 13), "item-a", 1.0, 10.0),  # 10 << 1000 => 99% discrepancy
        (dt.date(2026, 5, 14), "item-a", 1.0, 10.0),
    ]
    conn = _mk_conn_with_rowsets([rev_future, items_future])

    with caplog.at_level(logging.WARNING, logger="ml.evaluation.nightly_integration"):
        ni.run_consistency_check(conn, store_id="s1", today=today)

    warns = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert warns, "expected at least one warning for large discrepancy"
    assert any("discrepancy" in (r.message or "").lower() for r in warns)


def test_run_consistency_check_quiet_when_aligned(caplog):
    today = dt.date(2026, 5, 12)
    rev_future = [
        (dt.date(2026, 5, 13), 1000.0),
    ]
    # Item qty * price ≈ revenue => discrepancy small.
    items_future = [
        (dt.date(2026, 5, 13), "item-a", 50.0, 20.0),  # 50 * 20 = 1000
    ]
    conn = _mk_conn_with_rowsets([rev_future, items_future])

    with caplog.at_level(logging.WARNING, logger="ml.evaluation.nightly_integration"):
        ni.run_consistency_check(conn, store_id="s1", today=today)

    warns = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert warns == []


# ---------------------------------------------------------------------------
# Which model an evaluation row is attributed to.
#
# The evaluator pools every reconciled forecast in a trailing 35-day window,
# across however many model generations ran during it, then stamps the result
# with ONE modelVersion. It took `rows[0]`, and the fetch is ordered by
# forecastDate ASC — so the pooled statistic was labelled with the OLDEST
# contributing model. During the 2026-08-19 model change that meant coverage
# rows for windows ending 2026-08-20 were stamped `...20260726-0803`, a July
# model, which is what made the Gate 3 failure so hard to read.
# ---------------------------------------------------------------------------


def test_evaluation_row_is_labelled_with_the_newest_contributing_model():
    import datetime as dt

    rows = [
        # (forecastDate, predicted, actual, p10, p90, modelVersion)
        (dt.date(2026, 8, 1), 100.0, 102.0, 90.0, 110.0, "xgboost-july-baseline"),
        (dt.date(2026, 8, 10), 100.0, 98.0, 90.0, 110.0, "xgboost-july-baseline"),
        (dt.date(2026, 8, 20), 100.0, 101.0, 90.0, 110.0, "xgboost-august-conformal"),
    ]
    inp = ni._build_eval_input(
        rows, target="REVENUE", store_id="store-hwd", today=dt.date(2026, 8, 21)
    )
    assert inp is not None
    assert inp.model_version == "xgboost-august-conformal"


def test_evaluation_row_label_survives_a_single_generation():
    import datetime as dt

    rows = [
        (dt.date(2026, 8, 1), 100.0, 102.0, 90.0, 110.0, "only-one"),
        (dt.date(2026, 8, 2), 100.0, 98.0, 90.0, 110.0, "only-one"),
    ]
    inp = ni._build_eval_input(
        rows, target="REVENUE", store_id="store-hwd", today=dt.date(2026, 8, 21)
    )
    assert inp is not None and inp.model_version == "only-one"


# ---------------------------------------------------------------------------
# The seasonal-naive baseline, and which series it compares a row against.
# ---------------------------------------------------------------------------


def test_baseline_pairs_each_hour_with_the_same_hour_a_week_earlier():
    """BUSY_HOURS and MENU_ITEM send ~24 rows (or one per SKU) per date.

    Keyed on the date alone, the lookup dict kept only the last row written for
    each day and handed that one actual to every row of the day a week later —
    lunch scored against closing time. `baselineWape` is the denominator of the
    model's skill ratio, so this is what the operator gate reads.
    """
    dates = []
    series = []
    actuals = []
    for day in (dt.date(2026, 5, 1), dt.date(2026, 5, 8)):
        for hour, orders in ((11, 40.0), (15, 5.0), (19, 60.0)):
            dates.append(day)
            series.append(hour)
            actuals.append(orders)

    out = ni._seasonal_naive_baseline(dates, np.asarray(actuals), series)

    # The 1st has no t-7 in the window, so it falls back to its own actual.
    assert list(out[:3]) == [40.0, 5.0, 60.0]
    # The 8th takes each hour's own value from the 1st — not hour 19's for all.
    assert list(out[3:]) == [40.0, 5.0, 60.0]


def test_baseline_without_a_series_still_keys_on_the_date():
    """Daily revenue has one row per date and passes no series."""
    dates = [dt.date(2026, 5, 1), dt.date(2026, 5, 8)]
    out = ni._seasonal_naive_baseline(dates, np.asarray([100.0, 130.0]))
    assert list(out) == [100.0, 100.0]


def test_hourly_and_item_fetches_select_the_column_the_baseline_needs():
    """`series_index=6` is only meaningful if the fetch selects a 7th column.

    The cursor is a mock, so the rows prove nothing — read the SQL the fetch
    would actually send.
    """
    hourly_sql = inspect.getsource(ni._fetch_reconciled_hourly_orders)
    item_sql = inspect.getsource(ni._fetch_reconciled_menu_item)
    assert 'f."modelVersion",\n               f."hourBucket"' in hourly_sql
    assert 'f."modelVersion",\n               f."otterItemSkuId"' in item_sql


def test_build_eval_input_reads_the_series_column_it_is_pointed_at():
    rows = [
        (dt.date(2026, 5, 1), 38.0, 40.0, 30.0, 50.0, "v1", 11),
        (dt.date(2026, 5, 1), 6.0, 5.0, 3.0, 9.0, "v1", 15),
        (dt.date(2026, 5, 8), 41.0, 40.0, 30.0, 50.0, "v1", 11),
        (dt.date(2026, 5, 8), 4.0, 5.0, 3.0, 9.0, "v1", 15),
    ]
    inp = ni._build_eval_input(
        rows, target="BUSY_HOURS", store_id="s1", today=dt.date(2026, 5, 12), series_index=6
    )
    assert inp is not None
    # Hour 11 on the 8th references hour 11 on the 1st (40), not hour 15's 5.
    assert inp.baseline_predictions[2] == 40.0
    assert inp.baseline_predictions[3] == 5.0


def test_a_window_mostly_falling_back_says_so_out_loud(caplog):
    """A fallback row scores zero error, so a window full of them makes the
    baseline look perfect and the model look beaten by it."""
    dates = [dt.date(2026, 5, 1) + dt.timedelta(days=i) for i in range(5)]
    with caplog.at_level(logging.WARNING):
        ni._seasonal_naive_baseline(dates, np.asarray([1.0] * 5))
    assert any("fell back to actual" in r.message for r in caplog.records)


def test_only_the_trailing_28_days_are_scored():
    """The fetch is 35 days; the extra 7 are the seasonal-naive prefix.

    Nothing trimmed back, so the oldest 7 dates were scored with no t-7
    reference and fell back to their own actuals — a fifth of every night's
    sample handing the baseline a free zero error, under a `sampleSize` that
    claimed 28.
    """
    today = dt.date(2026, 5, 12)
    rows = [
        (today - dt.timedelta(days=n), 100.0, 110.0, 90.0, 130.0, "v1")
        for n in range(34, 0, -1)
    ]
    inp = ni._build_eval_input(rows, target="REVENUE", store_id="s1", today=today)

    assert inp is not None
    assert inp.actuals.size == 28
    assert inp.window_start == today - dt.timedelta(days=28)
    assert inp.baseline_predictions.size == 28


def test_the_prefix_is_still_read_as_the_baseline_reference():
    """Trimming the scored window must not trim what the baseline looks up."""
    today = dt.date(2026, 5, 12)
    # Every day is 100 except one in the prefix, which the scored day 7 days
    # later must reference.
    rows = []
    for n in range(35, 0, -1):
        day = today - dt.timedelta(days=n)
        actual = 500.0 if n == 35 else 100.0
        rows.append((day, 100.0, actual, 90.0, 130.0, "v1"))

    inp = ni._build_eval_input(rows, target="REVENUE", store_id="s1", today=today)
    assert inp is not None
    # t-28 is the first scored day, and its t-7 reference is the prefix's t-35.
    assert inp.baseline_predictions[0] == 500.0
    # No scored row fell back to its own actual.
    assert not any(
        b == a for b, a in zip(inp.baseline_predictions, inp.actuals) if a == 500.0
    )


def test_the_model_label_is_the_newest_date_even_when_rows_sort_by_sku():
    """MENU_ITEM's SQL orders by `otterItemSkuId` first, then by date.

    So `rows[-1]` is the last SKU's last date, not the window's newest — the
    label stamped a trailing statistic with whichever generation happened to
    serve the alphabetically-last item.
    """
    today = dt.date(2026, 5, 12)
    rows = [
        # SKU A, oldest to newest — its newest row ran on the new model.
        (today - dt.timedelta(days=3), 1.0, 1.0, 0.0, 2.0, "v2", "SKU-A"),
        (today - dt.timedelta(days=2), 1.0, 1.0, 0.0, 2.0, "v3", "SKU-A"),
        # SKU B, which stopped selling a week ago and was last forecast on v1.
        (today - dt.timedelta(days=9), 1.0, 1.0, 0.0, 2.0, "v1", "SKU-B"),
    ]
    inp = ni._build_eval_input(
        rows, target="MENU_ITEM", store_id="s1", today=today, series_index=6
    )
    assert inp is not None
    assert inp.model_version == "v3"


def test_the_95_percent_interval_is_widened_by_the_z_ratio_not_by_two():
    today = dt.date(2026, 5, 12)
    rows = [(today - dt.timedelta(days=1), 100.0, 100.0, 90.0, 110.0, "v1")]
    inp = ni._build_eval_input(rows, target="REVENUE", store_id="s1", today=today)
    assert inp is not None
    # An 80% half-width of 10 becomes 1.96/1.2816 ≈ 1.53 times that, not 20.
    assert inp.upper95[0] == pytest.approx(100 + 10 * 1.5295, abs=0.01)
    assert inp.lower95[0] == pytest.approx(100 - 10 * 1.5295, abs=0.01)


def test_the_per_horizon_floor_counts_scored_rows_not_fetched_rows():
    """`split_rows_by_horizon` counts over the 35-day fetch, not the 28 scored.

    A horizon whose rows are five, three of them inside the 7-day prefix that
    only exists to give the seasonal-naive baseline a t-7 reference, cleared a
    floor of five and then published a `sampleSize` of two. The floor belongs
    after the trim.
    """
    today = dt.date(2026, 5, 12)
    # Three rows in the prefix (t-35..t-29), two inside the scored window.
    offsets = [35, 33, 31, 20, 10]
    rows = [
        (today - dt.timedelta(days=n), 100.0, 110.0, 90.0, 130.0, "v1")
        for n in sorted(offsets, reverse=True)
    ]

    # Without the floor the row is still built — from two scored days.
    loose = ni._build_eval_input(rows, target="REVENUE", store_id="s1", today=today)
    assert loose is not None
    assert loose.actuals.size == 2

    # With the caller's floor it is withheld rather than published thin.
    strict = ni._build_eval_input(
        rows,
        target="REVENUE",
        store_id="s1",
        today=today,
        horizon_day=7,
        min_scored_rows=ni.MIN_ROWS_PER_HORIZON,
    )
    assert strict is None


def test_the_per_horizon_writer_applies_that_floor():
    """The floor is only worth having if the caller that writes rows passes it."""
    src = inspect.getsource(ni._write_revenue_horizon_rows)
    assert "min_scored_rows=MIN_ROWS_PER_HORIZON" in src
