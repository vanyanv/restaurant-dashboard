"""Hierarchical consistency check.

Flags (does not fix) when sum-of-item forecasts disagree with the
daily revenue forecast for the same store-day. Sets up MinTrace
reconciliation for Phase 2.
"""

from __future__ import annotations
import pandas as pd


def compute_revenue_item_discrepancy(
    revenue: pd.DataFrame, items: pd.DataFrame
) -> pd.DataFrame:
    """For each (storeId, forecastDate), compute:

        discrepancyPct = (predictedRevenue − Σ predictedQty × avgPrice) / predictedRevenue × 100

    Returns the revenue frame augmented with `itemSumRevenue` and `discrepancyPct`.
    """
    item_agg = (
        items.assign(itemRevenue=items["predictedQty"] * items["avgPrice"])
        .groupby(["storeId", "forecastDate"], as_index=False)["itemRevenue"]
        .sum()
        .rename(columns={"itemRevenue": "itemSumRevenue"})
    )

    merged = revenue.merge(item_agg, on=["storeId", "forecastDate"], how="left")
    merged["itemSumRevenue"] = merged["itemSumRevenue"].fillna(0.0)
    merged["discrepancyPct"] = (
        (merged["predictedRevenue"] - merged["itemSumRevenue"])
        / merged["predictedRevenue"].replace({0: pd.NA})
    ) * 100.0
    return merged
