import type { OpportunityType, OpportunityConfidence } from "@/types/growth"

const JARGON_PATTERNS: RegExp[] = [
  /\bWAPE\b/gi,
  /\bMAPE\b/gi,
  /\bMAE\b/gi,
  /\bbias\b\s*[:=]?\s*-?\d*\.?\d+%?/gi,
  /\bP\d{1,2}(?:[–\-]P?\d{1,2})?\b/g,
  /\bp10\b/gi,
  /\bp50\b/gi,
  /\bp90\b/gi,
  /\bp95\b/gi,
  /\bz[-\s]?score\b/gi,
  /\bz\s*[≥>=]\s*\d+(?:\.\d+)?/gi,
  /\(?Hollywood prior used\)?/gi,
  /\bfitR2\b/gi,
  /\bsampleSize\s*[:=]\s*\d+/gi,
  /\bsigma\b/gi,
  /\bσ\b/g,
  /\bcoverage[_\s]?80\b/gi,
  /\bcoverage[_\s]?95\b/gi,
  /\binterval coverage\b/gi,
  /\bMinTrace\b/g,
  /\bpost[-\s]?median\b/gi,
  /\bpre[-\s]?median\b/gi,
  /\bMlForecastEvaluation\b/g,
  /\bMlReconciliationDaily\b/g,
  /\bforecastSource\b/gi,
  /\bnative model\b/gi,
  /\btransfer source\b/gi,
  /\breconciled\b/gi,
]

const TYPE_LABEL: Record<OpportunityType, string> = {
  reprice: "Pricing",
  menu_engineering: "Menu mix",
  channel_mix: "Delivery channels",
  food_cost_risk: "Food cost",
  profit_risk: "Profit risk",
}

export function translateOpportunityType(t: OpportunityType): string {
  return TYPE_LABEL[t] ?? "Action"
}

export function translateConfidence(c: OpportunityConfidence): 1 | 2 | 3 {
  return c === "high" ? 3 : c === "medium" ? 2 : 1
}

export function stripJargon(input: string): string {
  let out = input
  for (const re of JARGON_PATTERNS) out = out.replace(re, "")
  return out.replace(/\s{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim()
}

export interface WeatherInput {
  maxTempC: number | null
  minTempC: number | null
  totalPrecipMm: number | null
}

export function weatherPhrase(w: WeatherInput | null): string | null {
  if (!w) return null
  const precip = w.totalPrecipMm ?? 0
  const max = w.maxTempC ?? null
  const min = w.minTempC ?? null
  if (precip >= 5) return "heavy rain expected"
  if (precip >= 2) return "rain expected"
  if (max != null && max >= 32) return "hot day"
  if (min != null && min <= 2) return "cold day"
  return "clear"
}

export interface EventInput {
  topEventTitle: string | null
  majorEventCount: number | null
}

export function eventPhrase(e: EventInput | null): string | null {
  if (!e || !e.topEventTitle) return null
  if ((e.majorEventCount ?? 0) <= 0) return null
  return `${e.topEventTitle} nearby`
}
