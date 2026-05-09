export type ForecastSection =
  | "revenue"
  | "menu"
  | "costs"
  | "operations"
  | "anomalies"

export const FORECAST_SECTIONS: { id: ForecastSection; label: string }[] = [
  { id: "revenue", label: "Revenue" },
  { id: "menu", label: "Menu" },
  { id: "costs", label: "Costs" },
  { id: "operations", label: "Operations" },
  { id: "anomalies", label: "Anomalies" },
]

export const DEFAULT_SECTION: ForecastSection = "revenue"

export function parseSection(raw: string | undefined): ForecastSection {
  switch (raw) {
    case "menu":
    case "costs":
    case "operations":
    case "anomalies":
    case "revenue":
      return raw
    default:
      return DEFAULT_SECTION
  }
}
