"use server"

import { ymdUTC as ymd } from "@/lib/date-utils"
import {
  getFoodCostForecast,
  type FoodCostForecastDay,
} from "./food-cost-forecast-actions"
import {
  getLaborStaffingForecast,
  type ExternalDemandDriver,
} from "./labor-staffing-actions"

export type ProfitRiskLevel = "low" | "medium" | "high"

export interface ProfitRiskDay {
  date: Date
  predictedRevenue: number | null
  predictedOrders: number
  predictedFoodCost: number
  scheduledLaborCost: number | null
  contributionProfit: number | null
  foodCostPct: number | null
  laborCostPct: number | null
  riskLevel: ProfitRiskLevel
  drivers: ExternalDemandDriver[]
  actions: string[]
}

export interface ProfitRiskData {
  storeId: string | null
  storeName: string
  days: ProfitRiskDay[]
}

export type GetProfitRiskResult =
  | { ok: true; data: ProfitRiskData }
  | { ok: false; error: "store_not_in_account" | "insufficient_history" }

export async function getProfitRiskForecast(input: {
  storeId?: string
  horizonDays?: number
  asOf?: Date
}): Promise<GetProfitRiskResult | null> {
  const [foodCostResult, laborResult] = await Promise.all([
    getFoodCostForecast(input),
    getLaborStaffingForecast(input),
  ])

  if (foodCostResult && !foodCostResult.ok) return foodCostResult
  if (laborResult && !laborResult.ok) return laborResult
  if (!foodCostResult || !laborResult) return null

  const foodByDate = new Map<string, FoodCostForecastDay>()
  for (const day of foodCostResult.data.days) {
    foodByDate.set(ymd(day.date), day)
  }

  const days: ProfitRiskDay[] = laborResult.data.days.map((laborDay) => {
    const key = ymd(laborDay.date)
    const food = foodByDate.get(key)
    const revenue = laborDay.predictedRevenue ?? food?.predictedRevenue ?? null
    const foodCost = food?.predictedFoodCost ?? 0
    const scheduledLabor = laborDay.scheduledLaborCost
    const contributionProfit =
      revenue == null || scheduledLabor == null
        ? null
        : revenue - foodCost - scheduledLabor
    const laborCostPct =
      revenue != null && revenue > 0 && scheduledLabor != null
        ? scheduledLabor / revenue
        : null
    const riskLevel = classifyProfitRisk({
      revenue,
      contributionProfit,
      foodCostPct: food?.foodCostPct ?? null,
      laborCostPct,
      drivers: laborDay.drivers,
      staffingRisk: laborDay.staffingRisk,
    })
    return {
      date: laborDay.date,
      predictedRevenue: revenue,
      predictedOrders: laborDay.predictedOrders,
      predictedFoodCost: foodCost,
      scheduledLaborCost: scheduledLabor,
      contributionProfit,
      foodCostPct: food?.foodCostPct ?? null,
      laborCostPct,
      riskLevel,
      drivers: laborDay.drivers,
      actions: buildOperatorActions(riskLevel, laborDay.drivers, laborDay.staffingRisk),
    }
  })

  return {
    ok: true,
    data: {
      storeId: laborResult.data.storeId,
      storeName: laborResult.data.storeName,
      days,
    },
  }
}

function classifyProfitRisk(input: {
  revenue: number | null
  contributionProfit: number | null
  foodCostPct: number | null
  laborCostPct: number | null
  drivers: ExternalDemandDriver[]
  staffingRisk: string | null
}): ProfitRiskLevel {
  const pressure = input.drivers.some((d) => d.severity === "high")
  if (input.revenue == null || input.revenue <= 0) return "medium"
  if (input.contributionProfit != null && input.contributionProfit < input.revenue * 0.08) {
    return "high"
  }
  if ((input.foodCostPct ?? 0) >= 0.34 || (input.laborCostPct ?? 0) >= 0.28) {
    return pressure || input.staffingRisk === "understaffed" ? "high" : "medium"
  }
  if (pressure || input.staffingRisk === "understaffed") return "medium"
  return "low"
}

function buildOperatorActions(
  risk: ProfitRiskLevel,
  drivers: ExternalDemandDriver[],
  staffingRisk: string | null,
): string[] {
  const actions = new Set<string>()
  if (staffingRisk === "understaffed" || staffingRisk === "missing_schedule") {
    actions.add("Add line coverage before the peak window")
  }
  if (drivers.some((d) => d.kind === "event")) {
    actions.add("Prep patties, buns, fries, cheese, bacon, and sauce")
    actions.add("Protect high-margin combos during event demand")
  }
  if (drivers.some((d) => d.label.includes("rain") || d.label.includes("storm"))) {
    actions.add("Stage delivery packaging and watch fries hold time")
  }
  if (risk === "high" && actions.size === 0) {
    actions.add("Review labor and food-cost exposure before service")
  }
  if (actions.size === 0) actions.add("Operate to the standard prep plan")
  return [...actions].slice(0, 4)
}

