"""MinTrace hierarchical reconciliation runner.

Reads point forecasts from the in-memory forecast_frame (built by the caller
from the latest ForecastDailyRevenue / ForecastDailyCategory / ForecastMenuItem
native rows), runs MinTrace from `hierarchicalforecast`, and writes reconciled
point estimates back via idempotent UPDATE. Fails soft on any exception -
unreconciled values remain in place and a warning is returned.

Auto-fallback: when `method='mint_shrink'` but `y_df` is empty (cold-start
store, no historical actuals yet), retries with `method='ols'` which doesn't
need the insample residuals. The final method used is reported on the result.

The (S_df, tags) hierarchy comes from ml.reconciliation.hierarchy.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Optional

import numpy as np
import pandas as pd

from ml.reconciliation.hierarchy import build_single_store_hierarchy


_LOG = logging.getLogger(__name__)


_METHODS_REQUIRING_Y_DF = {"mint_shrink", "mint_cov", "wls_var"}


@dataclass
class ReconcileResult:
    ok: bool
    rows_written: int = 0
    method: str = ""
    warning: str = ""


# UPDATE-idempotent: the natural key of each row is unique, so re-running just
# overwrites the same reconciled columns with the same values.
_REVENUE_UPSERT_SQL = '''
    UPDATE "ForecastDailyRevenue"
    SET "reconciledRevenue" = %s,
        "reconciledP10" = %s,
        "reconciledP90" = %s,
        "reconciledAt" = CURRENT_TIMESTAMP,
        "reconciliationMethod" = %s
    WHERE "storeId" = %s AND "forecastDate" = %s AND "hourBucket" = 0
      AND "generatedAt" = (
        SELECT MAX("generatedAt") FROM "ForecastDailyRevenue"
        WHERE "storeId" = %s AND "forecastDate" = %s AND "hourBucket" = 0
          AND "forecastSource" = 'native'
      )
'''

_CATEGORY_UPSERT_SQL = '''
    UPDATE "ForecastDailyCategory"
    SET "reconciledRevenue" = %s,
        "reconciledAt" = CURRENT_TIMESTAMP,
        "reconciliationMethod" = %s
    WHERE "storeId" = %s AND date = %s AND "categoryName" = %s
'''

_ITEM_UPSERT_SQL = '''
    UPDATE "ForecastMenuItem"
    SET "reconciledQty" = %s,
        "reconciliationMethod" = %s
    WHERE "storeId" = %s AND "forecastDate" = %s AND "otterItemSkuId" = %s
      AND "generatedAt" = (
        SELECT MAX("generatedAt") FROM "ForecastMenuItem"
        WHERE "storeId" = %s AND "forecastDate" = %s AND "otterItemSkuId" = %s
          AND "forecastSource" = 'native'
      )
'''


def _run_min_trace(S_df, tags, y_hat_df, y_df, method: str) -> pd.DataFrame:
    """Thin wrapper so tests can monkeypatch this single call site.

    `tags` here is the *level-name* dict only - the __row_index__ entry from
    ml.reconciliation.hierarchy is stripped before passing in. Returns the
    reconciler's output DataFrame; column for the reconciled values is named
    like 'MinTrace/mint_shrink' (one column per reconciler in the list).
    """
    from hierarchicalforecast.core import HierarchicalReconciliation
    from hierarchicalforecast.methods import MinTrace

    public_tags = {k: v for k, v in tags.items() if not k.startswith("__")}
    reconciler = HierarchicalReconciliation([MinTrace(method=method)])
    kwargs = {"Y_hat_df": y_hat_df, "S_df": S_df, "tags": public_tags}
    if method in _METHODS_REQUIRING_Y_DF:
        kwargs["Y_df"] = y_df
    return reconciler.reconcile(**kwargs)


def _reconciled_column_name(reconciled_df: pd.DataFrame) -> Optional[str]:
    """Find the reconciler-output column. Convention is 'MinTrace/<method>'
    but the helper tolerates any non-meta numeric column added by the lib."""
    meta = {"unique_id", "ds", "y", "y_hat"}
    for col in reconciled_df.columns:
        if col in meta:
            continue
        if pd.api.types.is_numeric_dtype(reconciled_df[col]):
            return col
    return None


def reconcile_store_hierarchy(
    conn,
    *,
    store_id: str,
    forecast_frame: dict[str, Any],
    y_df: pd.DataFrame,
    method: str = "mint_shrink",
) -> ReconcileResult:
    """Reconcile one store's hierarchy across the forecast horizon and write
    results back.

    `forecast_frame` shape (built by the caller):
      {
        "revenue":    [(date, point, p10, p90), ...],
        "categories": { category_name: [(date, point, p10, p90), ...], ... },
        "items":      { item_name:     [(date, qty,   p10, p90), ...], ... },
        "prices":     { item_name: avg_price, ... },
        "item_to_category": { item_name: category_name, ... },
      }

    `y_df` is a long-format DataFrame with columns unique_id, ds, y holding
    insample historical actuals - required for mint_shrink covariance
    estimation. May be empty; we fall back to method='ols' automatically.

    Fails soft on any other exception; caller logs the warning into JobRun.
    """
    chosen_method = method
    if method in _METHODS_REQUIRING_Y_DF and (y_df is None or y_df.empty):
        chosen_method = "ols"

    try:
        S_df, tags = build_single_store_hierarchy(
            item_to_category=forecast_frame["item_to_category"],
        )
        y_hat_df = _build_y_hat_df(forecast_frame, S_df)
        reconciled = _run_min_trace(S_df, tags, y_hat_df, y_df, chosen_method)
    except Exception as exc:  # pylint: disable=broad-except
        # If the failure was due to mint_shrink residual issues, try ols once.
        if chosen_method == "mint_shrink":
            try:
                chosen_method = "ols"
                reconciled = _run_min_trace(S_df, tags, y_hat_df, y_df, chosen_method)
            except Exception as exc2:  # pylint: disable=broad-except
                return ReconcileResult(
                    ok=False, method=chosen_method,
                    warning=f"{type(exc).__name__}: {exc}; ols-fallback: {exc2}",
                )
        else:
            return ReconcileResult(
                ok=False, method=chosen_method,
                warning=f"{type(exc).__name__}: {exc}",
            )

    rows_written = _write_reconciled(conn, store_id, reconciled, forecast_frame, chosen_method)
    return ReconcileResult(ok=True, rows_written=rows_written, method=chosen_method)


def _build_y_hat_df(forecast_frame, S_df: pd.DataFrame) -> pd.DataFrame:
    """Long-format Y_hat_df with columns unique_id, ds, y_hat.

    Series ids match the S_df row index (revenue / category names / item
    names). Item-level values are converted from qty -> revenue via avg
    price so every level is in dollars.
    """
    rows = []
    for date, point, _p10, _p90 in forecast_frame["revenue"]:
        rows.append({"unique_id": "revenue", "ds": pd.Timestamp(date), "y_hat": float(point)})
    for cat, series in forecast_frame["categories"].items():
        for date, point, _p10, _p90 in series:
            rows.append({"unique_id": cat, "ds": pd.Timestamp(date), "y_hat": float(point)})
    for item, series in forecast_frame["items"].items():
        price = forecast_frame["prices"].get(item, 1.0) or 1.0
        for date, qty, _p10, _p90 in series:
            rows.append({"unique_id": item, "ds": pd.Timestamp(date), "y_hat": float(qty) * price})
    df = pd.DataFrame(rows)
    # Defensive: filter to series the S_df knows about.
    known_ids = set(S_df["unique_id"])
    return df[df["unique_id"].isin(known_ids)].reset_index(drop=True)


def _write_reconciled(
    conn, store_id: str, reconciled_df: pd.DataFrame, forecast_frame, method: str,
) -> int:
    """Idempotent write of reconciled values back to the three forecast tables."""
    col = _reconciled_column_name(reconciled_df)
    if col is None or reconciled_df.empty:
        return 0

    indexed = reconciled_df.set_index(["unique_id", "ds"])[col]

    def _get(uid: str, date) -> Optional[float]:
        try:
            v = indexed.loc[(uid, pd.Timestamp(date))]
            return float(v) if pd.notna(v) else None
        except (KeyError, TypeError):
            return None

    written = 0
    with conn.cursor() as cur:
        # Revenue (top).
        for date, _point, p10, p90 in forecast_frame["revenue"]:
            new_point = _get("revenue", date)
            if new_point is None:
                continue
            cur.execute(
                _REVENUE_UPSERT_SQL,
                (new_point, p10, p90, method, store_id, date, store_id, date),
            )
            written += 1
        # Categories.
        for cat, series in forecast_frame["categories"].items():
            for date, _point, _p10, _p90 in series:
                new_point = _get(cat, date)
                if new_point is None:
                    continue
                cur.execute(_CATEGORY_UPSERT_SQL, (new_point, method, store_id, date, cat))
                written += 1
        # Items: reconciled output is in revenue units; divide by avg price
        # to recover qty for the ForecastMenuItem.reconciledQty column.
        for item, series in forecast_frame["items"].items():
            price = forecast_frame["prices"].get(item, 1.0) or 1.0
            for date, _qty, _p10, _p90 in series:
                new_rev = _get(item, date)
                if new_rev is None:
                    continue
                new_qty = new_rev / price
                cur.execute(
                    _ITEM_UPSERT_SQL,
                    (new_qty, method, store_id, date, item, store_id, date, item),
                )
                written += 1
    return written
