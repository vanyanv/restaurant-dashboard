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

Every forecast row carries the horizon it was made at, so the width each
horizon actually needs is measurable. This replaces the constant with that
measurement.

The horizon comes from the recorded `horizonDay` column, with
`(forecastDate − generatedAt::date) + 1` as the fallback for rows written
before 2026-08-21. The bare subtraction — what this module used until F16 —
is one short: `forecast()` counts offsets from the last *observed* day, so
its 1-step row lands on the generation date itself. With a `BETWEEN 1 AND 21`
filter on top, that silently discarded the next-day forecast and shifted
every surviving width onto the wrong horizon. The coverage table above was
measured with the old expression and its labels are low by one.

Two deliberate choices:

- **Symmetric, on absolute relative error.** Signed residual quantiles would
  re-centre the band around whatever bias the *old* model had, and the model
  producing these residuals under-predicted by ~5%. Taking the 80th percentile
  of |error| targets coverage without importing that bias, and self-corrects as
  fresh rows reconcile.
- **Pooled across weekdays.** Per-weekday would be better, but there are ~38
  reconciled rows per horizon — five or six per weekday. Splitting them would
  produce quantiles noisier than the constant being replaced.

And one added on 2026-09-19, after the widths this module ships were measured
in production at 58-70% coverage against the 80% they promise:

- **Validated before use.** The quantile is unbiased on exchangeable rows;
  these rows drift. `validated_half_widths` fits on the older rows, measures
  what that would have covered on the newest 30%, and ships the widths only
  if they held up — scaling them when they did not, and returning {} when the
  holdout is too thin to judge. Returning {} keeps `forecast()` on the CQR
  band, which is where it was before any of this.
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

#: Fraction of each horizon's reconciled history held out, newest first, to
#: check the widths fitted on the rest before they are shipped.
#:
#: The quantile below is unbiased on exchangeable rows, and these rows are not
#: exchangeable — error levels drift as the business and the model change. The
#: docstring above already records what that costs: widths measured on the
#: older half of the pre-fix history delivered 60-76% coverage on the newer
#: half. Nothing acted on that. `forecast()` adopted any width backed by
#: MIN_SAMPLES_PER_HORIZON rows, replacing the CQR band outright, and the only
#: feedback was Gate 3 of the operator check telling a human days later. It
#: did: Hollywood's measured 80% intervals covered 0.581 on 2026-09-14,
#: climbing to 0.696 by 09-18 — inside the range this module predicted it
#: would fail in, and outside the [0.75, 0.85] Gate 3 accepts.
#:
#: So the widths are now checked against held-out rows before use, and scaled
#: to the multiple that would have delivered TARGET_COVERAGE on them.
VALIDATION_FRACTION = 0.30

#: Held-out rows needed, pooled across horizons, before the check can speak.
#: Per-horizon there are only a few dozen rows in total, so a per-horizon
#: holdout would be four or five points — noisier than what it is judging.
#: Pooling the *ratio* of error to that horizon's own width makes the horizons
#: comparable and puts 30-50 points behind the verdict.
MIN_VALIDATION_ROWS = 20

#: Held-out coverage at or above this is shipped as measured. Below it the
#: widths are scaled up. Matches Gate 3's lower acceptance bound, so this
#: module stops shipping exactly what the operator check would call broken.
MIN_VALIDATED_COVERAGE = 0.75

#: Cap on the scale-up. A factor beyond this means the held-out rows disagree
#: with the fitted ones so completely that the measurement is not describing
#: the same process; fall back rather than ship a band built on it.
MAX_VALIDATION_SCALE = 2.5


@dataclass(frozen=True)
class HorizonRow:
    horizon: int
    predicted: float
    actual: float
    #: When the forecast was generated. Used only to split fit from holdout in
    #: `validated_half_widths`; `relative_half_widths` ignores it. Optional so
    #: callers that only want the raw quantile need not supply one.
    generated_at: object | None = None

    @property
    def relative_error(self) -> float:
        return abs(self.actual - self.predicted) / self.predicted


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


def split_fit_holdout(
    rows: list[HorizonRow], *, fraction: float = VALIDATION_FRACTION
) -> tuple[list[HorizonRow], list[HorizonRow]]:
    """Oldest `1 - fraction` to fit on, newest `fraction` to check against.

    Split on time rather than at random: the failure being guarded against is
    drift, and a random split hides drift by putting the same era on both
    sides. A row with no `generated_at` cannot be placed on either side of a
    date, so it is dropped rather than left to fall wherever insertion order
    puts it — an undated set yields no split at all, and the caller reads that
    as "cannot validate".
    """
    ordered = sorted(
        (r for r in rows if r.generated_at is not None),
        key=lambda r: r.generated_at,
    )
    if not ordered:
        return [], []
    holdout_size = int(round(len(ordered) * fraction))
    if holdout_size == 0:
        return ordered, []
    return ordered[:-holdout_size], ordered[-holdout_size:]


def measure_coverage(
    widths: dict[int, float], rows: list[HorizonRow]
) -> tuple[int, float | None]:
    """How many of `rows` their own horizon's band would have contained.

    Rows whose horizon has no measured width are not counted — they are not
    what these widths claim to cover.
    """
    # Same admissibility rule as `relative_half_widths`: a non-positive
    # prediction or actual is a data error, not a miss, and `relative_error`
    # would divide by zero on it.
    judged = [
        r
        for r in rows
        if r.horizon in widths and r.predicted > 0 and r.actual > 0
    ]
    if not judged:
        return 0, None
    inside = sum(1 for r in judged if r.relative_error <= widths[r.horizon])
    return len(judged), inside / len(judged)


def validated_half_widths(
    rows: list[HorizonRow],
    *,
    coverage: float = TARGET_COVERAGE,
    min_samples: int = MIN_SAMPLES_PER_HORIZON,
    fraction: float = VALIDATION_FRACTION,
    min_validation_rows: int = MIN_VALIDATION_ROWS,
) -> dict[int, float]:
    """Per-horizon half-widths that have been checked against held-out rows.

    Fit on the older rows, measure what that would have covered on the newer
    ones, and only then decide:

      - Held-out coverage at or above MIN_VALIDATED_COVERAGE — ship the widths
        measured on everything, holdout included, since the fitted band has
        been shown to hold up on rows it never saw.
      - Below it — scale every width by the multiple that would have delivered
        `coverage` on the held-out rows. Pooling the ratio of each row's error
        to its own horizon's width is what makes horizons of different sizes
        comparable in one quantile.
      - Too few held-out rows to judge, or a scale beyond
        MAX_VALIDATION_SCALE — return {} and let `forecast()` keep the CQR
        band. An unvalidated width is not better than the path it replaces;
        it was shipping unvalidated that produced 0.581 coverage.
    """
    # Only dated rows can be validated, so only dated rows are shipped —
    # `full_widths` below is measured over the same set the check ran on.
    dated = [r for r in rows if r.generated_at is not None]
    fit_rows, holdout_rows = split_fit_holdout(dated, fraction=fraction)
    fit_widths = relative_half_widths(
        fit_rows, coverage=coverage, min_samples=min_samples
    )
    if not fit_widths:
        return {}

    judged, achieved = measure_coverage(fit_widths, holdout_rows)
    if judged < min_validation_rows or achieved is None:
        return {}

    # Everything the store has, now that the shape has been checked. Fitting
    # the shipped widths on the fit half alone would throw away the newest and
    # most representative rows.
    full_widths = relative_half_widths(
        dated, coverage=coverage, min_samples=min_samples
    )
    if not full_widths:
        return {}

    if achieved >= MIN_VALIDATED_COVERAGE:
        return enforce_monotonic(full_widths)

    # The multiple of its own horizon's width that each held-out row needed.
    # The `coverage` quantile of those is the smallest uniform scale that
    # would have covered that fraction of them.
    ratios = [
        r.relative_error / fit_widths[r.horizon]
        for r in holdout_rows
        if r.horizon in fit_widths
        and fit_widths[r.horizon] > 0
        and r.predicted > 0
        and r.actual > 0
    ]
    if not ratios:
        return {}
    scale = float(np.quantile(np.asarray(ratios), coverage))
    if scale > MAX_VALIDATION_SCALE:
        return {}
    scale = max(scale, 1.0)

    scaled = {h: w * scale for h, w in full_widths.items()}
    scaled = {h: w for h, w in scaled.items() if 0 < w <= MAX_RELATIVE_HALF_WIDTH}
    if not scaled:
        return {}
    return enforce_monotonic(scaled)


def load_horizon_widths(
    store_id: str,
    *,
    lookback_days: int = 120,
    coverage: float = TARGET_COVERAGE,
    min_samples: int = MIN_SAMPLES_PER_HORIZON,
) -> dict[int, float]:
    """Measured per-horizon half-widths for one store, or {} when too thin.

    {} is also what a store gets when its widths cannot be validated against
    held-out rows — see `validated_half_widths`. `forecast()` treats both the
    same way, by keeping the CQR band.
    """
    sql = """
        SELECT COALESCE("horizonDay",
                        ("forecastDate" - "generatedAt"::date) + 1) AS horizon,
               "predictedRevenue" AS predicted,
               "actualRevenue"    AS actual,
               "generatedAt"      AS generated_at
        FROM "ForecastDailyRevenue"
        WHERE "storeId" = %s
          AND "hourBucket" = 0
          AND "actualRevenue" IS NOT NULL
          AND "generatedAt" >= (CURRENT_DATE - %s::int)
          AND "generatedAt" >= %s::date
          AND COALESCE("horizonDay",
                       ("forecastDate" - "generatedAt"::date) + 1) BETWEEN 1 AND 21
    """
    with connect() as conn, conn.cursor() as cur:
        cur.execute(sql, (store_id, lookback_days, CALIBRATION_EPOCH))
        rows = [
            HorizonRow(
                horizon=int(h),
                predicted=float(p),
                actual=float(a),
                generated_at=g,
            )
            for h, p, a, g in cur.fetchall()
            if p is not None and a is not None
        ]
    return validated_half_widths(
        rows, coverage=coverage, min_samples=min_samples
    )
