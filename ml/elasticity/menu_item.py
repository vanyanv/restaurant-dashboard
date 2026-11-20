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
    #: Standard error of the elasticity coefficient. None when the fit had no
    #: price variance to identify it from.
    elasticity_std_err: float | None = None


#: Share of an item's day's gross taken back off by deals above which that
#: day is a promo day and is left out of the fit. Mirrors DEAL_THRESHOLD in
#: src/lib/counter/item-discounts.ts: above everyday one-off promo codes
#: (~4%), well below a BOGO (~50%).
DEAL_DAY_THRESHOLD = 0.10


def load_price_qty_history(
    store_id: str, item_name: str, lookback_days: int = 365
) -> pd.DataFrame:
    """Daily (price, qty) for one (store, item), with promo days left out.

    `OtterMenuItem` totals are the price BEFORE discounts (see
    src/lib/counter/item-discounts.ts). A buy-one-get-one on the delivery apps
    therefore does not move this "price" at all — it doubles the quantity at
    the same list price. Fitting through those days read a BOGO's volume as
    demand at full price and produced "cut the slider by $0.25 → +$541/wk"
    for an item whose cheap days were free sliders, not a lower price.

    Discounts live on the ORDER, so a day counts as a promo day for this item
    when the order discounts attributable to it — an order discount that is a
    whole number of the item's own unit price, the BOGO shape the TS
    allocator uses — exceed DEAL_DAY_THRESHOLD of the item's gross on the
    order feed that day. Those days are dropped rather than adjusted: there is
    no honest way to turn a free slider into a price point.

    What remains is still a BLENDED daily price across channels, whose
    day-to-day movement is mostly channel mix (app menus carry different list
    prices from the counter), not a price the owner changed. The reprice
    generator therefore only reads this fit for price RAISES on inelastic
    items, and never recommends a cut from it — see
    ml/growth/generators/reprice.py.
    """
    sql = """
        WITH item_orders AS (
            SELECT o."referenceTimeLocal"::date AS date,
                   o.id,
                   ABS(o.discount) AS discount,
                   SUM(i.price * i.quantity) AS gross,
                   MAX(i.price) AS unit_price
            FROM "OtterOrder" o
            JOIN "OtterOrderItem" i ON i."orderId" = o.id
            WHERE o."storeId" = %s
              AND i.name = %s
              AND o."referenceTimeLocal" >= (CURRENT_DATE - %s::int)
            GROUP BY 1, 2, 3
        ),
        promo_days AS (
            SELECT date
            FROM item_orders
            GROUP BY date
            HAVING SUM(
                     CASE WHEN discount > 0 AND unit_price > 0
                           AND ABS(discount / unit_price - ROUND(discount / unit_price)) * unit_price < 0.02
                          THEN discount ELSE 0 END
                   ) > %s * NULLIF(SUM(gross), 0)
        )
        SELECT date::date AS date,
               SUM(COALESCE("fpQuantitySold", 0) + COALESCE("tpQuantitySold", 0)) AS qty,
               (SUM(COALESCE("fpTotalSales", 0) + COALESCE("tpTotalSales", 0))
                / NULLIF(SUM(COALESCE("fpQuantitySold", 0) + COALESCE("tpQuantitySold", 0)), 0)) AS unit_price
        FROM "OtterMenuItem"
        WHERE "storeId" = %s
          AND "itemName" = %s
          AND "isModifier" = false
          AND date >= (CURRENT_DATE - %s::int)
          AND date::date NOT IN (SELECT date FROM promo_days)
        GROUP BY date
        ORDER BY date
    """
    with connect() as conn:
        df = pd.read_sql_query(
            sql,
            conn,
            params=(
                store_id, item_name, lookback_days, DEAL_DAY_THRESHOLD,
                store_id, item_name, lookback_days,
            ),
        )
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
            elasticity_std_err=None,
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

    # Standard error of the elasticity coefficient, from the same design matrix:
    #   se(beta) = sqrt(sigma^2 * diag((X'X)^-1)),  sigma^2 = RSS / (n - k)
    # Downstream this is what lets reprice_impact report a range instead of a
    # single figure, so a coefficient fitted on 41 noisy days stops looking
    # exactly as authoritative as one fitted on 400 clean ones. pinv rather than
    # inv because collinear weekday dummies can make X'X singular.
    n_obs, n_params = X.shape
    dof = n_obs - n_params
    std_err: float | None = None
    if dof > 0:
        sigma2 = ss_res / dof
        try:
            xtx_inv = np.linalg.pinv(X.T @ X)
            var_beta = sigma2 * float(np.diag(xtx_inv)[1])
            if np.isfinite(var_beta) and var_beta >= 0:
                std_err = float(np.sqrt(var_beta))
        except np.linalg.LinAlgError:
            std_err = None

    return ElasticityFit(
        item_name=item_name,
        elasticity=float(coef[1]),
        intercept=float(coef[0]),
        fit_r2=float(r2),
        elasticity_std_err=std_err,
        sample_size=int(len(df)),
        price_point_count=int(len(distinct_prices)),
        mean_price=float(df["unit_price"].mean()),
        mean_qty=float(df["qty"].mean()),
    )


def upsert_elasticity(store_id: str, fit_result: ElasticityFit) -> None:
    sql = """
        INSERT INTO "MenuItemElasticity"
            (id, "storeId", "otterItemSkuId", elasticity, intercept,
             "fitR2", "sampleSize", "pricePointCount", "meanPrice", "meanQty",
             "elasticityStdErr")
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT ("storeId", "otterItemSkuId")
        DO UPDATE SET
            elasticity = EXCLUDED.elasticity,
            intercept = EXCLUDED.intercept,
            "fitR2" = EXCLUDED."fitR2",
            "sampleSize" = EXCLUDED."sampleSize",
            "pricePointCount" = EXCLUDED."pricePointCount",
            "meanPrice" = EXCLUDED."meanPrice",
            "meanQty" = EXCLUDED."meanQty",
            "elasticityStdErr" = EXCLUDED."elasticityStdErr",
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
                    fit_result.elasticity_std_err,
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
