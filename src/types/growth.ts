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
  /** Days `estimatedDollarImpact` covers (1 | 7 | 30, per generator). */
  horizonDays: number
  /**
   * 10th / 25th / 90th percentile of the impact, once the elasticity's standard
   * error is propagated through the generator's own formula. Null when the fit
   * reported no standard error — an invented range would read as precision the
   * estimate does not have. Only the elasticity's uncertainty is propagated, so
   * a range shown here is a floor on the true one.
   */
  impactP10: number | null
  impactP25: number | null
  impactP90: number | null
  confidence: OpportunityConfidence
  evidence: OpportunityEvidence[]
  caveats: string[]
  suggestedAction: string
  createdAt: Date
}

// Deferred for Phase 2 (kept as a code comment so the union stays grep-able):
//   "launch_analogue" | "lost_sales" | "weak_promo"
