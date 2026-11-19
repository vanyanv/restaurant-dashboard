"""Forecast food cost, shared by food_cost_risk and profit_risk.

Both generators used to price the forecast with
`COALESCE(unit_cost, 0)` on a LEFT JOIN from a forecast SKU to a
`DailyCogsItem` name, so every forecast item with no cost on file was costed at
$0. The projected food cost was then too LOW by exactly the items nobody had
costed, and nothing said so. This returns the lines with the cost left
missing, so each caller can name what it could not price.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ForecastFoodCost:
    #: Σ qty × unit cost over the forecast items that have a cost on file.
    matched_cost: float = 0.0
    matched_qty: float = 0.0
    #: (item, forecast qty) for items with no unit cost on file.
    unmatched: list[tuple[str, float]] = field(default_factory=list)

    @property
    def total_qty(self) -> float:
        return self.matched_qty + sum(q for _, q in self.unmatched)

    @property
    def coverage(self) -> float | None:
        """Share of forecast units that could be costed. None with no units."""
        total = self.total_qty
        return self.matched_qty / total if total > 0 else None

    @property
    def is_complete(self) -> bool:
        return not self.unmatched

    def unmatched_names(self, limit: int = 5) -> str:
        names = [n for n, _ in sorted(self.unmatched, key=lambda r: -r[1])]
        shown = ", ".join(names[:limit])
        more = len(names) - limit
        return f"{shown} and {more} more" if more > 0 else shown


def load_forecast_food_cost(conn, store_id: str, horizon_days: int) -> ForecastFoodCost | None:
    """Per-item forecast qty with its latest unit cost, or None with no forecast."""
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT fmi."otterItemSkuId",
                   SUM(COALESCE(fmi."reconciledQty", fmi."predictedQty")) AS qty,
                   MAX(dci.unit_cost) AS unit_cost
            FROM (
              SELECT DISTINCT ON ("otterItemSkuId", "forecastDate")
                     "otterItemSkuId", "forecastDate",
                     "reconciledQty", "predictedQty"
              FROM "ForecastMenuItem"
              WHERE "storeId" = %s AND "forecastSource" = 'native'
                AND "forecastDate" >= CURRENT_DATE
                AND "forecastDate" <  CURRENT_DATE + %s
              ORDER BY "otterItemSkuId", "forecastDate", "generatedAt" DESC
            ) fmi
            LEFT JOIN (
              SELECT DISTINCT ON ("itemName") "itemName", "unitCost" AS unit_cost
              FROM "DailyCogsItem"
              WHERE "storeId" = %s AND "unitCost" IS NOT NULL
              ORDER BY "itemName", date DESC
            ) dci ON dci."itemName" = fmi."otterItemSkuId"
            GROUP BY fmi."otterItemSkuId"
            ''',
            (store_id, horizon_days, store_id),
        )
        rows = cur.fetchall()
    if not rows:
        return None
    out = ForecastFoodCost()
    for sku, qty, unit_cost in rows:
        q = float(qty or 0.0)
        if q <= 0:
            continue
        if unit_cost is None:
            out.unmatched.append((str(sku), q))
        else:
            out.matched_cost += q * float(unit_cost)
            out.matched_qty += q
    if out.total_qty <= 0:
        return None
    return out
