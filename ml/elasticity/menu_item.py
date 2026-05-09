"""Per-item price elasticity via OLS log(qty) ~ log(price) + weekday dummies.

For each (store, item) we pull daily quantity + effective unit price
(fpTotalSales / fpQuantitySold blended with the 3P side) and fit a
small OLS. The price coefficient IS the elasticity. Weekday dummies
absorb seasonality so we're not attributing weekend volume to price.

This is a v1 — clean, interpretable, ~150 LOC. Endogeneity (price
endogenous to demand shocks) is a known limitation; the dashboard
flags low fitR2 / no-signal items so the operator can see when to
distrust the coefficient.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from ml.db import connect, cuid_like
from ml.features.menu_item import load_top_items


@dataclass
class ElasticityFit:
    item_name: str
    elasticity: float
    intercept: float
    fit_r2: float
    sample_size: int
    price_point_count: int
    mean_price: float
    mean_qty: float


def load_price_qty_history(
    store_id: str, item_name: str, lookback_days: int = 365
) -> pd.DataFrame:
    """Daily (price, qty) for one (store, item). Effective unit price uses
    blended FP+TP totals so promos/discounts that move the average price
    are reflected in the regressor."""
    sql = """
        SELECT date::date AS date,
               SUM(COALESCE("fpQuantitySold", 0) + COALESCE("tpQuantitySold", 0)) AS qty,
               (SUM(COALESCE("fpTotalSales", 0) + COALESCE("tpTotalSales", 0))
                / NULLIF(SUM(COALESCE("fpQuantitySold", 0) + COALESCE("tpQuantitySold", 0)), 0)) AS unit_price
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
    df["qty"] = df["qty"].astype(float)
    df["unit_price"] = df["unit_price"].astype(float)
    return df


def fit(item_name: str, df: pd.DataFrame) -> ElasticityFit | None:
    """OLS log(qty) ~ log(price) + weekday dummies. Returns None when the
    series is too thin or has no price variance to learn from."""
    if df.empty or len(df) < 30:
        return None
    df = df.dropna(subset=["qty", "unit_price"])
    df = df[(df["qty"] > 0) & (df["unit_price"] > 0)]
    if len(df) < 30:
        return None

    distinct_prices = df["unit_price"].round(2).unique()
    if len(distinct_prices) < 2:
        return ElasticityFit(
            item_name=item_name,
            elasticity=0.0,
            intercept=float(np.log(df["qty"].mean())),
            fit_r2=0.0,
            sample_size=int(len(df)),
            price_point_count=int(len(distinct_prices)),
            mean_price=float(df["unit_price"].mean()),
            mean_qty=float(df["qty"].mean()),
        )

    log_q = np.log(df["qty"].to_numpy())
    log_p = np.log(df["unit_price"].to_numpy())
    weekday = pd.to_datetime(df["date"]).dt.weekday.to_numpy()
    weekday_dummies = np.zeros((len(df), 6))
    for i in range(6):  # 6 dummies, drop weekday=0 (Mon) as the baseline
        weekday_dummies[:, i] = (weekday == i + 1).astype(float)

    # Design matrix: [1, log_p, weekday dummies]
    X = np.column_stack([np.ones(len(df)), log_p, weekday_dummies])
    y = log_q

    # OLS via lstsq (numerically stable, no statsmodels dependency)
    coef, residuals, _rank, _sv = np.linalg.lstsq(X, y, rcond=None)
    y_pred = X @ coef
    ss_res = float(np.sum((y - y_pred) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0

    return ElasticityFit(
        item_name=item_name,
        elasticity=float(coef[1]),
        intercept=float(coef[0]),
        fit_r2=float(r2),
        sample_size=int(len(df)),
        price_point_count=int(len(distinct_prices)),
        mean_price=float(df["unit_price"].mean()),
        mean_qty=float(df["qty"].mean()),
    )


def upsert_elasticity(store_id: str, fit_result: ElasticityFit) -> None:
    sql = """
        INSERT INTO "MenuItemElasticity"
            (id, "storeId", "otterItemSkuId", elasticity, intercept,
             "fitR2", "sampleSize", "pricePointCount", "meanPrice", "meanQty")
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT ("storeId", "otterItemSkuId")
        DO UPDATE SET
            elasticity = EXCLUDED.elasticity,
            intercept = EXCLUDED.intercept,
            "fitR2" = EXCLUDED."fitR2",
            "sampleSize" = EXCLUDED."sampleSize",
            "pricePointCount" = EXCLUDED."pricePointCount",
            "meanPrice" = EXCLUDED."meanPrice",
            "meanQty" = EXCLUDED."meanQty",
            "computedAt" = CURRENT_TIMESTAMP
    """
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                sql,
                (
                    cuid_like(),
                    store_id,
                    fit_result.item_name,
                    fit_result.elasticity,
                    fit_result.intercept,
                    fit_result.fit_r2,
                    fit_result.sample_size,
                    fit_result.price_point_count,
                    fit_result.mean_price,
                    fit_result.mean_qty,
                ),
            )


def run_for_store(store_id: str, top_n: int = 50) -> dict:
    items = load_top_items(store_id, top_n=top_n)
    if not items:
        return {"store_id": store_id, "ok": False, "reason": "no_items"}
    fitted = 0
    skipped = 0
    for item_name in items:
        try:
            df = load_price_qty_history(store_id, item_name)
            result = fit(item_name, df)
            if result is None:
                skipped += 1
                continue
            upsert_elasticity(store_id, result)
            fitted += 1
        except Exception as exc:  # pylint: disable=broad-except
            skipped += 1
            print(f"elasticity {store_id}/{item_name} failed: {exc}")
    return {
        "store_id": store_id,
        "ok": True,
        "items_fitted": fitted,
        "items_skipped": skipped,
    }
