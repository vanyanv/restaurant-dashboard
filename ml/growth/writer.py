"""Upsert GrowthOpportunity rows keyed on
(storeId, asOfDate, opportunityType, title) so nightly re-runs are idempotent."""
from __future__ import annotations

from dataclasses import asdict

from psycopg2.extras import Json

from ml.db import cuid_like
from ml.growth.types import GrowthOpportunity


_UPSERT_SQL = '''
    INSERT INTO "GrowthOpportunity"
        (id, "storeId", "asOfDate", "opportunityType", title,
         "estimatedDollarImpact", "horizonDays", confidence, evidence, caveats,
         "suggestedAction", "impactP10", "impactP25", "impactP90")
    VALUES (%s, %s, %s, %s::"OpportunityType", %s, %s, %s,
            %s::"OpportunityConfidence", %s, %s, %s, %s, %s, %s)
    ON CONFLICT ("storeId", "asOfDate", "opportunityType", title) DO UPDATE SET
        "estimatedDollarImpact" = EXCLUDED."estimatedDollarImpact",
        "horizonDays"           = EXCLUDED."horizonDays",
        confidence              = EXCLUDED.confidence,
        evidence                = EXCLUDED.evidence,
        caveats                 = EXCLUDED.caveats,
        "suggestedAction"       = EXCLUDED."suggestedAction",
        "impactP10"             = EXCLUDED."impactP10",
        "impactP25"             = EXCLUDED."impactP25",
        "impactP90"             = EXCLUDED."impactP90"
'''


def write_opportunities(conn, ops: list[GrowthOpportunity]) -> int:
    if not ops:
        return 0
    written = 0
    with conn.cursor() as cur:
        for o in ops:
            evidence_json = Json([asdict(e) for e in o.evidence])
            cur.execute(
                _UPSERT_SQL,
                (cuid_like(), o.store_id, o.as_of_date, o.opportunity_type,
                 o.title, o.estimated_dollar_impact, o.horizon_days, o.confidence,
                 evidence_json, o.caveats, o.suggested_action,
                 o.impact_p10, o.impact_p25, o.impact_p90),
            )
            written += 1
    return written
