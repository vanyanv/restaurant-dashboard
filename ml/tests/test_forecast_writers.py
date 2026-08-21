"""Contract tests for the three forecast writers in ml.run_nightly.

These are the functions that turn model output into rows in Postgres, and
nothing covered them until the TreeSHAP attribution change (4370bc4) broke
two of the three in production: `json.dumps(r.attribution)` was pasted into
all three parameter tuples, but only ForecastDailyRevenue grew an
"attribution" column — and only ml/models/revenue.py's ForecastRow grew the
field. MENU_ITEM and BUSY_HOURS died nightly with

    'ForecastRow' object has no attribute 'attribution'

and would have died on a parameter-count mismatch even if they hadn't.

So each writer is checked two ways: it survives a round trip against the
REAL dataclass it is fed in production (no MagicMock rows — a MagicMock
answers to `.attribution` and hides the bug), and the SQL it emits binds
exactly as many placeholders as it passes parameters.
"""
from __future__ import annotations

import datetime as dt
from unittest.mock import MagicMock, patch

import pytest

from ml import run_nightly
from ml.models.hourly_orders import ForecastRow as HourlyForecastRow
from ml.models.menu_item import ForecastRow as MenuItemForecastRow
from ml.models.revenue import ForecastRow as RevenueForecastRow


def _mk_conn() -> tuple[MagicMock, MagicMock]:
    """A mocked psycopg2 connection; returns (conn, cursor) so the test can
    read back every execute() the writer performed."""
    cur = MagicMock()
    cm = MagicMock()
    cm.__enter__ = lambda self: cur
    cm.__exit__ = lambda self, *a: None

    conn = MagicMock()
    conn.cursor.return_value = cm
    conn_cm = MagicMock()
    conn_cm.__enter__ = lambda self: conn
    conn_cm.__exit__ = lambda self, *a: None
    return conn_cm, cur


def _assert_placeholders_match_params(cur: MagicMock) -> None:
    """psycopg2 raises IndexError/TypeError at execute() time when the number
    of %s placeholders differs from the number of parameters. The MagicMock
    cursor happily swallows that, so assert the invariant directly."""
    assert cur.execute.call_count > 0, "writer never executed an INSERT"
    for call in cur.execute.call_args_list:
        sql, params = call.args
        # %%s is an escaped literal percent, not a placeholder; ::jsonb casts
        # follow a placeholder and must not be double-counted.
        placeholders = sql.replace("%%", "").count("%s")
        assert placeholders == len(params), (
            f"SQL binds {placeholders} placeholders but {len(params)} "
            f"parameters were passed:\n{sql}"
        )


def test_revenue_writer_binds_attribution():
    conn_cm, cur = _mk_conn()
    rows = [
        RevenueForecastRow(
            forecast_date=dt.date(2026, 8, 22),
            predicted_revenue=8275.0,
            p10=7000.0,
            p90=9500.0,
            attribution={"base": 6917.0, "groups": [{"label": "day of week", "value": 970.0}]},
        )
    ]

    with patch.object(run_nightly, "connect", return_value=conn_cm):
        written = run_nightly._write_revenue_forecasts("store-hwd", "v1", rows)

    assert written == 1
    _assert_placeholders_match_params(cur)
    sql, params = cur.execute.call_args.args
    assert '"attribution"' in sql
    # The attribution rides along as serialized JSON, not a dict.
    assert isinstance(params[-1], str) and "day of week" in params[-1]


def test_revenue_writer_accepts_row_without_attribution():
    """attribution is Optional — a booster that wouldn't produce one still writes."""
    conn_cm, cur = _mk_conn()
    rows = [
        RevenueForecastRow(
            forecast_date=dt.date(2026, 8, 22),
            predicted_revenue=8275.0,
            p10=7000.0,
            p90=9500.0,
        )
    ]

    with patch.object(run_nightly, "connect", return_value=conn_cm):
        written = run_nightly._write_revenue_forecasts("store-hwd", "v1", rows)

    assert written == 1
    _assert_placeholders_match_params(cur)
    assert cur.execute.call_args.args[1][-1] is None


def test_menu_item_writer_survives_real_forecast_row():
    """The exact production failure: ml.models.menu_item.ForecastRow has no
    `attribution` field, so reading one raised AttributeError for all 30 items."""
    conn_cm, cur = _mk_conn()
    rows = [
        MenuItemForecastRow(
            forecast_date=dt.date(2026, 8, 22),
            predicted_qty=42.0,
            p10=30.0,
            p90=55.0,
        )
    ]

    with patch.object(run_nightly, "connect", return_value=conn_cm):
        written = run_nightly._write_menu_item_forecasts(
            "store-hwd", "Double Slider", "v1", rows
        )

    assert written == 1
    _assert_placeholders_match_params(cur)
    sql, params = cur.execute.call_args.args
    # ForecastMenuItem has no attribution column — nothing may be bound for it.
    assert "attribution" not in sql
    assert params[2] == "Double Slider"


def test_hourly_orders_writer_survives_real_forecast_row():
    """Same defect on the BUSY_HOURS path, which failed as a whole target."""
    conn_cm, cur = _mk_conn()
    rows = [
        HourlyForecastRow(
            forecast_date=dt.date(2026, 8, 22),
            hour_bucket=18,
            predicted_orders=31.0,
            p10=22.0,
            p90=44.0,
        )
    ]

    with patch.object(run_nightly, "connect", return_value=conn_cm):
        written = run_nightly._write_hourly_order_forecasts("store-hwd", "v1", rows)

    assert written == 1
    _assert_placeholders_match_params(cur)
    sql, params = cur.execute.call_args.args
    assert "attribution" not in sql
    assert params[3] == 18


@pytest.mark.parametrize(
    "writer,args",
    [
        ("_write_revenue_forecasts", ("store-hwd", "v1", [])),
        ("_write_menu_item_forecasts", ("store-hwd", "Double Slider", "v1", [])),
        ("_write_hourly_order_forecasts", ("store-hwd", "v1", [])),
    ],
)
def test_writers_short_circuit_on_empty_rows(writer, args):
    """No rows must mean no connection is opened at all."""
    with patch.object(run_nightly, "connect") as connect:
        assert getattr(run_nightly, writer)(*args) == 0
    connect.assert_not_called()
