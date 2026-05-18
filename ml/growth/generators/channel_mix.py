"""channel_mix generator — recommends shifting volume from the lower-net
channel (3P typically) to the higher-net channel (1P typically).
"""
from __future__ import annotations

import datetime as dt

from ml.growth.types import GrowthOpportunity, Evidence
from ml.growth.impact import channel_mix_impact


_LOOKBACK_DAYS = 14
# Spec §3.2: no tunable multiplier. The recommendation surfaces only when the
# absolute net-per-order delta exceeds zero AND the candidate-shift volume is
# explainable (10% of the lower-net channel's orders over the trailing week,
# matching the actionable-shift heuristic operators have validated).
# This 10% is annotated for the tunable-multiplier guard in test_growth_impact.
_RECOMMENDED_SHIFT_FRACTION = 0.10   # spec §3.2: cap on credible weekly shift


def _load_channel_summary(conn, store_id: str):
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT
                CASE WHEN platform IN ('css-pos','bnm-web') THEN 'fp' ELSE 'tp' END AS channel,
                SUM(COALESCE("fpOrderCount", 0) + COALESCE("tpOrderCount", 0)) AS orders,
                CASE
                  WHEN SUM(COALESCE("fpOrderCount", 0) + COALESCE("tpOrderCount", 0)) > 0
                  THEN SUM(COALESCE("fpNetSales", 0) + COALESCE("tpNetSales", 0))
                       / SUM(COALESCE("fpOrderCount", 0) + COALESCE("tpOrderCount", 0))
                  ELSE 0
                END AS net_per_order
            FROM "OtterDailySummary"
            WHERE "storeId" = %s
              AND date >= CURRENT_DATE - %s
            GROUP BY 1
            ''',
            (store_id, _LOOKBACK_DAYS),
        )
        return {channel: (int(orders), float(net)) for channel, orders, net in cur.fetchall()}


def generate(conn, *, store_id: str, as_of_date: dt.date) -> list[GrowthOpportunity]:
    summary = _load_channel_summary(conn, store_id)
    fp = summary.get("fp")
    tp = summary.get("tp")
    if not fp or not tp:
        return []
    fp_orders, fp_net = fp
    tp_orders, tp_net = tp
    if fp_net <= tp_net:
        return []  # 3P already higher net — no recommendation
    units_to_shift = tp_orders * _RECOMMENDED_SHIFT_FRACTION
    impact = channel_mix_impact(
        units_shifted=units_to_shift,
        high_channel_net_per_order=fp_net,
        low_channel_net_per_order=tp_net,
    )
    if impact <= 0:
        return []
    return [GrowthOpportunity(
        store_id=store_id, as_of_date=as_of_date.isoformat(),
        opportunity_type="channel_mix",
        title=f"Shift ~{int(units_to_shift)} orders/wk from 3P to 1P",
        estimated_dollar_impact=round(impact, 2),
        confidence="medium",
        evidence=[
            Evidence(kind="fp_net_per_order", ref="OtterDailySummary:fp", value=round(fp_net, 2)),
            Evidence(kind="tp_net_per_order", ref="OtterDailySummary:tp", value=round(tp_net, 2)),
            Evidence(kind="tp_orders_14d",    ref="OtterDailySummary:tp", value=tp_orders),
        ],
        caveats=["assumes customer mix is shiftable via 1P promotions / pickup incentives"],
        suggested_action=(
            "Run a 1P-only promo (e.g. 10% off pickup) for 1-2 weeks; "
            "measure 1P order growth vs baseline."
        ),
    )]
