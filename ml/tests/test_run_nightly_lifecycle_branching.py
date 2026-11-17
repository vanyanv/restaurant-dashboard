"""Tests that run_nightly.main() branches correctly on Store.lifecycleStage.

Mocks the per-store run functions so we only verify dispatch logic.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch


def _stage_dispatcher(mapping: dict[tuple[str, ...], list[str]]):
    def side_effect(stages):
        return mapping[stages]
    return side_effect


@patch("ml.run_nightly.run_anomaly_detection_for_store", return_value={"ok": True})
@patch("ml.run_nightly.run_elasticity_for_store", return_value={"ok": True})
@patch("ml.run_nightly.reconcile_past_forecasts", return_value={"ok": True})
@patch("ml.run_nightly.run_busy_hours_for_store", return_value={"ok": True})
@patch("ml.run_nightly.run_menu_items_for_store", return_value={"ok": True})
@patch("ml.run_nightly.run_revenue_for_store", return_value={"ok": True})
@patch("ml.run_nightly.write_transfer_forecasts_for_store")
@patch("ml.run_nightly.list_stores_by_stage")
@patch("ml.run_nightly.connect")
def test_pre_open_stores_are_skipped(
    mock_connect, mock_list, mock_transfer, mock_rev, *_,
):
    from ml.run_nightly import main
    mock_list.side_effect = _stage_dispatcher({
        ("pre_open",): ["store-vnys"],
        ("warming_up",): [],
        ("ready",): [],
    })
    mock_connect.return_value.__enter__.return_value = MagicMock()

    rc = main()

    assert rc == 0
    mock_rev.assert_not_called()
    mock_transfer.assert_not_called()


@patch("ml.run_nightly.run_anomaly_detection_for_store", return_value={"ok": True})
@patch("ml.run_nightly.run_elasticity_for_store", return_value={"ok": True})
@patch("ml.run_nightly.reconcile_past_forecasts", return_value={"ok": True})
@patch("ml.run_nightly.run_busy_hours_for_store", return_value={"ok": True})
@patch("ml.run_nightly.run_menu_items_for_store", return_value={"ok": True})
@patch("ml.run_nightly.run_revenue_for_store", return_value={"ok": True, "sample_size": 30})
@patch("ml.run_nightly.run_transfer_forecasts_for_store",
       return_value={"ok": True, "rows_written": 14, "scalar_used": 0.5})
@patch("ml.run_nightly.resolve_hollywood_store_id", return_value="store-hwd")
@patch("ml.run_nightly.maybe_promote_to_ready",
       return_value={"store_id": "store-gln", "promoted": False, "reason": "insufficient_sample"})
@patch("ml.run_nightly.list_stores_by_stage")
@patch("ml.run_nightly.connect")
def test_warming_up_stores_get_transfer_writes(
    mock_connect, mock_list, _promo, _resolve, mock_transfer_wrap, mock_rev, *_,
):
    from ml.run_nightly import main
    mock_list.side_effect = _stage_dispatcher({
        ("pre_open",): [],
        ("warming_up",): ["store-gln"],
        ("ready",): [],
    })
    mock_connect.return_value.__enter__.return_value = MagicMock()

    rc = main()

    assert rc == 0
    mock_transfer_wrap.assert_called_once()
    # Warming-up stores also train native (so the gate has something to compare).
    mock_rev.assert_called_once()
    assert mock_rev.call_args.args[0] == "store-gln"


@patch("ml.run_nightly.run_anomaly_detection_for_store", return_value={"ok": True})
@patch("ml.run_nightly.run_elasticity_for_store", return_value={"ok": True})
@patch("ml.run_nightly.reconcile_past_forecasts", return_value={"ok": True})
@patch("ml.run_nightly.run_busy_hours_for_store", return_value={"ok": True})
@patch("ml.run_nightly.run_menu_items_for_store", return_value={"ok": True})
@patch("ml.run_nightly.run_revenue_for_store", return_value={"ok": True})
@patch("ml.run_nightly.run_transfer_forecasts_for_store")
@patch("ml.run_nightly.list_stores_by_stage")
@patch("ml.run_nightly.connect")
@patch("ml.run_nightly.run_evaluation_pass")
@patch("ml.run_nightly.run_consistency_check")
def test_ready_stores_train_native_no_transfer(
    _consistency, _evaluate, mock_connect, mock_list, mock_transfer_wrap, mock_rev, *_,
):
    from ml.run_nightly import main
    mock_list.side_effect = _stage_dispatcher({
        ("pre_open",): [],
        ("warming_up",): [],
        ("ready",): ["store-hwd"],
    })
    mock_connect.return_value.__enter__.return_value = MagicMock()

    rc = main()

    assert rc == 0
    assert mock_rev.call_count == 1
    assert mock_rev.call_args.args[0] == "store-hwd"
    mock_transfer_wrap.assert_not_called()


# --- A store set to Open in store settings goes straight to `ready` --------
#
# Van Nuys and Glendale did, with weeks of sales rather than 60 days, and
# every nightly from 2026-10-29 exited 1 on REVENUE `insufficient_history`
# plus MENU_ITEM `all_items_failed` for them. Waiting for history is not a
# failed night; anything else still is.

_READY_PIPELINE_PATCHES = (
    patch("ml.run_nightly.run_anomaly_detection_for_store", return_value={"ok": True}),
    patch("ml.run_nightly.run_elasticity_for_store", return_value={"ok": True}),
    patch("ml.run_nightly.reconcile_past_forecasts", return_value={"ok": True}),
    patch("ml.run_nightly.run_hierarchical_reconciliation_for_store", return_value={"ok": True}),
    patch("ml.run_nightly.run_growth_opportunities_for_store", return_value={"total_written": 0}),
    patch("ml.run_nightly.run_evaluation_pass", return_value=0),
    patch("ml.run_nightly.run_consistency_check"),
    patch("ml.run_nightly.run_transfer_forecasts_for_store"),
)


def _run_ready_store(revenue: dict, menu: dict, busy: dict | None = None,
                     never_trained: bool = True) -> int:
    from ml.run_nightly import main

    with patch("ml.run_nightly._never_trained", return_value=never_trained), \
         patch("ml.run_nightly.list_stores_by_stage") as mock_list, \
         patch("ml.run_nightly.connect") as mock_connect, \
         patch("ml.run_nightly.run_busy_hours_for_store", return_value=busy or {"ok": True}), \
         patch("ml.run_nightly.run_revenue_for_store", return_value=revenue), \
         patch("ml.run_nightly.run_menu_items_for_store", return_value=menu):
        for p in _READY_PIPELINE_PATCHES:
            p.start()
        try:
            mock_list.side_effect = _stage_dispatcher({
                ("pre_open",): [],
                ("warming_up",): [],
                ("ready",): ["store-vnys"],
            })
            mock_connect.return_value.__enter__.return_value = MagicMock()
            return main()
        finally:
            for p in _READY_PIPELINE_PATCHES:
                p.stop()


def test_ready_store_waiting_for_history_is_not_a_failure():
    rc = _run_ready_store(
        revenue={"ok": False, "reason": "insufficient_history"},
        menu={"ok": False, "reason": "insufficient_history", "failed_count": 30},
    )
    assert rc == 0


def test_ready_store_menu_items_that_raised_still_fail_the_night():
    rc = _run_ready_store(
        revenue={"ok": True},
        menu={"ok": False, "reason": "all_items_failed", "failed_count": 30},
    )
    assert rc == 1


def test_ready_store_revenue_failing_for_another_reason_still_fails_the_night():
    rc = _run_ready_store(
        revenue={"ok": False, "reason": "db_timeout"},
        menu={"ok": True},
    )
    assert rc == 1


def test_ready_store_short_history_does_not_hide_other_failures():
    rc = _run_ready_store(
        revenue={"ok": False, "reason": "insufficient_history"},
        menu={"ok": False, "reason": "insufficient_history", "failed_count": 3},
        busy={"ok": False, "reason": "boom"},
    )
    assert rc == 1


def test_store_that_trained_before_and_now_reads_short_still_fails():
    # Hollywood's sales rows deleted or its menu re-imported under new names
    # reads as "insufficient history" too; that is data loss, not a new store.
    rc = _run_ready_store(
        revenue={"ok": False, "reason": "insufficient_history"},
        menu={"ok": False, "reason": "insufficient_history", "failed_count": 30},
        never_trained=False,
    )
    assert rc == 1


def test_never_trained_reads_succeeded_runs_for_that_store_and_target():
    from ml import run_nightly

    with patch("ml.run_nightly.connect") as mock_connect:
        cur = mock_connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
        cur.fetchone.return_value = None
        assert run_nightly._never_trained("store-vnys", "REVENUE") is True
        sql, params = cur.execute.call_args.args
        assert "status = 'SUCCEEDED'" in sql
        assert params == ("store-vnys", "REVENUE")

        cur.fetchone.return_value = (1,)
        assert run_nightly._never_trained("store-hwd", "MENU_ITEM") is False
