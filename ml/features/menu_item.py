"""Menu-item demand feature engineering.

For v1 we treat OtterMenuItem.itemName as the stable per-store identifier
and store it in the `otterItemSkuId` column. When the SKU mapping flow
matures we can migrate to OtterItemMapping.skuId without changing this
module's interface.

We forecast the top-N items per store (by trailing 90-day quantity) so
training time stays bounded. Low-velocity items don't have enough signal
to learn from anyway — if they show up, they fall under anomaly
detection later.
"""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd

from ml.db import connect


def load_top_items(store_id: str, top_n: int = 30, lookback_days: int = 90) -> list[str]:
    """Most-sold items at a store over the last `lookback_days`.

    Returns a list of itemName strings — used as the otterItemSkuId in
    forecast rows. Excludes modifiers (isModifier = true).
    """
    sql = """
        SELECT "itemName",
               SUM(COALESCE("fpQuantitySold", 0) + COALESCE("tpQuantitySold", 0)) AS qty
        FROM "OtterMenuItem"
        WHERE "storeId" = %s
          AND "isModifier" = false
          AND date >= (CURRENT_DATE - %s::int)
        GROUP BY "itemName"
        HAVING SUM(COALESCE("fpQuantitySold", 0) + COALESCE("tpQuantitySold", 0)) > 0
        ORDER BY qty DESC
        LIMIT %s
    """
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (store_id, lookback_days, top_n))
            return [row[0] for row in cur.fetchall()]


def load_daily_quantity(
    store_id: str, item_name: str, lookback_days: int = 540
) -> pd.DataFrame:
    """Daily total quantity (FP + 3P) for one (store, item)."""
    sql = """
        SELECT date::date AS date,
               SUM(COALESCE("fpQuantitySold", 0) + COALESCE("tpQuantitySold", 0)) AS qty
        FROM "OtterMenuItem"
        WHERE "storeId" = %s
          AND "itemName" = %s
          AND "isModifier" = false
          AND date >= (CURRENT_DATE - %s::int)
        GROUP BY date
        ORDER BY date
    """
    with connect() as conn:
        df = pd.read_sql_query(sql, conn, params=(store_id, item_name, lookback_days))

    if df.empty:
        return df

    df["date"] = pd.to_datetime(df["date"])
    full_range = pd.date_range(df["date"].min(), df["date"].max(), freq="D")
    df = (
        df.set_index("date")
        .reindex(full_range)
        .fillna({"qty": 0.0})
        .rename_axis("date")
        .reset_index()
    )
    df["qty"] = df["qty"].astype(float)
    return df


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df.assign()

    out = df.copy()
    out["weekday"] = out["date"].dt.weekday
    out["is_weekend"] = (out["weekday"] >= 5).astype(int)
    out["month"] = out["date"].dt.month
    out["day_of_month"] = out["date"].dt.day

    for lag in (1, 7, 14, 28):
        out[f"lag_{lag}"] = out["qty"].shift(lag)

    out["roll_7"] = out["qty"].rolling(7).mean().shift(1)
    out["roll_28"] = out["qty"].rolling(28).mean().shift(1)
    out["roll_7_std"] = out["qty"].rolling(7).std().shift(1)
    out["roll_90"] = out["qty"].rolling(90).mean().shift(1)
    out["growth_rate_90"] = (out["roll_28"] - out["roll_90"]) / out["roll_90"].replace(0, np.nan)
    return out


def feature_columns() -> list[str]:
    return [
        "weekday",
        "is_weekend",
        "month",
        "day_of_month",
        "lag_1",
        "lag_7",
        "lag_14",
        "lag_28",
        "roll_7",
        "roll_28",
        "roll_7_std",
        "roll_90",
        "growth_rate_90",
    ]


def split_train_holdout(
    df: pd.DataFrame, holdout_days: int = 21
) -> tuple[pd.DataFrame, pd.DataFrame]:
    df = df.dropna(subset=feature_columns()).reset_index(drop=True)
    if len(df) <= holdout_days:
        return df.iloc[: len(df) // 2], df.iloc[len(df) // 2 :]
    return df.iloc[:-holdout_days], df.iloc[-holdout_days:]


def latest_history_date(store_id: str, item_name: str) -> dt.date | None:
    sql = (
        'SELECT MAX(date) FROM "OtterMenuItem" '
        'WHERE "storeId" = %s AND "itemName" = %s AND "isModifier" = false'
    )
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (store_id, item_name))
            row = cur.fetchone()
            return row[0] if row and row[0] else None
