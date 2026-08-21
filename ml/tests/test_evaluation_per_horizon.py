"""F8 — accuracy was measured at one horizon and labelled as fourteen.

`MlForecastEvaluation` has a `horizonDay` column and a unique key that includes
it. Every row ever written carried the value 0, hardcoded at
`nightly_integration.py:262`. The fetch behind it took
`DISTINCT ON (forecastDate) ORDER BY generatedAt DESC`, which for a past date
resolves to the forecast made closest to that date — in practice the one-day-ahead
prediction.

So the WAPE on the quality panel was a next-day number presented as the accuracy
of a fourteen-day forecast. `horizon_calibration.py` already proves the
per-horizon data is there and readable: every row carries
`forecastDate - generatedAt`. The evaluation path simply never asked.

Accuracy at day 1 and accuracy at day 14 are different products. An owner
ordering stock a week out is relying on the second one.
"""
from __future__ import annotations

import datetime as dt

import pytest

from ml.evaluation.nightly_integration import (
    POOLED_HORIZON,
    _build_eval_input,
    split_rows_by_horizon,
)


D = dt.date(2026, 8, 1)


def _row(day: int, horizon: int, predicted: float = 5000.0, actual: float = 5100.0) -> tuple:
    """(forecastDate, predicted, actual, p10, p90, modelVersion, horizon)"""
    return (
        D + dt.timedelta(days=day),
        predicted,
        actual,
        predicted * 0.8,
        predicted * 1.2,
        "xgboost-abc123-baseline-conformal",
        horizon,
    )


def test_rows_are_grouped_by_their_own_horizon():
    rows = [_row(0, 1), _row(1, 1), _row(2, 7), _row(3, 14)]
    grouped = split_rows_by_horizon(rows)

    assert set(grouped) == {1, 7, 14}
    assert len(grouped[1]) == 2
    assert len(grouped[7]) == 1


def test_grouping_drops_rows_with_no_horizon():
    rows = [_row(0, 1), (D, 5000.0, 5100.0, 4000.0, 6000.0, "v", None)]
    grouped = split_rows_by_horizon(rows)
    assert set(grouped) == {1}


def test_grouping_drops_non_positive_horizons():
    """A horizon of 0 or less means the 'forecast' was generated on or after the
    day it predicted — that is not a forecast, and scoring it inflates accuracy."""
    rows = [_row(0, 1), _row(1, 0), _row(2, -3)]
    assert set(split_rows_by_horizon(rows)) == {1}


def test_empty_input():
    assert split_rows_by_horizon([]) == {}


def test_eval_input_carries_the_horizon_it_was_built_for():
    rows = [_row(i, 7) for i in range(10)]
    inp = _build_eval_input(rows, target="REVENUE", store_id="s1", today=D, horizon_day=7)
    assert inp is not None
    assert inp.horizon_day == 7


def test_the_pooled_row_is_named_rather_than_a_bare_zero():
    """Horizon 0 is kept for the existing dashboard read, but it now means
    something explicit — 'pooled across the latest forecast per day' — instead of
    being an unlabelled default."""
    rows = [_row(i, 1) for i in range(10)]
    inp = _build_eval_input(rows, target="REVENUE", store_id="s1", today=D)
    assert inp is not None
    assert inp.horizon_day == POOLED_HORIZON == 0


def test_horizon_specific_scores_differ_from_the_pooled_one():
    """The whole point: a 14-day-out forecast is worse than a 1-day-out one, and
    a single number cannot report both."""
    good = [_row(i, 1, predicted=5000.0, actual=5050.0) for i in range(10)]
    bad = [_row(i, 14, predicted=5000.0, actual=7000.0) for i in range(10, 20)]

    grouped = split_rows_by_horizon(good + bad)
    h1 = _build_eval_input(grouped[1], target="REVENUE", store_id="s1", today=D, horizon_day=1)
    h14 = _build_eval_input(grouped[14], target="REVENUE", store_id="s1", today=D, horizon_day=14)

    from ml.evaluation.evaluator import build_evaluation_row

    assert build_evaluation_row(h1)["wape"] < build_evaluation_row(h14)["wape"]
    assert build_evaluation_row(h1)["horizonDay"] == 1
    assert build_evaluation_row(h14)["horizonDay"] == 14


def test_a_horizon_with_too_few_rows_is_not_scored():
    """One observation is not an accuracy measurement. Writing it anyway puts a
    number on the quality panel that moves violently with a single day."""
    rows = [_row(0, 3)]
    grouped = split_rows_by_horizon(rows, min_rows=5)
    assert grouped == {}


# --- integration ---------------------------------------------------------------

def test_run_evaluation_pass_writes_a_row_for_each_qualifying_horizon():
    from unittest.mock import MagicMock, patch

    from ml.evaluation import nightly_integration as ni

    today = dt.date(2026, 5, 20)
    pooled = [
        (dt.date(2026, 5, d), 1000.0, 980.0, 900.0, 1100.0, "rev-v1")
        for d in range(1, 12)
    ]
    # Six rows at horizon 1 and six at horizon 7 — both clear MIN_ROWS_PER_HORIZON.
    # Three at horizon 14, which does not.
    by_horizon = (
        [(dt.date(2026, 5, d), 1000.0, 980.0, 900.0, 1100.0, "rev-v1", 1) for d in range(1, 7)]
        + [(dt.date(2026, 5, d), 1000.0, 900.0, 800.0, 1200.0, "rev-v1", 7) for d in range(1, 7)]
        + [(dt.date(2026, 5, d), 1000.0, 700.0, 600.0, 1400.0, "rev-v1", 14) for d in range(1, 4)]
    )

    cursors = iter([pooled, [], [], by_horizon])

    def cursor_factory(*_a, **_k):
        try:
            rows = next(cursors)
        except StopIteration:
            rows = []
        cur = MagicMock()
        cur.fetchall.return_value = rows
        cm = MagicMock()
        cm.__enter__ = lambda self, _c=cur: _c
        cm.__exit__ = lambda self, *a: None
        return cm

    conn = MagicMock()
    conn.cursor.side_effect = cursor_factory

    upserts: list[dict] = []
    with patch.object(ni, "upsert_evaluation_row", side_effect=lambda _c, r: upserts.append(r)):
        ni.run_evaluation_pass(conn, store_id="s1", today=today)

    horizons = sorted(r["horizonDay"] for r in upserts if r["target"] == "REVENUE")
    assert horizons == [0, 1, 7], f"expected pooled + h1 + h7, got {horizons}"

    by_h = {r["horizonDay"]: r for r in upserts if r["target"] == "REVENUE"}
    assert by_h[7]["wape"] > by_h[1]["wape"], "a week out should score worse than a day out"
