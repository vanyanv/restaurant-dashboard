"""Per-item average price helper used by the W6-8 reconciliation pipeline.

Same formula as the inline subquery in
ml.evaluation.nightly_integration._fetch_future_items_with_price — kept as
separate implementations because that consistency-check function joins
predictions with prices in one SQL round-trip (a refactor would force two
Python-side calls and lose the SQL-side LEFT JOIN + COALESCE behavior).
Both implementations follow the spec §2 rule:

    avg_price = AVG((fpTotalSales + tpTotalSales) / (fpQuantitySold + tpQuantitySold))

…over the trailing N days, skipping zero-qty items. Fallback for items with
no observed sales is AVG_PRICE_FALLBACK = $1.0 so a missing-price item still
contributes a non-zero leaf value to the reconciliation hierarchy.
"""
from __future__ import annotations


AVG_PRICE_FALLBACK = 1.0


def compute_item_avg_prices(
    conn,
    *,
    store_id: str,
    lookback_days: int = 60,
) -> dict[str, float]:
    """Return {itemName: avgPrice} from the trailing window. Items with no
    sales in the window are omitted; callers fall back to AVG_PRICE_FALLBACK."""
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT "itemName",
                   AVG(
                     CASE
                       WHEN ("fpQuantitySold" + "tpQuantitySold") > 0
                       THEN ("fpTotalSales" + "tpTotalSales")
                            / ("fpQuantitySold" + "tpQuantitySold")
                     END
                   ) AS avg_price
            FROM "OtterMenuItem"
            WHERE "storeId" = %s
              AND date >= CURRENT_DATE - %s::INTEGER
              AND "isModifier" = false
              AND ("fpQuantitySold" + "tpQuantitySold") > 0
            GROUP BY "itemName"
            ''',
            (store_id, lookback_days),
        )
        rows = cur.fetchall()
    return {name: float(price) for name, price in rows if price is not None}
