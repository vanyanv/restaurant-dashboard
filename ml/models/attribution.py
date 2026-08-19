"""Why the model predicted what it predicted, in words an owner reads.

XGBoost computes exact TreeSHAP contributions as a by-product —
`booster.predict(dmatrix, pred_contribs=True)` returns one value per feature plus
a bias term, and they sum to the prediction. No extra dependency, no surrogate
model, one call.

Raw output is per-feature across 43 columns, which is the wrong unit: nobody
operating a restaurant wants `lag_7` weighed against `roll_28`. The groups below
collapse them into the six things that actually differ between one day and
another, so the drawer can say "Saturday +$2,100, the Bowl show +$1,180" instead
of listing gradient statistics.
"""
from __future__ import annotations

from dataclasses import dataclass

#: (label, predicate) in priority order — the first match wins, so a feature
#: lands in exactly one group. Labels are what the owner sees.
GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Weather", ("weather_",)),
    ("Nearby events", ("event_",)),
    ("Day of week", ("weekday", "is_weekend")),
    ("Holiday", ("is_holiday",)),
    ("Time of year", ("month", "day_of_month")),
    ("Recent days", ("lag_",)),
    ("Recent trend", ("roll_", "growth_rate")),
)

#: Contributions smaller than this share of the prediction are folded into
#: "Everything else" rather than given their own row. A waterfall of eight
#: near-zero bars reads as noise and hides the two that matter.
MIN_SHARE = 0.01

OTHER_LABEL = "Everything else"


@dataclass(frozen=True)
class Contribution:
    label: str
    value: float


def group_for(feature: str) -> str | None:
    for label, prefixes in GROUPS:
        for p in prefixes:
            if feature == p or feature.startswith(p):
                return label
    return None


def group_contributions(
    feature_names: list[str],
    contributions: list[float],
) -> dict[str, float]:
    """Sum per-feature SHAP values into the owner-facing groups."""
    out: dict[str, float] = {}
    for name, value in zip(feature_names, contributions):
        label = group_for(name)
        if label is None:
            label = OTHER_LABEL
        out[label] = out.get(label, 0.0) + float(value)
    return out


def build_attribution(
    *,
    base_value: float,
    feature_names: list[str],
    contributions: list[float],
    predicted: float,
    min_share: float = MIN_SHARE,
) -> dict:
    """A JSON-ready waterfall: a base, then the groups that moved it.

    `base` is TreeSHAP's bias term — the model's average output, i.e. what a day
    with no distinguishing features would earn. Groups are ordered by magnitude
    so the reason a day is unusual sits at the top, and small ones are folded
    together so the shape stays readable.

    The parts sum to `predicted` by construction; the reconstruction is asserted
    by the caller's tests rather than trusted.
    """
    grouped = group_contributions(feature_names, contributions)

    threshold = abs(predicted) * min_share
    kept: list[Contribution] = []
    residual = 0.0
    for label, value in grouped.items():
        if abs(value) < threshold or label == OTHER_LABEL:
            residual += value
        else:
            kept.append(Contribution(label, value))

    kept.sort(key=lambda c: abs(c.value), reverse=True)
    if abs(residual) >= threshold:
        kept.append(Contribution(OTHER_LABEL, residual))
        residual = 0.0

    return {
        # Anything below the threshold that wasn't worth its own row still has
        # to go somewhere, or the waterfall wouldn't add up to the forecast.
        "base": round(base_value + residual, 2),
        "groups": [
            {"label": c.label, "value": round(c.value, 2)} for c in kept
        ],
    }
