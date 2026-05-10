import unittest
from types import SimpleNamespace

import pandas as pd

from ml.features.external_signals import (
    external_signal_coverage,
    normalize_open_meteo_hourly,
    normalize_predicthq_events,
    normalize_predicthq_features,
)
from ml.features.hourly_orders import (
    build_enriched_feature_matrix,
    enriched_feature_columns as hourly_enriched_columns,
)
from ml.features.revenue import (
    build_enriched_features,
    enriched_feature_columns as revenue_enriched_columns,
)
from ml.run_nightly import should_promote_enriched


class ExternalSignalNormalizationTest(unittest.TestCase):
    def test_open_meteo_hourly_normalization(self):
        payload = {
            "hourly": {
                "time": ["2026-05-08T12:00", "2026-05-08T13:00"],
                "temperature_2m": [18.2, 19.0],
                "apparent_temperature": [17.8, 18.5],
                "precipitation": [0.0, 2.4],
                "precipitation_probability": [10, 80],
                "wind_speed_10m": [7.5, 9.2],
                "relative_humidity_2m": [62, 66],
                "weather_code": [3, 61],
            }
        }
        df = normalize_open_meteo_hourly(payload)
        self.assertEqual(len(df), 2)
        self.assertEqual(df.iloc[1]["hour"], 13)
        self.assertEqual(df.iloc[1]["weather_precip_probability_pct"], 80)
        self.assertEqual(df["has_weather_signal"].mean(), 1.0)

    def test_predicthq_features_normalization(self):
        payload = {
            "results": [
                {
                    "date": "2026-05-08",
                    "features": {
                        "hospitality_impact": 3.2,
                        "demand": {"spend": 6400},
                        "phq_attendance": 7200,
                        "event_count": 2,
                        "categories": {"sports": 1, "concerts": 1},
                    },
                }
            ]
        }
        df = normalize_predicthq_features(payload, radius_miles=3)
        self.assertEqual(len(df), 1)
        self.assertEqual(df.iloc[0]["event_hospitality_impact"], 3.2)
        self.assertEqual(df.iloc[0]["event_hospitality_spend"], 6400)
        self.assertEqual(df.iloc[0]["event_sports_count"], 1)
        self.assertEqual(df.iloc[0]["event_radius_miles"], 3)

    def test_predicthq_events_normalization(self):
        payload = {
            "results": [
                {
                    "id": "event_1",
                    "title": "Dodgers Game",
                    "category": "sports",
                    "labels": ["baseball"],
                    "rank": 72,
                    "local_rank": 88,
                    "phq_attendance": 52000,
                    "start": "2026-05-08T19:10:00Z",
                    "end": "2026-05-08T22:00:00Z",
                    "location": [-118.2400, 34.0739],
                    "entities": [{"type": "venue", "entity_id": "v1", "name": "Dodger Stadium"}],
                }
            ]
        }
        df = normalize_predicthq_events(payload, store_lat=34.1016, store_lon=-118.3269)
        self.assertEqual(len(df), 1)
        self.assertEqual(df.iloc[0]["provider_event_id"], "event_1")
        self.assertEqual(df.iloc[0]["category"], "sports")
        self.assertEqual(df.iloc[0]["local_rank"], 88)
        self.assertGreater(df.iloc[0]["distance_miles"], 0)

    def test_revenue_enriched_features_fill_missing_signals(self):
        history = pd.DataFrame(
            {
                "date": pd.date_range("2026-01-01", periods=100, freq="D"),
                "revenue": [1000.0] * 100,
            }
        )
        feats = build_enriched_features(history, pd.DataFrame())
        for col in revenue_enriched_columns():
            self.assertIn(col, feats.columns)
        self.assertEqual(feats["has_weather_signal"].max(), 0.0)
        self.assertEqual(feats["has_event_signal"].max(), 0.0)

    def test_hourly_enriched_features_join_hourly_weather_and_events(self):
        hourly_rows = []
        for day in pd.date_range("2026-01-01", periods=45, freq="D"):
            for hour in range(24):
                hourly_rows.append({"date": day, "hour": hour, "orders": 2.0, "net_sales": 50.0})
        hourly = pd.DataFrame(hourly_rows)
        daily = pd.DataFrame(
            {
                "date": pd.date_range("2026-01-01", periods=45, freq="D"),
                "orders": [48.0] * 45,
                "revenue": [1200.0] * 45,
            }
        )
        external = pd.DataFrame(
            {
                "date": [pd.Timestamp("2026-01-10")],
                "hour": [12],
                "weather_precip_mm": [4.0],
                "has_weather_signal": [1.0],
                "event_sports_count": [1.0],
                "event_top_local_rank": [88.0],
                "event_major_count": [1.0],
                "has_event_signal": [1.0],
            }
        )
        feats = build_enriched_feature_matrix(hourly, daily, pd.DataFrame(), external)
        for col in hourly_enriched_columns():
            self.assertIn(col, feats.columns)
        row = feats[(feats["date"] == pd.Timestamp("2026-01-10")) & (feats["hour"] == 12)].iloc[0]
        self.assertEqual(row["weather_precip_mm"], 4.0)
        self.assertEqual(row["event_sports_count"], 1.0)
        self.assertEqual(row["event_top_local_rank"], 88.0)

    def test_external_signal_coverage_and_promotion_gate(self):
        df = pd.DataFrame({"has_weather_signal": [1, 1, 0], "has_event_signal": [0, 1, 0]})
        self.assertAlmostEqual(external_signal_coverage(df), 2 / 3)
        baseline = SimpleNamespace(mape=0.10, mae=100)
        enriched = SimpleNamespace(mape=0.096, mae=102)
        self.assertTrue(should_promote_enriched(baseline, enriched))
        worse = SimpleNamespace(mape=0.11, mae=80)
        self.assertFalse(should_promote_enriched(baseline, worse))


if __name__ == "__main__":
    unittest.main()
