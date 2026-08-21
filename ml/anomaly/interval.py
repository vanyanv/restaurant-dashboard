"""Anomaly detection against each day's own prediction interval.

The rolling z-score this replaces pooled a 28-day mean and standard deviation
over a series with a large weekly cycle. The σ it produced was inflated by
seasonality — variation the model already expects — so every z was deflated and
`|z| > 3` was close to unreachable. It also scored only the most recent
observation, never backfilled, and used estimators with a breakdown point of
zero, so one outage distorted the yardstick for the next four weeks.

Everything needed for a better detector already existed. `reconcile_past_forecasts`
writes the actual back onto the forecast row, and every forecast row carries a
calibrated P10/P90 for that specific store-day. So:

    an anomaly is an actual outside its own day's interval.

Seasonality is handled because the interval came from a model that knows what
day of the week it is. Robustness is handled because no pooled dispersion
estimate is involved. Any window can be scored, so a skipped nightly run costs
nothing. And the output is a dollar residual against an expected value, which is
what an operator can act on — `z = -3.2` is not.
"""
from __future__ import annotations

import datetime as dt
import logging
import math
from dataclasses import dataclass
from typing import Iterable, Optional, Sequence

from ml.db import connect

_LOG = logging.getLogger(__name__)

#: Method recorded on AnomalyEvent rows produced here. Requires the matching
#: value on the `AnomalyMethod` Postgres enum — see
#: prisma/manual-migrations/2026-08-21_anomaly_method_prediction_interval.sql.
METHOD = "PREDICTION_INTERVAL"

#: A miss smaller than this share of the forecast is calibration noise rather
#: than news, however tight the band happened to be that day.
DEFAULT_MIN_RELATIVE_RESIDUAL = 0.10

#: How far beyond the band an actual must fall before it is worth telling
#: anyone about, in units of that side's half-width.
#:
#: p10/p90 is an *80%* interval, so about one day in five lands outside it
#: when the model is working exactly as designed. Alerting on every breach
#: turns a property of the interval into a full inbox: the first production
#: dry-run flagged 8 days out of 26, which is the breach rate, not eight
#: surprises.
#:
#: The bar is derived rather than tuned. Under the same dispersion a 95%
#: interval is 1.96/1.2816 times as wide as an 80% one, so requiring the
#: excess to exceed that ratio minus one puts the threshold at the implied
#: 95% band — roughly one day in twenty. Nothing here was fitted to a month
#: that happened to look a certain way.
DEFAULT_MIN_SEVERITY = 1.9600 / 1.2816 - 1.0

#: Days of reconciled history to score on each run. Comfortably longer than any
#: plausible run of failed nightlies, so a gap backfills itself.
DEFAULT_LOOKBACK_DAYS = 30


@dataclass(frozen=True)
class IntervalObservation:
    """One reconciled store-day: what was forecast, and what happened."""
    occurred_on: dt.date
    actual: Optional[float]
    predicted: float
    p10: float
    p90: float


@dataclass(frozen=True)
class IntervalAnomaly:
    occurred_on: dt.date
    actual: float
    predicted: float
    p10: float
    p90: float
    #: Dollars against the forecast — signed, and the number an operator reads.
    residual: float
    #: "above" or "below" the band.
    direction: str
    #: How far outside the band, in units of that side's half-width. 1.0 means
    #: the actual missed by as much again as the whole interval allowed for.
    severity: float


def interval_coverage_rate(
    observations: Iterable[IntervalObservation],
) -> Optional[float]:
    """Share of observed days whose actual landed inside its own P10/P90.

    This is a calibration health metric, not an alerting one, and the two must
    stay separate: the breach rate says whether the *bands* are right, while
    the alert count says whether the *days* were unusual. Hollywood measured
    69% here against an 80% target on 2026-08-21 — the bands run narrow, which
    is F10's problem and not something to notify an owner about.

    Returns None for an empty window rather than 0.0, which would read as
    "nothing was covered" instead of "nothing was measured".
    """
    total = 0
    inside = 0
    for obs in observations:
        actual = obs.actual
        if actual is None or (isinstance(actual, float) and math.isnan(actual)):
            continue
        total += 1
        if obs.p10 <= actual <= obs.p90:
            inside += 1
    return inside / total if total else None


def score_interval_anomalies(
    observations: Iterable[IntervalObservation],
    *,
    min_relative_residual: float = DEFAULT_MIN_RELATIVE_RESIDUAL,
    min_severity: float = DEFAULT_MIN_SEVERITY,
) -> list[IntervalAnomaly]:
    """Flag observations whose actual fell outside the day's own P10/P90.

    Skipped rather than flagged:
      - no actual (an unobserved day carries NaN, see F1)
      - a degenerate band, `p10 == p90`, which every actual sits outside of
      - a zero or negative forecast, where a relative miss is undefined
      - a miss below `min_relative_residual` of the forecast
      - a breach shallower than `min_severity`, which an 80% interval
        produces about one day in five without anything being wrong

    Pass `min_severity=0.0` for calibration reporting, where every breach is
    the point. Leave the default for anything that reaches an operator.
    """
    out: list[IntervalAnomaly] = []

    for obs in observations:
        actual = obs.actual
        if actual is None or (isinstance(actual, float) and math.isnan(actual)):
            continue
        if obs.predicted <= 0:
            continue
        if not (obs.p90 > obs.p10):
            continue
        if obs.p10 <= actual <= obs.p90:
            continue

        residual = float(actual) - obs.predicted
        if abs(residual) / obs.predicted < min_relative_residual:
            continue

        if actual > obs.p90:
            direction = "above"
            half_width = obs.p90 - obs.predicted
            excess = actual - obs.p90
        else:
            direction = "below"
            half_width = obs.predicted - obs.p10
            excess = obs.p10 - actual

        severity = float(excess / half_width) if half_width > 0 else float("inf")
        if severity < min_severity:
            continue

        out.append(IntervalAnomaly(
            occurred_on=obs.occurred_on,
            actual=float(actual),
            predicted=obs.predicted,
            p10=obs.p10,
            p90=obs.p90,
            residual=residual,
            direction=direction,
            severity=severity,
        ))

    return out


def load_reconciled_observations(
    store_id: str,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
) -> list[IntervalObservation]:
    """Reconciled daily-revenue forecasts for the trailing window.

    Takes the newest forecast per date, which is the one made closest to the
    day — the most informed prediction anyone had, and therefore the fairest
    thing to call an actual surprising against.
    """
    sql = """
        SELECT DISTINCT ON (f."forecastDate")
               f."forecastDate"::date,
               f."actualRevenue"::float,
               f."predictedRevenue"::float,
               f.p10::float,
               f.p90::float
        FROM "ForecastDailyRevenue" f
        WHERE f."storeId" = %s
          AND f."hourBucket" = 0
          AND f."actualRevenue" IS NOT NULL
          AND f.p10 IS NOT NULL
          AND f.p90 IS NOT NULL
          AND f."forecastDate" >= CURRENT_DATE - %s::INTEGER
          AND f."forecastDate" < CURRENT_DATE
        ORDER BY f."forecastDate", f."generatedAt" DESC
    """
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (store_id, lookback_days))
            rows = cur.fetchall()

    return [
        IntervalObservation(
            occurred_on=r[0],
            actual=r[1],
            predicted=r[2],
            p10=r[3],
            p90=r[4],
        )
        for r in rows
    ]


def detect_revenue_interval_anomalies(
    store_id: str,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
) -> list[IntervalAnomaly]:
    """Score the trailing reconciled window for one store.

    Returns an empty list when the store has no reconciled forecasts yet — a
    warming-up store, or one whose first nightly has not landed. The caller
    falls back to the z-score detector in that case.
    """
    observations = load_reconciled_observations(store_id, lookback_days)
    if not observations:
        _LOG.info(
            "interval anomalies: no reconciled rows for store %s — nothing to score",
            store_id,
        )
        return []
    return score_interval_anomalies(observations)


def explain(anomaly: IntervalAnomaly) -> str:
    """One line of operator English for the AnomalyEvent row."""
    verb = "over" if anomaly.direction == "above" else "under"
    return (
        f"${anomaly.actual:,.0f} came in {verb} a forecast of "
        f"${anomaly.predicted:,.0f} (expected ${anomaly.p10:,.0f}-${anomaly.p90:,.0f}); "
        f"${abs(anomaly.residual):,.0f} {verb}."
    )


def to_anomaly_events(anomalies: Sequence[IntervalAnomaly]) -> list["Anomaly"]:
    """Adapt to the row shape `ml.anomaly.zscore.write_anomalies` persists.

    `z_score` stays None. There is no pooled distribution here to standardise
    against, and the column is nullable — inventing a z would make two
    incomparable numbers look like one metric on the monitoring panel.
    """
    from ml.anomaly.zscore import Anomaly

    return [
        Anomaly(
            target="REVENUE",
            target_id=None,
            occurred_on=a.occurred_on,
            residual=a.residual,
            z_score=None,
            method=METHOD,
            explanation=explain(a),
        )
        for a in anomalies
    ]
