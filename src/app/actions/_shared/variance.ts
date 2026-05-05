// Per-ingredient variance calculation: classifies a purchased-vs-theoretical
// pair and splits the cost impact into waste (over-ordered) vs shortage
// (under-ordered) so neither direction is silently dropped.
//
// Thresholds and tie-breakers (strict > / <, not >=) match the inline logic
// previously in getProductUsageData — the dashboard relies on these exact
// classifications for status badges and KPI rollups.

export type VarianceStatus =
  | "no_recipe"
  | "over_ordered"
  | "under_ordered"
  | "balanced"

export interface VarianceInput {
  purchasedQty: number
  theoretical: number
  avgUnitCost: number
}

export interface VarianceResult {
  varianceQuantity: number
  variancePct: number
  wasteEstimatedCost: number
  shortageEstimatedCost: number
  status: VarianceStatus
}

export function computeVariance({
  purchasedQty,
  theoretical,
  avgUnitCost,
}: VarianceInput): VarianceResult {
  const varianceQuantity = purchasedQty - theoretical
  const variancePct =
    theoretical > 0 ? ((purchasedQty - theoretical) / theoretical) * 100 : 0

  const wasteEstimatedCost =
    varianceQuantity > 0 ? varianceQuantity * avgUnitCost : 0
  const shortageEstimatedCost =
    varianceQuantity < 0 ? Math.abs(varianceQuantity) * avgUnitCost : 0

  let status: VarianceStatus
  if (theoretical === 0) {
    status = "no_recipe"
  } else if (variancePct > 10) {
    status = "over_ordered"
  } else if (variancePct < -10) {
    status = "under_ordered"
  } else {
    status = "balanced"
  }

  return {
    varianceQuantity,
    variancePct,
    wasteEstimatedCost,
    shortageEstimatedCost,
    status,
  }
}
