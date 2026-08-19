"""Per-horizon interval widths, measured instead of assumed.

`forecast()` calibrated its conformal interval at one step and then stretched it
across the horizon with `HORIZON_WIDENING_PER_DAY = 0.05` — a flat 5% per day.
Measured against reconciled actuals on Hollywood, that constant is wrong in both
directions at once:

    horizon   coverage (target 80%)   band as % of level
       1d            71.1%                  29.2%
       4d            71.4%                  32.6%
       7d            84.4%                  36.1%
       8d            96.8%                  38.0%
      12d            96.3%                  42.3%

Too tight tomorrow, far too loose next week. A 96%-covering interval is not a
safer interval, it is an uninformative one — it tells an owner Saturday will
land somewhere in a $3,200 range they cannot order stock against.

Every forecast row carries the horizon it was made at (`forecastDate` −
`generatedAt`), so the width each horizon actually needs is measurable. This
replaces the constant with that measurement.

Two deliberate choices:

- **Symmetric, on absolute relative error.** Signed residual quantiles would
  re-centre the band around whatever bias the *old* model had, and the model
  producing these residuals under-predicted by ~5%. Taking the 80th percentile
  of |error| targets coverage without importing that bias, and self-corrects as
  fresh rows reconcile.
- **Pooled across weekdays.** Per-weekday would be better, but there are ~38
  reconciled rows per horizon — five or six per weekday. Splitting them would
  produce quantiles noisier than the constant being replaced.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ml.db import connect

#: Rows a horizon needs before its measured width is trusted over the fallback.
MIN_SAMPLES_PER_HORIZON = 12

#: Residuals from before this date describe a model that no longer exists.
#:
#: Two bugs were fixed on 2026-08-19: the forecast anchored on a business day
#: that was still ~68% written, and the shipped estimator was fit on the train
#: slice alone. Together they backtested at bias -5.4% / MAPE 10.4% before and
#: -1.9% / 9.4% after. Calibrating today's intervals on yesterday's errors would
#: size the band for a model that has been replaced.
#:
#: An out-of-sample split over the pre-fix history made the risk concrete: widths
#: measured on the older half delivered only 60-76% coverage on the newer half,
#: because error levels drifted as those bugs worsened. Excluding that era is
#: what stops the same drift being baked into the band.
#:
#: Until roughly twelve post-fix nightly runs have reconciled, this returns {}
#: and `forecast()` keeps the conformal + widening path. That is the intended
#: behaviour, not a gap.
CALIBRATION_EPOCH = "2026-08-19"

#: Interval to target. p10/p90 is an 80% interval.
TARGET_COVERAGE = 0.80

#: Beyond this, a measured width is treated as a data error rather than a very
#: uncertain day — a band wider than the forecast itself tells nobody anything.
MAX_RELATIVE_HALF_WIDTH = 0.75


@dataclass(frozen=True)
class HorizonRow:
    horizon: int
    predicted: float
    actual: float


def relative_half_widths(
    rows: list[HorizonRow],
    *,
    coverage: float = TARGET_COVERAGE,
    min_samples: int = MIN_SAMPLES_PER_HORIZON,
) -> dict[int, float]:
    """Half-width per horizon, as a fraction of the prediction.

    Horizons with too few reconciled rows are omitted, so the caller falls back
    rather than trusting a quantile taken over four points.
    """
    by_horizon: dict[int, list[float]] = {}
    for r in rows:
        if r.predicted <= 0 or r.actual <= 0:
            continue
        by_horizon.setdefault(r.horizon, []).append(
            abs(r.actual - r.predicted) / r.predicted
        )

    out: dict[int, float] = {}
    for horizon, errors in by_horizon.items():
        if len(errors) < min_samples:
            continue
        # Split-conformal finite-sample correction: at n rows, the level that
        # actually delivers `coverage` is ceil((n+1) * coverage) / n, which is
        # slightly above `coverage` and shrinks toward it as n grows. Without it
        # a quantile taken over a few dozen points under-covers systematically.
        n = len(errors)
        level = min(1.0, np.ceil((n + 1) * coverage) / n)
        width = float(np.quantile(np.asarray(errors), level))
        if width <= 0 or width > MAX_RELATIVE_HALF_WIDTH:
            continue
        out[horizon] = width
    return out


def enforce_monotonic(widths: dict[int, float]) -> dict[int, float]:
    """Make width non-decreasing in horizon.

    Uncertainty about a day cannot genuinely shrink as it moves further away;
    where the raw quantiles say otherwise it is sampling noise on a few dozen
    rows. Carrying the running maximum forward keeps the band honest without
    smoothing away real growth.
    """
    out: dict[int, float] = {}
    running = 0.0
    for horizon in sorted(widths):
        running = max(running, widths[horizon])
        out[horizon] = running
    return out


def load_horizon_widths(
    store_id: str,
    *,
    lookback_days: int = 120,
    coverage: float = TARGET_COVERAGE,
    min_samples: int = MIN_SAMPLES_PER_HORIZON,
) -> dict[int, float]:
    """Measured per-horizon half-widths for one store, or {} when too thin."""
    sql = """
        SELECT ("forecastDate" - "generatedAt"::date) AS horizon,
               "predictedRevenue" AS predicted,
               "actualRevenue"    AS actual
        FROM "ForecastDailyRevenue"
        WHERE "storeId" = %s
          AND "hourBucket" = 0
          AND "actualRevenue" IS NOT NULL
          AND "generatedAt" >= (CURRENT_DATE - %s::int)
          AND "generatedAt" >= %s::date
          AND ("forecastDate" - "generatedAt"::date) BETWEEN 1 AND 21
    """
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql, (store_id, lookback_days, CALIBRATION_EPOCH))
        rows = [
            HorizonRow(horizon=int(h), predicted=float(p), actual=float(a))
            for h, p, a in cur.fetchall()
            if p is not None and a is not None
        ]
    return enforce_monotonic(
        relative_half_widths(rows, coverage=coverage, min_samples=min_samples)
    )
