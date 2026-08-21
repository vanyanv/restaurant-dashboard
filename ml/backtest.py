"""Rolling-origin backtest for the forecast models.

The pipeline could measure a single night — reconciled forecasts against
actuals — but it could not answer "is this candidate model better than the one
we ship", because answering that means replaying the whole train-and-forecast
path at many historical cutoffs. That was being done by hand, in scripts that
did not survive the session, and the results were recorded as prose in code
comments.

This walks the real `train()` -> `forecast()` path with history truncated at
each cutoff, and scores every horizon day separately. Pooling horizons hides
the thing you most need to see: a model can be excellent at one day out and
useless at fourteen, and the fourteen-day number is the one an owner places
stock orders against.

Usage:

    python -m ml.backtest --store <id> --cutoffs 10 --horizon 14
    python -m ml.backtest --store <id> --compare enriched

Everything here is deterministic given the same history, so a run is
reproducible and can gate CI.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
from dataclasses import asdict, dataclass
from typing import Iterable, Optional, Sequence

import numpy as np
import pandas as pd

from ml.evaluation import metrics
from ml.features.revenue import load_daily_revenue
from ml.models.direct_revenue import forecast_direct, train_direct
from ml.models.revenue import forecast as forecast_revenue
from ml.models.revenue import train as train_revenue

_LOG = logging.getLogger(__name__)

#: Days of history a cutoff must have behind it before training is meaningful.
#: Matches the floor `ml.models.revenue.train` enforces.
DEFAULT_MIN_TRAIN_DAYS = 60


@dataclass(frozen=True)
class BacktestRecord:
    """One (cutoff, forecast_date) pair scored against what actually happened."""
    cutoff: dt.date
    forecast_date: dt.date
    horizon: int
    actual: float
    predicted: float
    p10: float
    p90: float


@dataclass(frozen=True)
class HorizonScore:
    horizon: int
    wape: float
    mape: Optional[float]
    bias: float
    coverage80: float
    sample_size: int


def rolling_origin_cutoffs(
    dates: Sequence[pd.Timestamp] | pd.DatetimeIndex,
    *,
    n_cutoffs: int,
    horizon: int,
    step: int = 7,
    min_train_days: int = DEFAULT_MIN_TRAIN_DAYS,
) -> list[dt.date]:
    """Cutoff dates for a rolling-origin evaluation, oldest first.

    Every returned cutoff has at least `min_train_days` of history behind it and
    a full `horizon` of actuals ahead of it — otherwise the fold would either
    train on nothing or score against days that never happened.

    Fewer cutoffs than requested is the correct answer for a short history. The
    caller is told how many it got; it is never given invalid folds to make the
    count.
    """
    if len(dates) == 0:
        return []

    index = pd.DatetimeIndex(dates).sort_values()
    first = index[0].date()
    last = index[-1].date()

    latest = last - dt.timedelta(days=horizon)
    earliest = first + dt.timedelta(days=min_train_days)
    if latest < earliest:
        return []

    cutoffs: list[dt.date] = []
    for i in range(n_cutoffs):
        c = latest - dt.timedelta(days=step * i)
        if c < earliest:
            break
        cutoffs.append(c)
    return sorted(cutoffs)


def score_by_horizon(records: Iterable[BacktestRecord]) -> dict[int, HorizonScore]:
    """Per-horizon accuracy, calibration and bias.

    `bias` is signed and relative — Σ(pred − actual) / Σ|actual| — so it reads
    directly as "the model runs 5% low" rather than as a dollar figure whose
    meaning depends on the store.
    """
    grouped: dict[int, list[BacktestRecord]] = {}
    for r in records:
        grouped.setdefault(r.horizon, []).append(r)

    out: dict[int, HorizonScore] = {}
    for horizon, rows in sorted(grouped.items()):
        actual = np.array([r.actual for r in rows], dtype=float)
        pred = np.array([r.predicted for r in rows], dtype=float)
        lower = np.array([r.p10 for r in rows], dtype=float)
        upper = np.array([r.p90 for r in rows], dtype=float)

        denom = float(np.sum(np.abs(actual)))
        wape = metrics.wape(actual, pred)
        out[horizon] = HorizonScore(
            horizon=horizon,
            wape=float(wape) if wape is not None else float("inf"),
            mape=metrics.mape(actual, pred),
            bias=float(np.sum(pred - actual) / denom) if denom else 0.0,
            coverage80=float(metrics.interval_coverage(actual, lower, upper) or 0.0),
            sample_size=len(rows),
        )
    return out


def summarise(scores: dict[int, HorizonScore]) -> dict:
    """Headline numbers for a run — what a CI gate and a human both read first."""
    if not scores:
        return {"horizons": 0, "sample_size": 0}

    ordered = [scores[h] for h in sorted(scores)]
    worst = max(ordered, key=lambda s: s.wape)
    return {
        "horizons": len(ordered),
        "sample_size": sum(s.sample_size for s in ordered),
        "wape_h1": ordered[0].wape,
        "wape_worst": worst.wape,
        "wape_worst_horizon": worst.horizon,
        "wape_mean": float(np.mean([s.wape for s in ordered])),
        "bias_h1": ordered[0].bias,
        "coverage80_h1": ordered[0].coverage80,
        "coverage80_mean": float(np.mean([s.coverage80 for s in ordered])),
    }


def backtest_revenue(
    store_id: str,
    *,
    n_cutoffs: int = 10,
    horizon: int = 14,
    step: int = 7,
    enriched: bool = False,
    history: Optional[pd.DataFrame] = None,
    min_train_days: int = DEFAULT_MIN_TRAIN_DAYS,
) -> list[BacktestRecord]:
    """Replay train -> forecast at each cutoff and score against actuals.

    The model at each fold sees only `history[date <= cutoff]`, so nothing it
    is scored on was ever available to it. Folds that fail to train (too little
    history, no calibration window) are skipped and logged rather than being
    silently counted as perfect.
    """
    if history is None:
        history = load_daily_revenue(store_id)
    if history is None or history.empty:
        return []

    history = history.dropna(subset=["revenue"]).sort_values("date").reset_index(drop=True)
    cutoffs = rolling_origin_cutoffs(
        pd.DatetimeIndex(history["date"]),
        n_cutoffs=n_cutoffs,
        horizon=horizon,
        step=step,
        min_train_days=min_train_days,
    )
    if not cutoffs:
        _LOG.warning("backtest_revenue: history too short for any valid fold")
        return []

    actual_by_date = {
        d.date(): float(v)
        for d, v in zip(history["date"], history["revenue"])
    }

    records: list[BacktestRecord] = []
    for cutoff in cutoffs:
        past = history[history["date"] <= pd.Timestamp(cutoff)]
        result = train_revenue(store_id, enriched=enriched, history=past)
        if result is None:
            _LOG.warning("backtest_revenue: fold %s did not train — skipped", cutoff)
            continue

        rows = forecast_revenue(store_id, result, horizon_days=horizon, history=past)
        for row in rows:
            actual = actual_by_date.get(row.forecast_date)
            if actual is None:
                continue
            records.append(BacktestRecord(
                cutoff=cutoff,
                forecast_date=row.forecast_date,
                horizon=(row.forecast_date - cutoff).days,
                actual=actual,
                predicted=float(row.predicted_revenue),
                p10=float(row.p10),
                p90=float(row.p90),
            ))

    return records


def backtest_direct_revenue(
    store_id: str,
    *,
    n_cutoffs: int = 10,
    horizon: int = 14,
    step: int = 7,
    history: Optional[pd.DataFrame] = None,
    min_train_days: int = DEFAULT_MIN_TRAIN_DAYS,
) -> list[BacktestRecord]:
    """Same folds, same scoring, against the direct multi-horizon candidate.

    Identical cutoff selection to `backtest_revenue` so the two are directly
    comparable — the only thing that differs between the runs is the model.
    """
    if history is None:
        history = load_daily_revenue(store_id)
    if history is None or history.empty:
        return []

    history = history.dropna(subset=["revenue"]).sort_values("date").reset_index(drop=True)
    cutoffs = rolling_origin_cutoffs(
        pd.DatetimeIndex(history["date"]),
        n_cutoffs=n_cutoffs, horizon=horizon, step=step, min_train_days=min_train_days,
    )
    if not cutoffs:
        return []

    actual_by_date = {d.date(): float(v) for d, v in zip(history["date"], history["revenue"])}

    records: list[BacktestRecord] = []
    for cutoff in cutoffs:
        past = history[history["date"] <= pd.Timestamp(cutoff)]
        result = train_direct({store_id: past}, horizons=range(1, horizon + 1))
        if result is None:
            _LOG.warning("backtest_direct: fold %s did not train — skipped", cutoff)
            continue
        for row in forecast_direct(result, store_id, past, horizon_days=horizon):
            actual = actual_by_date.get(row.forecast_date)
            if actual is None:
                continue
            records.append(BacktestRecord(
                cutoff=cutoff, forecast_date=row.forecast_date, horizon=row.horizon,
                actual=actual, predicted=float(row.predicted_revenue),
                p10=float(row.p10), p90=float(row.p90),
            ))
    return records


def _report(records: list[BacktestRecord]) -> dict:
    scores = score_by_horizon(records)
    return {
        "summary": summarise(scores),
        "by_horizon": [asdict(scores[h]) for h in sorted(scores)],
    }


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Rolling-origin backtest for revenue forecasts")
    parser.add_argument("--store", required=True, help="Store id")
    parser.add_argument("--cutoffs", type=int, default=10)
    parser.add_argument("--horizon", type=int, default=14)
    parser.add_argument("--step", type=int, default=7)
    parser.add_argument(
        "--compare",
        action="store_true",
        help="Also backtest the enriched flavor and print both",
    )
    parser.add_argument(
        "--direct",
        action="store_true",
        help="Also backtest the direct multi-horizon candidate (F12/F13)",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")

    history = load_daily_revenue(args.store)
    out = {
        "store": args.store,
        "cutoffs": args.cutoffs,
        "horizon": args.horizon,
        "baseline": _report(backtest_revenue(
            args.store, n_cutoffs=args.cutoffs, horizon=args.horizon,
            step=args.step, enriched=False, history=history,
        )),
    }
    if args.direct:
        out["direct"] = _report(backtest_direct_revenue(
            args.store, n_cutoffs=args.cutoffs, horizon=args.horizon,
            step=args.step, history=history,
        ))
    if args.compare:
        out["enriched"] = _report(backtest_revenue(
            args.store, n_cutoffs=args.cutoffs, horizon=args.horizon,
            step=args.step, enriched=True, history=history,
        ))

    print(json.dumps(out, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
