/**
 * GrowthOpportunity shape — mirrors ml/growth/types.py.
 *
 * The 5-value union is intentionally narrow for Phase 1. Phase 2 will
 * extend additively with launch_analogue, lost_sales, weak_promo (see
 * spec §3.1).
 */
export type OpportunityType =
  | "reprice"
  | "menu_engineering"
  | "channel_mix"
  | "food_cost_risk"
  | "profit_risk"

export type OpportunityConfidence = "low" | "medium" | "high"

export interface OpportunityEvidence {
  kind: string
  ref: string
  value: number | string
}

export interface GrowthOpportunity {
  id: string
  storeId: string
  asOfDate: Date
  opportunityType: OpportunityType
  title: string
  estimatedDollarImpact: number
  confidence: OpportunityConfidence
  evidence: OpportunityEvidence[]
  caveats: string[]
  suggestedAction: string
  createdAt: Date
}

// Deferred for Phase 2 (kept as a code comment so the union stays grep-able):
//   "launch_analogue" | "lost_sales" | "weak_promo"
