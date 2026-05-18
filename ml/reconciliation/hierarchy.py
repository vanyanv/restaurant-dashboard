"""S_df + tags builder for hierarchicalforecast.

Single-store: 3 levels (revenue, category, item).
Multi-store:  4 levels (chain, store, store_category, item) - exercised by
              the unit test in W8 but not by the nightly pipeline until
              GLN/VNYS reach `ready`.

HierarchicalReconciliation.reconcile() API contract (verified against
Nixtla docs at planning time):
  * S_df: pandas DataFrame, rows = all series unique_ids (top + middle +
    bottom), columns = bottom-level series unique_ids, values = roll-up
    weights (0 or 1).
  * tags: dict[level_name -> list[unique_id]].
  * Y_hat_df: long-format DataFrame with columns unique_id, ds, y_hat (and
    optional p10/p90).
  * Y_df: long-format DataFrame with columns unique_id, ds, y - the insample
    fitted values used by mint_shrink to estimate the covariance.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def build_single_store_hierarchy(*, item_to_category: dict[str, str]):
    """Return (S_df, tags).

    Series unique_id convention (single-store, no namespace prefix):
      * top:    "revenue"
      * middle: each category name
      * bottom: each item name
    """
    if not item_to_category:
        raise ValueError("empty item_to_category - hierarchy needs at least one item")

    items = sorted(item_to_category.keys())
    categories = sorted(set(item_to_category.values()))
    n_items = len(items)
    n_cat = len(categories)

    # Row order: revenue, categories (sorted), items (sorted).
    unique_ids = ["revenue"] + categories + items
    S = np.zeros((1 + n_cat + n_items, n_items), dtype=float)

    # Top: all 1s.
    S[0, :] = 1.0
    # Categories: 1 where item belongs.
    cat_to_row = {cat: 1 + i for i, cat in enumerate(categories)}
    for col, item in enumerate(items):
        S[cat_to_row[item_to_category[item]], col] = 1.0
    # Items (bottom): identity block.
    for col, item in enumerate(items):
        S[1 + n_cat + col, col] = 1.0

    # hierarchicalforecast contract: S_df has `unique_id` as a column (NOT
    # the index) plus one column per leaf unique_id.
    S_df = pd.DataFrame(S, columns=items)
    S_df.insert(0, "unique_id", unique_ids)

    tags = {
        "revenue": ["revenue"],
        "category": categories,
        "item": items,
    }
    # Convenience row-index map (not consumed by hierarchicalforecast; used
    # by ml.reconciliation.reconcile when writing values back).
    row_index = {name: i for i, name in enumerate(unique_ids)}
    tags["__row_index__"] = row_index
    return S_df, tags


def build_multi_store_hierarchy(*, stores: dict[str, dict[str, str]]):
    """4-level hierarchy: chain -> store -> store_category -> leaf_item.

    Series unique_id convention (must namespace by store):
      * top:    "__chain__"
      * level 2: each store_id
      * level 3: "{store_id}:{category}"
      * bottom: "{store_id}:{item}"
    """
    if not stores or not any(stores.values()):
        raise ValueError("empty stores - multi-store hierarchy needs at least one item")

    leaves: list[tuple[str, str, str]] = []  # (store, item, category)
    for store_id in sorted(stores.keys()):
        for item, cat in sorted(stores[store_id].items()):
            leaves.append((store_id, item, cat))

    n_leaves = len(leaves)
    store_ids = sorted(stores.keys())
    n_stores = len(store_ids)
    store_cat_pairs = sorted({(s, c) for s, _, c in leaves})
    n_pairs = len(store_cat_pairs)

    chain_id = "__chain__"
    store_cat_ids = [f"{s}:{c}" for s, c in store_cat_pairs]
    leaf_ids = [f"{s}:{item}" for s, item, _ in leaves]

    unique_ids = [chain_id] + store_ids + store_cat_ids + leaf_ids
    n_rows = 1 + n_stores + n_pairs + n_leaves
    S = np.zeros((n_rows, n_leaves), dtype=float)

    # Chain.
    S[0, :] = 1.0
    # Stores.
    for i, store_id in enumerate(store_ids):
        row = 1 + i
        for col, (s, _, _) in enumerate(leaves):
            if s == store_id:
                S[row, col] = 1.0
    # Store-category.
    pair_to_row = {pair: 1 + n_stores + i for i, pair in enumerate(store_cat_pairs)}
    for col, (s, _, c) in enumerate(leaves):
        S[pair_to_row[(s, c)], col] = 1.0
    # Leaf identity block.
    leaf_offset = 1 + n_stores + n_pairs
    for col in range(n_leaves):
        S[leaf_offset + col, col] = 1.0

    S_df = pd.DataFrame(S, columns=leaf_ids)
    S_df.insert(0, "unique_id", unique_ids)

    tags = {
        "chain": [chain_id],
        "store": store_ids,
        "store_category": store_cat_ids,
        "leaf": leaf_ids,
        "__row_index__": {name: i for i, name in enumerate(unique_ids)},
    }
    return S_df, tags
