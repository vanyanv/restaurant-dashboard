"""TreeSHAP contributions, grouped into things an owner recognises.

The page showed a forecast and three grey confidence dots. XGBoost has known why
it predicted each number the whole time — `pred_contribs=True` returns exact
per-feature contributions plus a bias term that sum to the prediction — and
nothing called it.

Raw per-feature output is the wrong unit for the audience: 43 columns weighing
`lag_7` against `roll_28`. These tests pin the grouping, the ordering, and above
all that the waterfall still adds up to the forecast after small groups are
folded away.
"""
from __future__ import annotations

import numpy as np
import pytest

from ml.models.attribution import (
    MIN_SHARE,
    OTHER_LABEL,
    build_attribution,
    group_contributions,
    group_for,
)


class TestGrouping:
    @pytest.mark.parametrize("feature,expected", [
        ("weather_max_temp_c", "Weather"),
        ("weather_rain_hours", "Weather"),
        ("event_top_attendance", "Nearby events"),
        ("event_major_count", "Nearby events"),
        ("weekday", "Day of week"),
        ("is_weekend", "Day of week"),
        ("is_holiday", "Holiday"),
        ("month", "Time of year"),
        ("day_of_month", "Time of year"),
        ("lag_1", "Recent days"),
        ("lag_28", "Recent days"),
        ("roll_7", "Recent trend"),
        ("roll_7_std", "Recent trend"),
        ("growth_rate_90", "Recent trend"),
    ])
    def test_every_real_feature_lands_somewhere(self, feature, expected):
        assert group_for(feature) == expected

    def test_an_unknown_feature_is_not_silently_dropped(self):
        assert group_for("some_new_column") is None
        grouped = group_contributions(["some_new_column"], [42.0])
        assert grouped[OTHER_LABEL] == 42.0

    def test_holiday_is_not_swallowed_by_the_weekday_group(self):
        """`is_holiday` and `is_weekend` both start with `is_`, and Mother's Day
        landing under "Day of week" would be actively misleading."""
        assert group_for("is_holiday") == "Holiday"

    def test_features_in_a_group_are_summed(self):
        grouped = group_contributions(["lag_1", "lag_7", "roll_7"], [100.0, 50.0, -20.0])
        assert grouped["Recent days"] == 150.0
        assert grouped["Recent trend"] == -20.0


class TestWaterfall:
    def _shap(self):
        names = ["weekday", "is_weekend", "lag_1", "roll_28", "weather_max_temp_c",
                 "event_top_attendance", "month"]
        values = [1800.0, 300.0, -260.0, -50.0, 140.0, 1180.0, 3.0]
        return names, values

    def test_parts_sum_to_the_prediction(self):
        """The whole point of a waterfall. If folding small groups into the base
        broke the arithmetic, the chart would be a lie that looks like a fact."""
        names, values = self._shap()
        base = 6190.0
        predicted = base + sum(values)
        out = build_attribution(
            base_value=base, feature_names=names, contributions=values,
            predicted=predicted,
        )
        total = out["base"] + sum(g["value"] for g in out["groups"])
        assert total == pytest.approx(predicted, abs=0.02)

    def test_biggest_mover_comes_first(self):
        names, values = self._shap()
        out = build_attribution(
            base_value=6190.0, feature_names=names, contributions=values,
            predicted=6190.0 + sum(values),
        )
        labels = [g["label"] for g in out["groups"]]
        assert labels[0] == "Day of week"       # 1800 + 300
        assert labels[1] == "Nearby events"     # 1180

    def test_ordering_is_by_magnitude_not_sign(self):
        """A big drag matters as much as a big lift."""
        out = build_attribution(
            base_value=5000.0,
            feature_names=["weekday", "event_total_count"],
            contributions=[100.0, -900.0],
            predicted=4200.0,
        )
        assert out["groups"][0]["label"] == "Nearby events"

    def test_tiny_groups_are_folded_away_rather_than_listed(self):
        names, values = self._shap()
        out = build_attribution(
            base_value=6190.0, feature_names=names, contributions=values,
            predicted=6190.0 + sum(values),
        )
        # `month` contributes 3.0 on a ~$9k day — far below the 1% threshold.
        assert "Time of year" not in [g["label"] for g in out["groups"]]

    def test_a_large_residual_earns_its_own_row(self):
        out = build_attribution(
            base_value=5000.0,
            feature_names=["mystery_a", "mystery_b", "weekday"],
            contributions=[400.0, 400.0, 1000.0],
            predicted=6800.0,
        )
        labels = [g["label"] for g in out["groups"]]
        assert OTHER_LABEL in labels
        total = out["base"] + sum(g["value"] for g in out["groups"])
        assert total == pytest.approx(6800.0, abs=0.02)

    def test_a_featureless_day_is_just_the_base(self):
        out = build_attribution(
            base_value=6000.0, feature_names=["weekday"], contributions=[0.0],
            predicted=6000.0,
        )
        assert out["groups"] == []
        assert out["base"] == pytest.approx(6000.0)

    def test_threshold_scales_with_the_day(self):
        """1% of a $9k Saturday is $90; 1% of a $500 day is $5. A fixed dollar
        cut-off would bury real movers on small days and clutter big ones."""
        small = build_attribution(
            base_value=400.0, feature_names=["weekday"], contributions=[20.0],
            predicted=420.0,
        )
        assert [g["label"] for g in small["groups"]] == ["Day of week"]
        assert MIN_SHARE == 0.01


def test_against_a_real_xgboost_model():
    """End-to-end: contributions from an actual booster must reconstruct its own
    prediction. This is what catches a wrong column order or a dropped bias term
    — the failure modes that unit tests on synthetic vectors cannot see."""
    from xgboost import XGBRegressor, DMatrix

    rng = np.random.default_rng(0)
    X = rng.normal(size=(300, 4))
    y = 5000 + 800 * X[:, 0] - 300 * X[:, 1] + rng.normal(0, 50, size=300)
    names = ["weekday", "lag_1", "roll_7", "weather_max_temp_c"]

    model = XGBRegressor(n_estimators=40, max_depth=3, random_state=0)
    model.fit(X, y)

    row = X[:1]
    predicted = float(model.predict(row)[0])
    contribs = model.get_booster().predict(DMatrix(row, feature_names=names), pred_contribs=True)[0]
    base_value, feature_contribs = float(contribs[-1]), [float(v) for v in contribs[:-1]]

    assert base_value + sum(feature_contribs) == pytest.approx(predicted, rel=1e-4)

    out = build_attribution(
        base_value=base_value, feature_names=names,
        contributions=feature_contribs, predicted=predicted,
    )
    total = out["base"] + sum(g["value"] for g in out["groups"])
    assert total == pytest.approx(predicted, abs=0.05)
