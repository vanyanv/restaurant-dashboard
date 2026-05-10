import datetime as dt
import unittest

import numpy as np
import pandas as pd

from ml.features.hourly_orders import (
    aggregate_harri_daily,
    build_feature_matrix,
    feature_columns,
    split_train_holdout,
)
from ml.models.hourly_orders import ForecastRow, TrainResult, forecast


class ConstantModel:
    def predict(self, arr):
        return np.full(len(arr), 8.0)


def hourly_history(days=70):
    rows = []
    start = pd.Timestamp("2026-01-01")
    for day in range(days):
        date = start + pd.Timedelta(days=day)
        for hour in range(24):
            orders = 20 if 11 <= hour <= 13 else 2 if 17 <= hour <= 19 else 0
            rows.append({"date": date, "hour": hour, "orders": orders, "net_sales": orders * 25.0})
    return pd.DataFrame(rows)


def daily_history(days=70):
    start = pd.Timestamp("2026-01-01")
    return pd.DataFrame(
        {
            "date": [start + pd.Timedelta(days=i) for i in range(days)],
            "orders": [72.0] * days,
            "revenue": [1800.0] * days,
        }
    )


class HourlyOrderFeaturesTest(unittest.TestCase):
    def test_harri_feature_aggregation(self):
        daily = pd.DataFrame(
            {
                "date": [pd.Timestamp("2026-02-01")],
                "actual_cost": [800.0],
                "scheduled_labor_cost": [760.0],
            }
        )
        positions = pd.DataFrame(
            {
                "date": [pd.Timestamp("2026-02-01"), pd.Timestamp("2026-02-01")],
                "category_code": ["QS", "MANAGE"],
                "position_code": ["line-cook", "operator"],
                "total_labor": [500.0, 300.0],
                "overtime_amount": [25.0, 0.0],
                "total_shift_count": [5, 1],
                "actual_seconds": [5 * 3600, 8 * 3600],
            }
        )
        alerts = pd.DataFrame(
            {
                "date": [pd.Timestamp("2026-02-01"), pd.Timestamp("2026-02-01")],
                "alert_code": ["LATE_CLOCK_OUT", "MISSED_CLOCK_OUT_OT_NOW"],
                "time_diff_sec": [600, 1200],
            }
        )
        out = aggregate_harri_daily(daily, positions, alerts)
        self.assertEqual(len(out), 1)
        row = out.iloc[0]
        self.assertEqual(row["actual_labor_cost"], 800.0)
        self.assertEqual(row["scheduled_labor_cost"], 760.0)
        self.assertEqual(row["labor_variance"], 40.0)
        self.assertEqual(row["shift_count"], 6)
        self.assertEqual(row["alert_count"], 2)
        self.assertEqual(row["late_alert_count"], 1)
        self.assertEqual(row["missed_alert_count"], 1)
        self.assertAlmostEqual(row["kitchen_labor_share"], 0.625)

    def test_missing_harri_fills_zero_features(self):
        feats = build_feature_matrix(hourly_history(), daily_history(), pd.DataFrame())
        clean = feats.dropna(subset=feature_columns())
        self.assertGreater(len(clean), 0)
        self.assertEqual(clean["harri_coverage"].max(), 0.0)
        self.assertEqual(clean["scheduled_labor_cost"].max(), 0.0)

    def test_feature_matrix_shape(self):
        harri = pd.DataFrame(
            {
                "date": daily_history()["date"],
                "scheduled_labor_cost": [700.0] * 70,
                "harri_coverage": [1.0] * 70,
            }
        )
        feats = build_feature_matrix(hourly_history(), daily_history(), harri)
        self.assertEqual(len(feats), 70 * 24)
        for col in feature_columns():
            self.assertIn(col, feats.columns)
        self.assertIn("target_orders", feats.columns)

    def test_chronological_train_holdout_split(self):
        feats = build_feature_matrix(hourly_history(), daily_history(), pd.DataFrame())
        train_df, holdout_df = split_train_holdout(feats, holdout_days=14)
        self.assertGreater(len(train_df), 0)
        self.assertGreater(len(holdout_df), 0)
        self.assertLess(train_df["date"].max(), holdout_df["date"].min())

    def test_forecast_row_generation(self):
        history = hourly_history()
        daily = daily_history()
        result = TrainResult(
            model=ConstantModel(),
            mape=0.1,
            mae=2.0,
            sample_size=100,
            holdout_residual_std=1.0,
            harri_coverage=0.5,
            history=history,
            daily=daily,
            harri_daily=pd.DataFrame(),
        )
        rows = forecast("s1", result, horizon_days=2)
        self.assertEqual(len(rows), 48)
        self.assertIsInstance(rows[0], ForecastRow)
        self.assertEqual(rows[0].forecast_date, dt.date(2026, 3, 12))
        self.assertEqual(rows[0].hour_bucket, 0)
        self.assertEqual(rows[0].predicted_orders, 8.0)


if __name__ == "__main__":
    unittest.main()
