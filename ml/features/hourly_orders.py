"""Hourly order-demand feature engineering.

The target is OtterHourlySummary.orderCount. Harri labor is context only:
actual/scheduled labor cost, position mix, shift volume, overtime, and
timekeeping-alert pressure are aggregated to one row per store-day before
joining to hourly demand.
"""
from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

from ml.db import connect
from ml.features.external_signals import (
    fill_event_daily_defaults,
    fill_weather_hourly_defaults,
    hourly_signal_feature_columns,
    load_hourly_external_signals,
)


_FIXED_HOLIDAYS = {
    (1, 1),
    (7, 4),
    (10, 31),
    (11, 11),
    (12, 24),
    (12, 25),
    (12, 31),
}


def _is_holiday(d: date) -> int:
    return 1 if (d.month, d.day) in _FIXED_HOLIDAYS else 0


def _date_col(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    if "date" in out:
        out["date"] = pd.to_datetime(out["date"])
    return out


def load_hourly_orders(store_id: str, lookback_days: int = 540) -> pd.DataFrame:
    sql = """
        SELECT date::date AS date,
               hour AS hour,
               SUM("orderCount")::float AS orders,
               SUM("netSales")::float AS net_sales
        FROM "OtterHourlySummary"
        WHERE "storeId" = %s
          AND date >= (CURRENT_DATE - %s::int)
        GROUP BY date, hour
        ORDER BY date, hour
    """
    with connect() as conn:
        df = pd.read_sql_query(sql, conn, params=(store_id, lookback_days))
    if df.empty:
        return df
    df = _date_col(df)
    return complete_hourly_grid(df)


def load_daily_context(store_id: str, lookback_days: int = 540) -> pd.DataFrame:
    sql = """
        SELECT date::date AS date,
               SUM(COALESCE("fpNetSales", 0) + COALESCE("tpNetSales", 0))::float AS revenue,
               SUM(COALESCE("fpOrderCount", 0) + COALESCE("tpOrderCount", 0))::float AS orders
        FROM "OtterDailySummary"
        WHERE "storeId" = %s
          AND date >= (CURRENT_DATE - %s::int)
        GROUP BY date
        ORDER BY date
    """
    with connect() as conn:
        df = pd.read_sql_query(sql, conn, params=(store_id, lookback_days))
    return _date_col(df)


def load_harri_features(
    store_id: str,
    lookback_days: int = 90,
    horizon_days: int = 14,
) -> pd.DataFrame:
    daily_sql = """
        SELECT date::date AS date,
               "actualCost" AS actual_cost,
               "forecastCost" AS scheduled_labor_cost
        FROM "HarriDailyLabor"
        WHERE "storeId" = %s
          AND date >= (CURRENT_DATE - %s::int)
          AND date < (CURRENT_DATE + %s::int)
        ORDER BY date
    """
    position_sql = """
        SELECT date::date AS date,
               "categoryCode" AS category_code,
               "positionCode" AS position_code,
               "totalLabor" AS total_labor,
               "overtimeAmount" AS overtime_amount,
               "totalShiftCount" AS total_shift_count,
               "actualSeconds" AS actual_seconds
        FROM "HarriPositionDaily"
        WHERE "storeId" = %s
          AND date >= (CURRENT_DATE - %s::int)
          AND date < (CURRENT_DATE + %s::int)
    """
    alert_sql = """
        SELECT date::date AS date,
               "alertCode" AS alert_code,
               "timeDiffSec" AS time_diff_sec
        FROM "HarriTimekeepingAlert"
        WHERE "storeId" = %s
          AND date >= (CURRENT_DATE - %s::int)
          AND date < (CURRENT_DATE + %s::int)
    """
    with connect() as conn:
        daily = pd.read_sql_query(
            daily_sql, conn, params=(store_id, lookback_days, horizon_days + 1)
        )
        positions = pd.read_sql_query(
            position_sql, conn, params=(store_id, lookback_days, horizon_days + 1)
        )
        alerts = pd.read_sql_query(
            alert_sql, conn, params=(store_id, lookback_days, horizon_days + 1)
        )
    return aggregate_harri_daily(daily, positions, alerts)


def complete_hourly_grid(hourly: pd.DataFrame) -> pd.DataFrame:
    if hourly.empty:
        return hourly
    hourly = _date_col(hourly)
    full_dates = pd.date_range(hourly["date"].min(), hourly["date"].max(), freq="D")
    grid = pd.MultiIndex.from_product([full_dates, range(24)], names=["date", "hour"])
    out = hourly.set_index(["date", "hour"]).reindex(grid).reset_index()
    for col in ("orders", "net_sales"):
        if col not in out:
            out[col] = 0.0
        out[col] = out[col].fillna(0.0).astype(float)
    return out.sort_values(["date", "hour"]).reset_index(drop=True)


def aggregate_harri_daily(
    daily: pd.DataFrame,
    positions: pd.DataFrame,
    alerts: pd.DataFrame,
) -> pd.DataFrame:
    daily = _date_col(daily)
    positions = _date_col(positions)
    alerts = _date_col(alerts)

    pieces: list[pd.DataFrame] = []
    if not daily.empty:
        daily = daily.copy()
        daily["has_harri_labor"] = (
            daily["actual_cost"].notna() | daily["scheduled_labor_cost"].notna()
        )
        base = daily.groupby("date", as_index=False).agg(
            actual_labor_cost=("actual_cost", lambda s: s.sum(min_count=1)),
            scheduled_labor_cost=("scheduled_labor_cost", lambda s: s.sum(min_count=1)),
            harri_coverage=("has_harri_labor", "max"),
        )
        base["labor_variance"] = (
            base["actual_labor_cost"] - base["scheduled_labor_cost"]
        )
        base["harri_coverage"] = base["harri_coverage"].astype(float)
        pieces.append(base)

    if not positions.empty:
        pos = positions.copy()
        pos["worked_hours"] = pos.get("actual_seconds", 0).fillna(0).astype(float) / 3600.0
        pos["shift_count"] = pos.get("total_shift_count", 0).fillna(0).astype(float)
        pos["overtime_amount"] = pos.get("overtime_amount", 0).fillna(0).astype(float)
        pos["total_labor"] = pos.get("total_labor", 0).fillna(0).astype(float)
        pos["position_code"] = pos.get("position_code", "").fillna("").astype(str)
        pos["category_code"] = pos.get("category_code", "").fillna("").astype(str)
        pos["is_kitchen"] = pos["position_code"].str.contains(
            "cook|kitchen|prep|dish|line", case=False, regex=True
        ) | pos["category_code"].str.contains("kitchen|boh|food|qs", case=False, regex=True)
        pos["is_service"] = pos["position_code"].str.contains(
            "cash|server|host|front|expo|runner", case=False, regex=True
        ) | pos["category_code"].str.contains("foh|service|cash", case=False, regex=True)
        pos["is_management"] = pos["position_code"].str.contains(
            "manager|operator|lead", case=False, regex=True
        ) | pos["category_code"].str.contains("manage", case=False, regex=True)
        grouped = pos.groupby("date").agg(
            worked_hours=("worked_hours", "sum"),
            shift_count=("shift_count", "sum"),
            overtime_amount=("overtime_amount", "sum"),
            position_count=("position_code", "nunique"),
            total_position_labor=("total_labor", "sum"),
            kitchen_labor=("total_labor", lambda s: s[pos.loc[s.index, "is_kitchen"]].sum()),
            service_labor=("total_labor", lambda s: s[pos.loc[s.index, "is_service"]].sum()),
            management_labor=("total_labor", lambda s: s[pos.loc[s.index, "is_management"]].sum()),
        ).reset_index()
        denom = grouped["total_position_labor"].replace(0, np.nan)
        grouped["kitchen_labor_share"] = (grouped["kitchen_labor"] / denom).fillna(0.0)
        grouped["service_labor_share"] = (grouped["service_labor"] / denom).fillna(0.0)
        grouped["management_labor_share"] = (grouped["management_labor"] / denom).fillna(0.0)
        grouped = grouped.drop(
            columns=["total_position_labor", "kitchen_labor", "service_labor", "management_labor"]
        )
        pieces.append(grouped)

    if not alerts.empty:
        al = alerts.copy()
        al["alert_code"] = al.get("alert_code", "").fillna("").astype(str)
        al["time_diff_minutes"] = al.get("time_diff_sec", 0).fillna(0).astype(float) / 60.0
        al["late_alert"] = al["alert_code"].str.contains("LATE", case=False, regex=False)
        al["missed_alert"] = al["alert_code"].str.contains("MISSED", case=False, regex=False)
        grouped = al.groupby("date").agg(
            alert_count=("alert_code", "count"),
            late_alert_count=("late_alert", "sum"),
            missed_alert_count=("missed_alert", "sum"),
            avg_time_diff_minutes=("time_diff_minutes", "mean"),
        ).reset_index()
        pieces.append(grouped)

    if not pieces:
        return pd.DataFrame(columns=["date", *harri_feature_columns()])

    out = pieces[0]
    for piece in pieces[1:]:
        out = out.merge(piece, on="date", how="outer")
    return fill_harri_defaults(out)


def fill_harri_defaults(df: pd.DataFrame) -> pd.DataFrame:
    out = _date_col(df)
    for col in harri_feature_columns():
        if col not in out:
            out[col] = 0.0
        out[col] = out[col].fillna(0.0).astype(float)
    return out.sort_values("date").reset_index(drop=True)


def build_feature_matrix(
    hourly: pd.DataFrame,
    daily: pd.DataFrame,
    harri_daily: pd.DataFrame | None = None,
) -> pd.DataFrame:
    if hourly.empty:
        return pd.DataFrame()

    hourly = complete_hourly_grid(hourly)
    daily = _date_col(daily)
    if daily.empty:
        daily = hourly.groupby("date", as_index=False).agg(
            orders=("orders", "sum"),
            revenue=("net_sales", "sum"),
        )
    else:
        daily = daily.copy()
        for col in ("orders", "revenue"):
            if col not in daily:
                daily[col] = 0.0
            daily[col] = daily[col].fillna(0.0).astype(float)

    out = hourly.merge(daily[["date", "orders", "revenue"]], on="date", how="left", suffixes=("", "_daily"))
    out = out.rename(columns={"orders": "target_orders", "orders_daily": "daily_orders"})
    out["daily_orders"] = out["daily_orders"].fillna(0.0).astype(float)
    out["revenue"] = out["revenue"].fillna(0.0).astype(float)
    out["avg_ticket"] = out["revenue"] / out["daily_orders"].replace(0, np.nan)
    out["avg_ticket"] = out["avg_ticket"].fillna(0.0)

    if harri_daily is None or harri_daily.empty:
        harri_daily = pd.DataFrame({"date": out["date"].drop_duplicates()})
    harri_daily = fill_harri_defaults(harri_daily)
    out = out.merge(harri_daily, on="date", how="left")
    out = fill_harri_defaults(out)

    out = out.sort_values(["date", "hour"]).reset_index(drop=True)
    out["weekday"] = out["date"].dt.weekday
    out["is_weekend"] = (out["weekday"] >= 5).astype(int)
    out["month"] = out["date"].dt.month
    out["day_of_month"] = out["date"].dt.day
    out["is_holiday"] = out["date"].dt.date.map(_is_holiday).astype(int)

    out["orders_lag_24"] = out["target_orders"].shift(24)
    out["orders_lag_168"] = out["target_orders"].shift(168)
    by_hour = out.groupby("hour")["target_orders"]
    out["orders_hour_lag_7d"] = by_hour.shift(7)
    out["orders_hour_roll_28d"] = out.groupby("hour")["target_orders"].transform(
        lambda s: s.shift(1).rolling(28, min_periods=3).mean()
    )
    out["orders_roll_24"] = out["target_orders"].rolling(24, min_periods=6).mean().shift(1)
    out["orders_roll_168"] = out["target_orders"].rolling(168, min_periods=24).mean().shift(1)

    daily_features = daily.sort_values("date").copy()
    daily_features["daily_orders_lag_1"] = daily_features["orders"].shift(1)
    daily_features["daily_orders_lag_7"] = daily_features["orders"].shift(7)
    daily_features["daily_revenue_lag_1"] = daily_features["revenue"].shift(1)
    daily_features["avg_ticket_lag_7"] = (
        daily_features["revenue"] / daily_features["orders"].replace(0, np.nan)
    ).rolling(7, min_periods=2).mean().shift(1)
    out = out.merge(
        daily_features[
            [
                "date",
                "daily_orders_lag_1",
                "daily_orders_lag_7",
                "daily_revenue_lag_1",
                "avg_ticket_lag_7",
            ]
        ],
        on="date",
        how="left",
    )
    return out


def build_enriched_feature_matrix(
    hourly: pd.DataFrame,
    daily: pd.DataFrame,
    harri_daily: pd.DataFrame | None = None,
    external_hourly: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Build baseline hourly features plus hourly weather and daily events."""
    out = build_feature_matrix(hourly, daily, harri_daily)
    if out.empty:
        return out
    if external_hourly is None or external_hourly.empty:
        dates = out["date"].drop_duplicates()
        external_hourly = pd.MultiIndex.from_product(
            [dates, range(24)], names=["date", "hour"]
        ).to_frame(index=False)
    external_hourly = fill_event_daily_defaults(fill_weather_hourly_defaults(external_hourly))
    out = out.merge(external_hourly, on=["date", "hour"], how="left")
    out = fill_event_daily_defaults(fill_weather_hourly_defaults(out))
    return out


def harri_feature_columns() -> list[str]:
    return [
        "actual_labor_cost",
        "scheduled_labor_cost",
        "labor_variance",
        "harri_coverage",
        "worked_hours",
        "shift_count",
        "overtime_amount",
        "position_count",
        "kitchen_labor_share",
        "service_labor_share",
        "management_labor_share",
        "alert_count",
        "late_alert_count",
        "missed_alert_count",
        "avg_time_diff_minutes",
    ]


def feature_columns() -> list[str]:
    return [
        "hour",
        "weekday",
        "is_weekend",
        "month",
        "day_of_month",
        "is_holiday",
        "orders_lag_24",
        "orders_lag_168",
        "orders_hour_lag_7d",
        "orders_hour_roll_28d",
        "orders_roll_24",
        "orders_roll_168",
        "daily_orders_lag_1",
        "daily_orders_lag_7",
        "daily_revenue_lag_1",
        "avg_ticket_lag_7",
        *harri_feature_columns(),
    ]


def enriched_feature_columns() -> list[str]:
    return [*feature_columns(), *hourly_signal_feature_columns()]


def load_order_external_signals(
    store_id: str,
    start_date: date | None = None,
    end_date: date | None = None,
) -> pd.DataFrame:
    return load_hourly_external_signals(store_id, start_date, end_date)


def split_train_holdout(
    df: pd.DataFrame,
    holdout_days: int = 14,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    clean = df.dropna(subset=feature_columns()).sort_values(["date", "hour"]).reset_index(drop=True)
    if clean.empty:
        return clean, clean
    cutoff = clean["date"].max() - pd.Timedelta(days=holdout_days - 1)
    train_df = clean[clean["date"] < cutoff]
    holdout_df = clean[clean["date"] >= cutoff]
    if train_df.empty or holdout_df.empty:
        midpoint = len(clean) // 2
        return clean.iloc[:midpoint], clean.iloc[midpoint:]
    return train_df, holdout_df
