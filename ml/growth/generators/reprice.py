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

from ml.growth.uncertainty import interval_for
from ml.growth.types import GrowthOpportunity, Evidence


_MIN_FIT_R2 = 0.10                # spec §3.2: matches the low-confidence floor in MenuItemElasticity docstring
_MIN_PRICE_POINTS = 2             # spec §3.2: no variance => no signal (column docstring)
_SUGGESTED_DELTA_DOLLARS = 0.25   # spec §3.2: small step preserves linearity assumption


def _load_elastic_items(conn, store_id: str):
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT "otterItemSkuId", elasticity, "fitR2", "sampleSize",
                   "elasticityStdErr",
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
    for sku, elasticity, fit_r2, n, std_err, mean_price, mean_qty in items:
        margin = margins.get(sku)
        if margin is None or margin <= 0:
            continue

        # Decide direction.
        direction = "raise" if abs(elasticity) < 1 else "drop"
        delta = _SUGGESTED_DELTA_DOLLARS if direction == "raise" else -_SUGGESTED_DELTA_DOLLARS

        # Net benefit = (new_revenue - new_cost) - (old_revenue - old_cost).
        # new_qty derives from elasticity × proportional price change.
        def _net_benefit(e: float, *, _d=delta, _p=mean_price, _q=mean_qty, _m=margin) -> float:
            nq = _q * (1 + (e * (_d / _p)))
            return ((_p + _d) * nq - (_p - _m) * nq) - (_p * _q - (_p - _m) * _q)

        net_benefit = _net_benefit(elasticity)
        if net_benefit <= 0:
            continue

        # Push the elasticity's standard error through this same closed form, so
        # a coefficient fitted on 41 noisy days stops looking exactly as
        # authoritative as one fitted on 400 clean ones.
        interval = interval_for(
            _net_benefit, elasticity=elasticity, elasticity_std_err=std_err
        )

        confidence = "high" if fit_r2 >= 0.30 else "medium"
        out.append(GrowthOpportunity(
            store_id=store_id,
            as_of_date=as_of_date.isoformat(),
            opportunity_type="reprice",
            title=f"{direction.title()} price on {sku} by ${abs(delta):.2f}",
            estimated_dollar_impact=round(net_benefit, 2),
            impact_p10=None if interval.is_degenerate else round(interval.p10, 2),
            impact_p25=None if interval.is_degenerate else round(interval.p25, 2),
            impact_p90=None if interval.is_degenerate else round(interval.p90, 2),
            # meanQty is a mean *daily* quantity, so the closed form yields a
            # per-day benefit.
            horizon_days=1,
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
