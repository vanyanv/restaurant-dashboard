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
         "estimatedDollarImpact", confidence, evidence, caveats, "suggestedAction")
    VALUES (%s, %s, %s, %s::"OpportunityType", %s, %s,
            %s::"OpportunityConfidence", %s, %s, %s)
    ON CONFLICT ("storeId", "asOfDate", "opportunityType", title) DO UPDATE SET
        "estimatedDollarImpact" = EXCLUDED."estimatedDollarImpact",
        confidence              = EXCLUDED.confidence,
        evidence                = EXCLUDED.evidence,
        caveats                 = EXCLUDED.caveats,
        "suggestedAction"       = EXCLUDED."suggestedAction"
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
                 o.title, o.estimated_dollar_impact, o.confidence,
                 evidence_json, o.caveats, o.suggested_action),
            )
            written += 1
    return written
