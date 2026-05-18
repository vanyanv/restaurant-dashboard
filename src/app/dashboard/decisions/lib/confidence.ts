import type { RevenueForecastData } from "@/app/actions/forecasts/revenue-forecast-actions"

export type DotCount = 1 | 2 | 3

export function confidenceFromForecast(
  data: Pick<RevenueForecastData, "recentMape"> | null,
  forecastSource: "native" | "transfer" | null,
): DotCount {
  if (!data || data.recentMape == null) return 1
  if (forecastSource === "transfer") return 1
  if (data.recentMape < 0.12 && forecastSource === "native") return 3
  if (data.recentMape < 0.2) return 2
  return 1
}
