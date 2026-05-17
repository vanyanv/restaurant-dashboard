"""Hollywood-prior transfer forecasts.

For each `warming_up` store, project Hollywood's recent forecasts onto the
new store using a multiplicative scalar (ratio of trailing 14-day actuals).
Used until the store accumulates enough native history to beat the transfer
forecast on WAPE - see ml.lifecycle.

Architectural rule (per spec §1.2): no codebase default for the initial
scalar - operators set it per store at registration so the choice is intentional.
If a store has fewer than 7 actuals AND no initialTransferScalar, the writer
emits a JobRun warning and skips the store for that night.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


_MIN_ACTUALS_FOR_RATIO = 7
INTERVAL_WIDEN_MULTIPLIER = 1.5


def compute_transfer_scalar(
    *,
    new_store_actuals: list[float],
    hollywood_actuals_same_window: list[float],
    initial_scalar: Optional[float],
) -> float:
    """Return the multiplicative scalar that maps Hollywood forecasts to the
    new store's expected revenue.

    Rule (spec §1.2):
      * >= 7 actuals and Hollywood mean > 0 -> scalar = mean(new) / mean(holly).
      * Otherwise -> use `initial_scalar` (operator-set).
      * If neither path is available, raise ValueError so the caller fails
        loud and the nightly job records a JobRun warning.
    """
    n = min(len(new_store_actuals), len(hollywood_actuals_same_window))
    if n >= _MIN_ACTUALS_FOR_RATIO:
        new_mean = sum(new_store_actuals[:n]) / n
        holly_mean = sum(hollywood_actuals_same_window[:n]) / n
        if holly_mean > 0:
            return new_mean / holly_mean
        # Hollywood window happens to be zero - fall through to initial.
    if initial_scalar is None:
        raise ValueError(
            "initial_scalar required: store has fewer than "
            f"{_MIN_ACTUALS_FOR_RATIO} actuals and no operator-set "
            "initialTransferScalar to fall back on"
        )
    return float(initial_scalar)


def widened_interval(
    *,
    point: float,
    p10: Optional[float],
    p90: Optional[float],
) -> tuple[float, Optional[float], Optional[float]]:
    """Widen a (p10, p90) interval by INTERVAL_WIDEN_MULTIPLIER about the point.

    Half-width grows by the multiplier; p10 clamped at 0 (no negative revenue
    or quantities). When either bound is None, return it unchanged.
    """
    if p10 is None or p90 is None:
        return point, p10, p90
    new_p10 = point - (point - p10) * INTERVAL_WIDEN_MULTIPLIER
    new_p90 = point + (p90 - point) * INTERVAL_WIDEN_MULTIPLIER
    if new_p10 < 0:
        new_p10 = 0.0
    return point, new_p10, new_p90


from ml.db import cuid_like


@dataclass
class TransferWriteResult:
    ok: bool
    revenue_rows_written: int = 0
    menu_item_rows_written: int = 0
    hourly_rows_written: int = 0
    scalar_used: Optional[float] = None
    warning: str = ""


def _load_hollywood_recent_forecasts(cur, hollywood_store_id: str, days: int):
    """Latest forecast per (date, hourBucket=0) for Hollywood in the next `days`."""
    cur.execute(
        '''
        SELECT DISTINCT ON ("forecastDate")
               "forecastDate", "predictedRevenue", p10, p90
        FROM "ForecastDailyRevenue"
        WHERE "storeId" = %s
          AND "hourBucket" = 0
          AND "forecastSource" = 'native'
          AND "forecastDate" >= CURRENT_DATE
        ORDER BY "forecastDate" ASC, "generatedAt" DESC
        LIMIT %s
        ''',
        (hollywood_store_id, days),
    )
    return cur.fetchall()


def _load_trailing_actuals(cur, store_id: str, days: int) -> list[float]:
    """Trailing actuals from OtterDailySummary (sum of fpNetSales + tpNetSales).

    Used to compute the multiplicative scalar - same source the reconciler
    writes into ForecastDailyRevenue.actualRevenue.
    """
    cur.execute(
        '''
        SELECT COALESCE("fpNetSales", 0) + COALESCE("tpNetSales", 0) AS actual
        FROM "OtterDailySummary"
        WHERE "storeId" = %s
          AND date >= CURRENT_DATE - %s::INTEGER
        ORDER BY date DESC
        LIMIT %s
        ''',
        (store_id, days, days),
    )
    return [float(r[0]) for r in cur.fetchall()]


def write_transfer_forecasts_for_store(
    conn,
    *,
    new_store_id: str,
    hollywood_store_id: str,
    model_version: str,
    initial_scalar: Optional[float],
    horizon_days: int = 14,
) -> TransferWriteResult:
    """Write transfer-source revenue forecasts for one warming_up store.

    Fails soft (returns ok=False + warning) on:
      - no recent Hollywood forecasts to project from
      - insufficient actuals + no initial_scalar fallback

    Menu-item and hourly transfer writes are deliberately scoped out of W5
    (revenue only) - the UI caption attaches to the revenue card and any
    operator-action surface that reads revenue. Extend in a later phase if
    we need item-level transfer forecasts.
    """
    with conn.cursor() as cur:
        hollywood = _load_hollywood_recent_forecasts(cur, hollywood_store_id, horizon_days)
    if not hollywood:
        return TransferWriteResult(ok=False, warning="hollywood_has_no_recent_forecasts")

    with conn.cursor() as cur:
        new_actuals = _load_trailing_actuals(cur, new_store_id, 14)
    with conn.cursor() as cur:
        holly_actuals = _load_trailing_actuals(cur, hollywood_store_id, 14)

    try:
        scalar = compute_transfer_scalar(
            new_store_actuals=new_actuals,
            hollywood_actuals_same_window=holly_actuals,
            initial_scalar=initial_scalar,
        )
    except ValueError as exc:
        return TransferWriteResult(ok=False, warning=f"scalar_unavailable: {exc}")

    written = 0
    with conn.cursor() as cur:
        for row in hollywood:
            forecast_date, point, p10, p90 = row
            scaled_point = float(point) * scalar
            scaled_p10 = float(p10) * scalar if p10 is not None else None
            scaled_p90 = float(p90) * scalar if p90 is not None else None
            new_point, new_p10, new_p90 = widened_interval(
                point=scaled_point, p10=scaled_p10, p90=scaled_p90,
            )
            cur.execute(
                '''
                INSERT INTO "ForecastDailyRevenue"
                    (id, "storeId", "forecastDate", "hourBucket",
                     "predictedRevenue", p10, p90, "modelVersion", "forecastSource")
                VALUES (%s, %s, %s, 0, %s, %s, %s, %s, 'transfer')
                ''',
                (cuid_like(), new_store_id, forecast_date,
                 new_point, new_p10, new_p90, model_version),
            )
            written += 1

    return TransferWriteResult(
        ok=True,
        revenue_rows_written=written,
        scalar_used=scalar,
    )
