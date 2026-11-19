"""channel_mix generator — recommends shifting volume from the lower-net
channel (3P typically) to the higher-net channel (1P typically).

"Net" is what an order leaves the store after the marketplace's cut: the
ticket after discounts, less commission. The previous version compared net
SALES per order and never took commission off the app orders, so the gap it
valued was mostly a gap it had not subtracted. Commission follows the same
rule as the P&L (src/lib/counter/commission-core.ts): the fee Otter recorded on
the order where there is one, else the STORE's own rate for that platform and
fulfilment mode from the Store columns, charged on the ticket after
discounts. No rate is ever hard-coded here; an app order with no recorded fee
and no rate on file makes the comparison unknown, and nothing is emitted.
"""
from __future__ import annotations

import datetime as dt

from ml.growth.types import GrowthOpportunity, Evidence
from ml.growth.impact import channel_mix_impact


_LOOKBACK_DAYS = 14
# Spec §3.2: no tunable multiplier. The recommendation surfaces only when the
# absolute net-per-order delta exceeds zero AND the candidate-shift volume is
# explainable (10% of the lower-net channel's WEEKLY orders, matching the
# actionable-shift heuristic operators have validated).
# This 10% is annotated for the tunable-multiplier guard in test_growth_impact.
_RECOMMENDED_SHIFT_FRACTION = 0.10   # spec §3.2: cap on credible weekly shift

#: Mirrors FIRST_PARTY_PLATFORMS in src/lib/first-party-platforms.ts.
_FIRST_PARTY_PLATFORMS = ("css-pos", "bnm-web", "d2c-eater-website")


def _load_order_groups(conn, store_id: str):
    """Closed days only: today is still being written."""
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT platform,
                   CASE WHEN "fulfillmentMode" = 'FULFILLMENT_MODE_PICKUP'
                        THEN 'pickup' ELSE 'delivery' END AS mode,
                   (commission <> 0) AS recorded,
                   COUNT(*) AS orders,
                   SUM(GREATEST(0, -commission)) AS fee,
                   SUM(GREATEST(0, subtotal + discount)) AS ticket
            FROM "OtterOrder"
            WHERE "storeId" = %s
              AND "referenceTimeLocal" >= CURRENT_DATE - %s::int
              AND "referenceTimeLocal" <  CURRENT_DATE
              AND ("orderStatus" IS NULL OR "orderStatus" <> 'OFO_STATUS_CANCELED')
            GROUP BY 1, 2, 3
            ''',
            (store_id, _LOOKBACK_DAYS),
        )
        return cur.fetchall()


def _load_store_rates(conn, store_id: str) -> dict:
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT "uberCommissionRate", "uberPickupCommissionRate",
                   "doordashCommissionRate", "doordashPickupCommissionRate",
                   "grubhubCommissionRate"
            FROM "Store" WHERE id = %s
            ''',
            (store_id,),
        )
        rows = cur.fetchall()
    if not rows:
        return {}
    uber, uber_pickup, dd, dd_pickup, gh = rows[0]
    return {
        ("ubereats", "delivery"): uber,
        ("ubereats", "pickup"): uber_pickup,
        ("doordash", "delivery"): dd,
        ("doordash", "pickup"): dd_pickup,
        ("grubhub", "delivery"): gh,
        ("grubhub", "pickup"): gh,
    }


def _summarise(groups, rates):
    """(fp_orders, fp_net_per_order, tp_orders, tp_net_per_order, tp_commission)
    or None when any app order's commission cannot be known."""
    fp_orders = 0
    fp_net = 0.0
    tp_orders = 0
    tp_ticket = 0.0
    tp_commission = 0.0
    for platform, mode, recorded, orders, fee, ticket in groups:
        orders = int(orders or 0)
        ticket = float(ticket or 0.0)
        if platform in _FIRST_PARTY_PLATFORMS:
            fp_orders += orders
            fp_net += ticket
            continue
        tp_orders += orders
        tp_ticket += ticket
        if recorded:
            tp_commission += float(fee or 0.0)
        else:
            rate = rates.get((platform, mode))
            if rate is None:
                return None  # unknown, never free
            tp_commission += float(rate) * ticket
    if fp_orders == 0 or tp_orders == 0:
        return None
    return (
        fp_orders, fp_net / fp_orders,
        tp_orders, (tp_ticket - tp_commission) / tp_orders,
        tp_commission,
    )


def generate(conn, *, store_id: str, as_of_date: dt.date) -> list[GrowthOpportunity]:
    groups = _load_order_groups(conn, store_id)
    if not groups:
        return []
    rates = _load_store_rates(conn, store_id)
    summary = _summarise(groups, rates)
    if summary is None:
        return []
    fp_orders, fp_net, tp_orders, tp_net, tp_commission = summary
    if fp_net <= tp_net:
        return []  # 3P already higher net — no recommendation

    # The window is 14 days; the card is weekly. Normalise before taking the
    # share — 10% of a fortnight's orders labelled "/wk" doubled the claim.
    tp_orders_per_week = tp_orders * 7.0 / _LOOKBACK_DAYS
    units_to_shift = tp_orders_per_week * _RECOMMENDED_SHIFT_FRACTION
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
        title=f"Shift ~{int(round(units_to_shift))} orders/wk from 3P to 1P",
        estimated_dollar_impact=round(impact, 2),
        horizon_days=7,
        # The per-order gap is measured; whether customers move is not.
        confidence="low",
        evidence=[
            Evidence(kind="fp_net_per_order", ref="OtterOrder:fp", value=round(fp_net, 2)),
            Evidence(kind="tp_net_per_order", ref="OtterOrder:tp after commission", value=round(tp_net, 2)),
            Evidence(kind="tp_commission_14d", ref="OtterOrder.commission|Store.*CommissionRate", value=round(tp_commission, 2)),
            Evidence(kind="tp_orders_per_week", ref="OtterOrder:tp", value=round(tp_orders_per_week, 1)),
            Evidence(kind="fp_orders_14d", ref="OtterOrder:fp", value=fp_orders),
        ],
        caveats=[
            f"assumes {int(_RECOMMENDED_SHIFT_FRACTION * 100)}% of app orders "
            f"could move to your own channel; app commission is taken off "
            f"(recorded fee, or the store's rate where none was recorded)",
        ],
        suggested_action=(
            f"App orders leave ${tp_net:.2f} each after commission against "
            f"${fp_net:.2f} on your own channel. Promote your own ordering "
            f"for 1-2 weeks and compare its weekly orders with the weeks "
            f"before; any discount you offer comes off this figure."
        ),
    )]
