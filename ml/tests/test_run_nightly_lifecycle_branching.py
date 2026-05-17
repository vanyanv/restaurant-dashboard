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
