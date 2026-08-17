"""menu_engineering generator — flags items selling well below the median
velocity within their category (slow movers in active categories).
"""
from __future__ import annotations

import datetime as dt
import statistics

from ml.growth.types import GrowthOpportunity, Evidence
from ml.growth.impact import menu_engineering_impact


_LOOKBACK_DAYS = 30                   # spec §3.2: 30-day aggregate window
_HORIZON_DAYS = 30                    # spec §3.2: impact over the next 30 days
_MIN_PEERS_IN_CATEGORY = 2            # need at least 2 peers to define a median

# The spec's closed form values the *whole* gap to the category median, i.e. it
# assumes a promotion turns a slow mover into a median seller. That is a ceiling,
# not a forecast, and it published cards like "+$10,839/wk" for one combo against
# a portfolio doing ~$48k/wk gross. Two bounds make the number defensible:
#
#   1. only part of the gap is realistically capturable by placement/photo/price
#   2. no promotion doubles an item's own throughput, so cap at its current
#      contribution over the same horizon
_ACHIEVABLE_LIFT_FRACTION = 0.30
_MAX_LIFT_VS_CURRENT = 1.0


def _load_item_velocities(conn, store_id: str):
    """Per-item trailing-30d velocity (qty/day) and margin from DailyCogsItem."""
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT "itemName", category,
                   SUM("qtySold")::FLOAT / %s AS velocity,
                   AVG(
                     CASE WHEN "qtySold" > 0
                          THEN ("salesRevenue" - "lineCost") / "qtySold"
                     END
                   ) AS margin
            FROM "DailyCogsItem"
            WHERE "storeId" = %s
              AND date >= CURRENT_DATE - %s
            GROUP BY "itemName", category
            HAVING SUM("qtySold") > 0
            ''',
            (_LOOKBACK_DAYS, store_id, _LOOKBACK_DAYS),
        )
        return cur.fetchall()


def generate(conn, *, store_id: str, as_of_date: dt.date) -> list[GrowthOpportunity]:
    rows = _load_item_velocities(conn, store_id)
    if not rows:
        return []

    # Group by category.
    by_cat: dict[str, list[tuple[str, float, float]]] = {}
    for name, cat, vel, margin in rows:
        if margin is None or margin <= 0:
            continue
        by_cat.setdefault(cat, []).append((name, float(vel), float(margin)))

    out: list[GrowthOpportunity] = []
    for cat, items in by_cat.items():
        if len(items) < _MIN_PEERS_IN_CATEGORY:
            continue
        velocities = [v for _, v, _ in items]
        median_velocity = statistics.median(velocities)
        for name, vel, margin in items:
            if vel >= median_velocity:
                continue  # only flag slow movers
            ceiling = menu_engineering_impact(
                category_median_velocity=median_velocity,
                item_velocity=vel,
                item_margin=margin,
                days=_HORIZON_DAYS,
            )
            if ceiling <= 0:
                continue
            # Bound the ceiling into something an operator could actually book.
            impact = min(
                ceiling * _ACHIEVABLE_LIFT_FRACTION,
                vel * margin * _HORIZON_DAYS * _MAX_LIFT_VS_CURRENT,
            )
            if impact <= 0:
                continue

            # How far below its peers the item sits drives what to do about it:
            # a near-median item is a placement tweak, a floor-dweller is a
            # delist candidate. One template for both read as boilerplate when
            # five of these landed on the page at once.
            shortfall = (median_velocity - vel) / median_velocity if median_velocity else 0
            if shortfall >= 0.75:
                action = (
                    f"{name} sells at {vel:.1f}/day against a {cat} median of "
                    f"{median_velocity:.1f}. That is a delist candidate — pull it "
                    f"unless it earns its slot as a loss leader or a regular's "
                    f"favourite."
                )
            elif shortfall >= 0.4:
                action = (
                    f"{name} runs well behind {cat} at {vel:.1f}/day. Move it up "
                    f"the menu or add a photo, then review in 14 days; if it "
                    f"hasn't moved, cut it."
                )
            else:
                action = (
                    f"{name} trails the {cat} median slightly ({vel:.1f} vs "
                    f"{median_velocity:.1f}/day). Worth a placement or bundle "
                    f"test before anything more drastic."
                )

            out.append(GrowthOpportunity(
                store_id=store_id,
                as_of_date=as_of_date.isoformat(),
                opportunity_type="menu_engineering",
                title=f"Slow mover in {cat}: {name}",
                estimated_dollar_impact=round(impact, 2),
                horizon_days=_HORIZON_DAYS,
                confidence="medium",  # observational, no causal claim
                evidence=[
                    Evidence(kind="item_velocity",            ref=f"DailyCogsItem:{name}", value=round(vel, 2)),
                    Evidence(kind="category_median_velocity", ref=f"category:{cat}",        value=round(median_velocity, 2)),
                    Evidence(kind="item_margin",              ref=f"DailyCogsItem:{name}", value=round(margin, 2)),
                    Evidence(kind="ceiling_if_lifted_to_median", ref=f"DailyCogsItem:{name}", value=round(ceiling, 2)),
                ],
                caveats=[
                    f"assumes {int(_ACHIEVABLE_LIFT_FRACTION * 100)}% of the gap to "
                    f"the category median is capturable by promotion or placement",
                ],
                suggested_action=action,
            ))
    return out
