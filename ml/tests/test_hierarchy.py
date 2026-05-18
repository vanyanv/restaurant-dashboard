"""Tests for the BottomUp S_df and tags builder.

`hierarchicalforecast.HierarchicalReconciliation` consumes (S_df, tags). Our
build must produce shapes consistent with their expected contract for both
the single-store hierarchy (revenue / category / item) and the multi-store
extension (chain / store / store_category / leaf).
"""
from __future__ import annotations

import pytest

from ml.reconciliation.hierarchy import (
    build_single_store_hierarchy,
    build_multi_store_hierarchy,
)


def test_single_store_s_df_rolls_items_to_categories_to_revenue():
    # 2 categories, 3 items:
    #   Sandwiches: [Bacon Eddy, Cheesy Eddy]
    #   Drinks:     [Iced Coffee]
    item_to_category = {
        "Bacon Eddy":  "Sandwiches",
        "Cheesy Eddy": "Sandwiches",
        "Iced Coffee": "Drinks",
    }

    S_df, tags = build_single_store_hierarchy(item_to_category=item_to_category)

    # Top (revenue) + 2 categories + 3 items = 6 rows.
    # Columns: 'unique_id' + 3 leaf columns.
    assert S_df.shape == (6, 4)
    assert list(S_df.columns) == ["unique_id", "Bacon Eddy", "Cheesy Eddy", "Iced Coffee"]
    # `unique_id` is a column (not the index) per hierarchicalforecast contract.
    assert list(S_df["unique_id"]) == [
        "revenue", "Drinks", "Sandwiches", "Bacon Eddy", "Cheesy Eddy", "Iced Coffee",
    ]

    leaf_cols = ["Bacon Eddy", "Cheesy Eddy", "Iced Coffee"]
    # Revenue row sums every item.
    rev = S_df[S_df["unique_id"] == "revenue"][leaf_cols].iloc[0]
    assert (rev == 1).all()
    # Sandwiches sums the 2 sandwich items; Drinks sums 1.
    assert S_df[S_df["unique_id"] == "Sandwiches"][leaf_cols].iloc[0].sum() == 2
    assert S_df[S_df["unique_id"] == "Drinks"][leaf_cols].iloc[0].sum() == 1
    # Each leaf row picks itself (identity block).
    bacon_row = S_df[S_df["unique_id"] == "Bacon Eddy"][leaf_cols].iloc[0]
    assert bacon_row["Bacon Eddy"] == 1
    assert bacon_row["Iced Coffee"] == 0


def test_tags_keys_are_level_names():
    """tags must expose each level name as a list of unique_ids (the keys
    hierarchicalforecast addresses for reconciliation)."""
    item_to_category = {"Item A": "Cat A", "Item B": "Cat B"}
    _, tags = build_single_store_hierarchy(item_to_category=item_to_category)
    assert set(tags.keys()) >= {"revenue", "category", "item"}
    assert tags["revenue"] == ["revenue"]
    assert set(tags["item"]) == {"Item A", "Item B"}


def test_multi_store_hierarchy_adds_chain_level():
    """Chain ~= sum stores. With 2 stores each contributing items, the chain
    row must sum every leaf and store rows sum that store's items."""
    stores = {
        "store-hwd": {
            "Bacon Eddy":  "Sandwiches",
            "Iced Coffee": "Drinks",
        },
        "store-gln": {
            "Bacon Eddy":  "Sandwiches",
        },
    }
    S_df, tags = build_multi_store_hierarchy(stores=stores)
    # 3 leaves + 1 unique_id column = 4 columns.
    assert S_df.shape[1] == 4
    leaf_cols = [c for c in S_df.columns if c != "unique_id"]
    assert len(leaf_cols) == 3
    chain_row = S_df[S_df["unique_id"] == "__chain__"][leaf_cols].iloc[0]
    assert (chain_row == 1).all()
    hwd_row = S_df[S_df["unique_id"] == "store-hwd"][leaf_cols].iloc[0]
    gln_row = S_df[S_df["unique_id"] == "store-gln"][leaf_cols].iloc[0]
    assert hwd_row.sum() == 2
    assert gln_row.sum() == 1


def test_empty_input_raises():
    with pytest.raises(ValueError, match="empty"):
        build_single_store_hierarchy(item_to_category={})
