"""Dollar impacts with error bars.

`impact.py` is deterministic algebra: `elasticity × units × margin × Δprice`.
Every input is an estimate, and the elasticity is the one that now carries a
measured standard error, so its uncertainty can be pushed through the formula
instead of discarded.

The propagation is Monte Carlo rather than the delta method because the formula
is not linear in the elasticity once the implied quantity change feeds back into
revenue — a closed form would need re-deriving the moment anyone touches the
generator, and would be wrong quietly.

**The interval is a floor, not the whole story.** Only the elasticity's
uncertainty is propagated. Units and margin are estimates too, from a 30-day
aggregate and a recipe cost walk, and neither reports an error today. A range
computed here is narrower than the truth, which is worth saying out loud on any
surface that shows it.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import numpy as np

#: Draws per estimate. 4000 puts the Monte-Carlo error on the p10/p90 well below
#: the width of the interval itself, and costs microseconds at this scale.
DRAWS = 4000

#: Fixed so a nightly run is reproducible: the same inputs must produce the same
#: recommendation, or the ledger reshuffles for no reason an owner can see.
SEED = 20260819


@dataclass(frozen=True)
class ImpactInterval:
    """Point estimate plus the range around it, in dollars."""
    point: float
    p10: float
    #: The ranking figure. A wide, speculative $900 should not outrank a tight,
    #: dependable $700, and the 25th percentile is what encodes that.
    p25: float
    p90: float

    @property
    def is_degenerate(self) -> bool:
        """True when there was no uncertainty to propagate."""
        return self.p10 == self.point == self.p90


def _degenerate(point: float) -> ImpactInterval:
    return ImpactInterval(point=point, p10=point, p25=point, p90=point)


def interval_for(
    compute: Callable[[float], float],
    *,
    elasticity: float,
    elasticity_std_err: float | None,
    draws: int = DRAWS,
    seed: int = SEED,
) -> ImpactInterval:
    """Propagate the elasticity's standard error through an arbitrary formula.

    Generators do not all reduce to `impact.reprice_impact`; the reprice one
    computes a closed-form net benefit of its own. Resampling the elasticity and
    re-running the caller's *actual* formula keeps the interval honest, rather
    than describing a parallel formula that happens to live nearby.
    """
    point = float(compute(elasticity))

    if (
        elasticity_std_err is None
        or not np.isfinite(elasticity_std_err)
        or elasticity_std_err <= 0
    ):
        return _degenerate(point)

    rng = np.random.default_rng(seed)
    sampled = rng.normal(elasticity, elasticity_std_err, size=draws)
    impacts = np.array([float(compute(float(e))) for e in sampled], dtype=float)
    impacts = impacts[np.isfinite(impacts)]
    if impacts.size == 0:
        return _degenerate(point)

    p10, p25, p90 = (float(v) for v in np.quantile(impacts, [0.10, 0.25, 0.90]))
    lo, hi = (p10, p90) if p10 <= p90 else (p90, p10)
    return ImpactInterval(point=point, p10=lo, p25=float(p25), p90=hi)


def reprice_impact_interval(
    *,
    elasticity: float,
    elasticity_std_err: float | None,
    current_units: float,
    current_margin: float,
    delta_price: float,
    draws: int = DRAWS,
    seed: int = SEED,
) -> ImpactInterval:
    """Propagate the elasticity's standard error through the reprice formula.

    Falls back to a degenerate interval — point == p10 == p90 — when the fit
    reported no standard error, which is the honest representation of "we cannot
    say how uncertain this is" and lets callers omit a range rather than invent
    a tight one.
    """
    return interval_for(
        lambda e: e * current_units * current_margin * delta_price,
        elasticity=elasticity,
        elasticity_std_err=elasticity_std_err,
        draws=draws,
        seed=seed,
    )


def ranking_value(interval: ImpactInterval | None, fallback: float) -> float:
    """What the ledger sorts on.

    A measured downside where one exists, the point estimate otherwise — so an
    opportunity is never promoted simply for having no error bars.
    """
    if interval is None:
        return fallback
    return interval.p25
