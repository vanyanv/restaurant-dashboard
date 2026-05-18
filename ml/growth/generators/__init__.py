"""Centralized registry of opportunity generators.

The nightly orchestrator iterates this tuple. To temporarily disable a
generator in production, comment it out here — the type stays in the union
so the dashboard page doesn't crash on stored rows of the disabled type.
"""
from ml.growth.generators import reprice, menu_engineering

REGISTRY = (
    ("reprice", reprice.generate),
    ("menu_engineering", menu_engineering.generate),
    # ("channel_mix", channel_mix.generate),             # Task 7
    # ("food_cost_risk", food_cost_risk.generate),       # Task 7
    # ("profit_risk", profit_risk.generate),             # Task 7
)
