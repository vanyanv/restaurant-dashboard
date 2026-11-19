"""reprice generator — recommends a small price RAISE on inelastic items
with a defensible elasticity fit. It never recommends a price cut.

Why no cuts. The elasticity (ml/elasticity/menu_item.py) is fitted on a
blended daily average price across channels. Promo days are now left out of
that fit, but what is left still moves mostly with channel mix — the apps
carry different list prices from the counter — rather than with any price the
owner set. A cut recommendation needs the claim "customers buy more when it
is cheaper", and this data cannot separate that from "more of today's orders
came through the cheaper channel" or from a deal the attribution missed. It
produced "cut the Signature Slider by $0.25 → +$541/wk" on an item whose
cheap-looking days were Uber/DoorDash BOGOs. Until there is a list-price
history per channel, cuts are suppressed rather than estimated.

Raises are kept, narrowly: |elasticity| < 1 says volume barely moved with
price, which is the conservative direction for the same contamination (a deal
read as a low price makes an item look MORE elastic, not less).

Candidate filter:
  * fitR2 >= 0.30 (was 0.10 — a fit explaining a tenth of the variance is not
    evidence for anything an owner should act on)
  * at least 60 clean days and 3 distinct price points
  * a standard error on the coefficient, so the range can be shown
  * fitted in the latest nightly run (a row left over from before promo days
    were excluded must not be read)
"""
from __future__ import annotations

import datetime as dt

from ml.growth.uncertainty import interval_for
from ml.growth.types import GrowthOpportunity, Evidence


_MIN_FIT_R2 = 0.30                # a fit must explain at least 30% of daily volume variance
_MIN_SAMPLE_DAYS = 60             # clean (non-promo) days in the fit
_MIN_PRICE_POINTS = 3             # distinct prices seen; 2 is one change, which any shock confounds
_MAX_FIT_AGE_HOURS = 36           # only fits from the latest nightly
_HIGH_CONFIDENCE_R2 = 0.50
_HIGH_CONFIDENCE_SAMPLE = 120
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
              AND "sampleSize" >= %s
              AND "elasticityStdErr" IS NOT NULL
              AND "computedAt" >= NOW() - (%s * INTERVAL '1 hour')
            ORDER BY ABS(elasticity) DESC
            ''',
            (store_id, _MIN_FIT_R2, _MIN_PRICE_POINTS, _MIN_SAMPLE_DAYS, _MAX_FIT_AGE_HOURS),
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
        # Re-check in Python: the SQL filter is the first line, this is the
        # one a test can see.
        if (
            fit_r2 is None or fit_r2 < _MIN_FIT_R2
            or n is None or n < _MIN_SAMPLE_DAYS
            or std_err is None
        ):
            continue
        # Raises only, on inelastic items. See the module docstring for why
        # a cut is never recommended from this fit.
        if abs(elasticity) >= 1:
            continue
        margin = margins.get(sku)
        if margin is None or margin <= 0:
            continue

        delta = _SUGGESTED_DELTA_DOLLARS

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

        # Evidence-based: how much of the variance the fit explains AND how
        # many clean days it stands on. A floor-clearing fit is medium.
        confidence = (
            "high"
            if fit_r2 >= _HIGH_CONFIDENCE_R2 and n >= _HIGH_CONFIDENCE_SAMPLE
            else "medium"
        )
        out.append(GrowthOpportunity(
            store_id=store_id,
            as_of_date=as_of_date.isoformat(),
            opportunity_type="reprice",
            title=f"Raise price on {sku} by ${delta:.2f}",
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
            caveats=[
                f"assumes sales volume responds to price the way it did over the "
                f"last {int(n)} non-promo days; promo days are left out",
            ],
            suggested_action=(
                f"Raise the menu price on {sku} by ${delta:.2f} "
                f"on Otter and watch its sales over the next 14 days."
            ),
        ))

    return out
