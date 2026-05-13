import pytest
from ml.run_nightly import decide_promotion


def test_promotion_passes_when_enriched_beats_both_baselines():
    decision = decide_promotion(
        enriched_wape=0.10,
        baseline_xgb_wape=0.115,   # enriched beats by ~13%
        seasonal_naive_wape=0.115, # enriched beats by ~13%
        improvement_threshold=0.05,
    )
    assert decision.promoted is True
    assert decision.label == "enriched"
    assert "beats" in decision.reason


def test_promotion_fails_when_seasonal_naive_too_close():
    decision = decide_promotion(
        enriched_wape=0.10,
        baseline_xgb_wape=0.115,
        seasonal_naive_wape=0.103,  # only ~3% relative improvement
        improvement_threshold=0.05,
    )
    assert decision.promoted is False
    assert decision.label == "fallback"


def test_promotion_fails_when_baseline_xgb_too_close():
    decision = decide_promotion(
        enriched_wape=0.10,
        baseline_xgb_wape=0.102,
        seasonal_naive_wape=0.120,
        improvement_threshold=0.05,
    )
    assert decision.promoted is False
    assert decision.label == "fallback"
