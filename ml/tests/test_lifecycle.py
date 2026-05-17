"""Tests for the warming_up -> ready lifecycle promotion gate."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from ml.lifecycle import (
    should_promote_to_ready,
    READY_PROMOTION_IMPROVEMENT_THRESHOLD,
    READY_PROMOTION_MIN_SAMPLE,
    flip_to_ready,
)


def test_should_promote_when_native_beats_transfer_by_threshold():
    # Native WAPE 0.20, transfer WAPE 0.25 -> relative improvement 20% (>5%).
    assert should_promote_to_ready(
        native_wape=0.20,
        transfer_wape=0.25,
        sample_size=READY_PROMOTION_MIN_SAMPLE,
    )


def test_should_not_promote_when_improvement_below_threshold():
    # Native 0.24 vs transfer 0.25 -> 4% improvement, below 5%.
    assert not should_promote_to_ready(
        native_wape=0.24,
        transfer_wape=0.25,
        sample_size=READY_PROMOTION_MIN_SAMPLE,
    )


def test_should_not_promote_when_sample_below_min():
    # Even a great improvement, but only 30 samples - below 60-day floor.
    assert not should_promote_to_ready(
        native_wape=0.10,
        transfer_wape=0.30,
        sample_size=30,
    )


def test_should_not_promote_when_transfer_wape_zero_or_missing():
    assert not should_promote_to_ready(
        native_wape=0.10,
        transfer_wape=0.0,
        sample_size=READY_PROMOTION_MIN_SAMPLE,
    )
    assert not should_promote_to_ready(
        native_wape=0.10,
        transfer_wape=None,
        sample_size=READY_PROMOTION_MIN_SAMPLE,
    )


def test_threshold_locked_at_five_percent():
    # Spec §1.4 locks the threshold at 5%.
    assert READY_PROMOTION_IMPROVEMENT_THRESHOLD == pytest.approx(0.05)


def test_min_sample_locked_at_sixty():
    # Spec §1.4 locks the minimum at 60.
    assert READY_PROMOTION_MIN_SAMPLE == 60


def test_flip_to_ready_executes_update_statement():
    cur = MagicMock()
    cur.__enter__ = lambda self: self
    cur.__exit__ = lambda *a: False
    cur.execute = MagicMock()
    conn = MagicMock()
    conn.__enter__ = lambda self: self
    conn.__exit__ = lambda *a: False
    conn.cursor.return_value = cur

    flip_to_ready(conn, store_id="store-gln")

    args = cur.execute.call_args
    assert "lifecycleStage" in args.args[0]
    assert "'ready'" in args.args[0]
    assert args.args[1] == ("store-gln",)
