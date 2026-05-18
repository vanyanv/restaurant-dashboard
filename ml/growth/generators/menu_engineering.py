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
            impact = menu_engineering_impact(
                category_median_velocity=median_velocity,
                item_velocity=vel,
                item_margin=margin,
                days=_HORIZON_DAYS,
            )
            if impact <= 0:
                continue
            out.append(GrowthOpportunity(
                store_id=store_id,
                as_of_date=as_of_date.isoformat(),
                opportunity_type="menu_engineering",
                title=f"Slow mover in {cat}: {name}",
                estimated_dollar_impact=round(impact, 2),
                confidence="medium",  # observational, no causal claim
                evidence=[
                    Evidence(kind="item_velocity",            ref=f"DailyCogsItem:{name}", value=round(vel, 2)),
                    Evidence(kind="category_median_velocity", ref=f"category:{cat}",        value=round(median_velocity, 2)),
                    Evidence(kind="item_margin",              ref=f"DailyCogsItem:{name}", value=round(margin, 2)),
                ],
                caveats=["assumes upside is achievable via promotion or placement"],
                suggested_action=(
                    f"Consider promoting {name} (e.g. menu placement, photo, "
                    f"price feature) or removing it from the menu if it remains "
                    f"a slow mover after 14 days."
                ),
            ))
    return out
