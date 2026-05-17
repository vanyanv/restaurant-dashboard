"""Store-lifecycle helpers.

Stages: pre_open -> warming_up -> ready (one-way transitions).

The pre_open -> warming_up flip is an ops action (operator clicks a button
when the store physically opens), not driven by code in this module.

The warming_up -> ready flip is automatic - `should_promote_to_ready` decides
on each nightly run whether the native model has earned promotion.
"""
from __future__ import annotations

from typing import Optional


# Spec §1.4: native must beat transfer-forecast WAPE by >=5% relative.
READY_PROMOTION_IMPROVEMENT_THRESHOLD = 0.05

# Spec §1.4: also require sampleSize >= 60 (matches existing _MIN_DAILY_HISTORY
# discipline for trustworthy WAPE).
READY_PROMOTION_MIN_SAMPLE = 60


def should_promote_to_ready(
    *,
    native_wape: float,
    transfer_wape: Optional[float],
    sample_size: int,
) -> bool:
    """Return True iff the native model has earned promotion to `ready`.

    Two gates, both must pass:
      1. `(transfer_wape - native_wape) / transfer_wape >= 0.05` (5% relative).
      2. `sample_size >= 60` so the WAPE itself is trustworthy.
    """
    if transfer_wape is None or transfer_wape <= 0:
        return False
    if sample_size < READY_PROMOTION_MIN_SAMPLE:
        return False
    rel_improvement = (transfer_wape - native_wape) / transfer_wape
    return rel_improvement >= READY_PROMOTION_IMPROVEMENT_THRESHOLD


def flip_to_ready(conn, *, store_id: str) -> None:
    """Atomic flip of one store from warming_up to ready.

    Idempotent - if the store is already ready, the UPDATE is a no-op.
    """
    with conn.cursor() as cur:
        cur.execute(
            '''
            UPDATE "Store"
            SET "lifecycleStage" = 'ready'::"LifecycleStage"
            WHERE id = %s AND "lifecycleStage" = 'warming_up'::"LifecycleStage"
            ''',
            (store_id,),
        )
