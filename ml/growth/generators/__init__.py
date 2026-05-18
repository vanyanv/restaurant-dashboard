"""Centralized registry of opportunity generators.

The nightly orchestrator iterates this tuple. To temporarily disable a
generator in production, comment it out here — the type stays in the union
so the dashboard page doesn't crash on stored rows of the disabled type.
"""
from ml.growth.generators import (
    reprice, menu_engineering, channel_mix, food_cost_risk, profit_risk,
)

REGISTRY = (
    ("reprice", reprice.generate),
    ("menu_engineering", menu_engineering.generate),
    ("channel_mix", channel_mix.generate),
    ("food_cost_risk", food_cost_risk.generate),
    ("profit_risk", profit_risk.generate),
)
