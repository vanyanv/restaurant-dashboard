"""reprice generator — recommends small price changes on inelastic items
with high-confidence elasticity fits.

Heuristic (spec §3.3):
  * Source candidates from MenuItemElasticity where fitR2 >= 0.10
    AND pricePointCount >= 2 (rows with no price variance lack signal).
  * For inelastic items (|elasticity| < 1), suggest +$0.25 raise.
  * For elastic items (|elasticity| > 1), suggest −$0.25 drop.
  * Compute net dollar impact via impact.reprice_impact using (a) the change
    in qty implied by the elasticity, and (b) the change in margin from
    moving price. Only emit when net impact > $0 (= operator benefit).
"""
from __future__ import annotations

import datetime as dt

from ml.growth.types import GrowthOpportunity, Evidence


_MIN_FIT_R2 = 0.10                # spec §3.2: matches the low-confidence floor in MenuItemElasticity docstring
_MIN_PRICE_POINTS = 2             # spec §3.2: no variance => no signal (column docstring)
_SUGGESTED_DELTA_DOLLARS = 0.25   # spec §3.2: small step preserves linearity assumption


def _load_elastic_items(conn, store_id: str):
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT "otterItemSkuId", elasticity, "fitR2", "sampleSize",
                   "meanPrice", "meanQty"
            FROM "MenuItemElasticity"
            WHERE "storeId" = %s
              AND "fitR2" >= %s
              AND "pricePointCount" >= %s
            ORDER BY ABS(elasticity) DESC
            ''',
            (store_id, _MIN_FIT_R2, _MIN_PRICE_POINTS),
        )
        return cur.fetchall()


def _load_item_margins(conn, store_id: str, item_names: list[str]):
    """Per-unit margin from DailyCogsItem trailing 30 days."""
    if not item_names:
        return {}
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT "itemName",
                   AVG(
                     CASE WHEN "qtySold" > 0
                          THEN ("salesRevenue" - "lineCost") / "qtySold"
                     END
                   ) AS per_unit_margin
            FROM "DailyCogsItem"
            WHERE "storeId" = %s
              AND date >= CURRENT_DATE - 30  -- spec §3.2 (30-day aggregate)
              AND "itemName" = ANY(%s)
            GROUP BY "itemName"
            ''',
            (store_id, item_names),
        )
        return {name: float(m) for name, m in cur.fetchall() if m is not None}


def generate(conn, *, store_id: str, as_of_date: dt.date) -> list[GrowthOpportunity]:
    items = _load_elastic_items(conn, store_id)
    if not items:
        return []
    margins = _load_item_margins(conn, store_id, [r[0] for r in items])

    out: list[GrowthOpportunity] = []
    for sku, elasticity, fit_r2, n, mean_price, mean_qty in items:
        margin = margins.get(sku)
        if margin is None or margin <= 0:
            continue

        # Decide direction.
        direction = "raise" if abs(elasticity) < 1 else "drop"
        delta = _SUGGESTED_DELTA_DOLLARS if direction == "raise" else -_SUGGESTED_DELTA_DOLLARS

        # Net benefit = (new_revenue - new_cost) - (old_revenue - old_cost).
        # new_qty derives from elasticity × proportional price change.
        new_qty = mean_qty * (1 + (elasticity * (delta / mean_price)))
        old_revenue = mean_price * mean_qty
        new_revenue = (mean_price + delta) * new_qty
        old_cost = (mean_price - margin) * mean_qty
        new_cost = (mean_price - margin) * new_qty
        net_benefit = (new_revenue - new_cost) - (old_revenue - old_cost)
        if net_benefit <= 0:
            continue

        confidence = "high" if fit_r2 >= 0.30 else "medium"
        out.append(GrowthOpportunity(
            store_id=store_id,
            as_of_date=as_of_date.isoformat(),
            opportunity_type="reprice",
            title=f"{direction.title()} price on {sku} by ${abs(delta):.2f}",
            estimated_dollar_impact=round(net_benefit, 2),
            confidence=confidence,
            evidence=[
                Evidence(kind="elasticity_fit", ref=f"MenuItemElasticity:{sku}", value=round(float(elasticity), 3)),
                Evidence(kind="fit_r2",         ref=f"MenuItemElasticity:{sku}", value=round(float(fit_r2), 3)),
                Evidence(kind="sample_size",    ref=f"MenuItemElasticity:{sku}", value=int(n)),
                Evidence(kind="per_unit_margin",ref=f"DailyCogsItem:{sku}",       value=round(margin, 2)),
            ],
            caveats=(
                ["price elasticity assumes other conditions unchanged"]
                if fit_r2 < 0.30 else []
            ),
            suggested_action=(
                f"{direction.capitalize()} the menu price on {sku} by ${abs(delta):.2f} "
                f"on Otter and observe net revenue over the next 14 days."
            ),
        ))

    return out
