// WMO weather-code → editorial 2-letter label + severity tone.
//
// The Strip renders weather in DM Sans 13px without icon glyphs to avoid
// monospace fallback width drift. Severity tone drives color:
//   ok     → var(--ink-muted)        (clear / cloudy)
//   muted  → var(--ink-muted)        (fog / drizzle)
//   ink    → var(--ink) semibold     (rain / snow)
//   accent → var(--accent) semibold  (freezing / thunderstorm)
//
// Open-Meteo uses the WMO 4677 code set. Reference:
// https://open-meteo.com/en/docs (search "WMO Weather interpretation codes").

export type WeatherSeverity = "ok" | "muted" | "ink" | "accent"

export interface WeatherLabel {
  code: number
  short: string // 2-letter Strip label
  full: string // full description for tooltips
  severity: WeatherSeverity
}

const TABLE: Record<number, WeatherLabel> = {
  0: { code: 0, short: "Cl", full: "Clear", severity: "ok" },
  1: { code: 1, short: "Mc", full: "Mainly clear", severity: "ok" },
  2: { code: 2, short: "Pc", full: "Partly cloudy", severity: "ok" },
  3: { code: 3, short: "Ov", full: "Overcast", severity: "ok" },
  45: { code: 45, short: "Fg", full: "Fog", severity: "muted" },
  48: { code: 48, short: "Fg", full: "Depositing rime fog", severity: "muted" },
  51: { code: 51, short: "Dz", full: "Light drizzle", severity: "muted" },
  53: { code: 53, short: "Dz", full: "Moderate drizzle", severity: "muted" },
  55: { code: 55, short: "Dz", full: "Dense drizzle", severity: "muted" },
  56: { code: 56, short: "Sl", full: "Freezing drizzle", severity: "accent" },
  57: { code: 57, short: "Sl", full: "Dense freezing drizzle", severity: "accent" },
  61: { code: 61, short: "Rn", full: "Slight rain", severity: "ink" },
  63: { code: 63, short: "Rn", full: "Moderate rain", severity: "ink" },
  65: { code: 65, short: "Rn", full: "Heavy rain", severity: "ink" },
  66: { code: 66, short: "Sl", full: "Freezing rain", severity: "accent" },
  67: { code: 67, short: "Sl", full: "Heavy freezing rain", severity: "accent" },
  71: { code: 71, short: "Sn", full: "Slight snow", severity: "ink" },
  73: { code: 73, short: "Sn", full: "Moderate snow", severity: "ink" },
  75: { code: 75, short: "Sn", full: "Heavy snow", severity: "ink" },
  77: { code: 77, short: "Sn", full: "Snow grains", severity: "ink" },
  80: { code: 80, short: "Rn", full: "Light rain showers", severity: "ink" },
  81: { code: 81, short: "Rn", full: "Moderate rain showers", severity: "ink" },
  82: { code: 82, short: "Rn", full: "Violent rain showers", severity: "ink" },
  85: { code: 85, short: "Sn", full: "Light snow showers", severity: "ink" },
  86: { code: 86, short: "Sn", full: "Heavy snow showers", severity: "ink" },
  95: { code: 95, short: "Tn", full: "Thunderstorm", severity: "accent" },
  96: { code: 96, short: "Tn", full: "Thunderstorm with hail", severity: "accent" },
  99: { code: 99, short: "Tn", full: "Thunderstorm with heavy hail", severity: "accent" },
}

const UNKNOWN: WeatherLabel = {
  code: -1,
  short: "—",
  full: "Unknown",
  severity: "muted",
}

export function weatherLabel(code: number | null | undefined): WeatherLabel {
  if (code == null) return UNKNOWN
  return TABLE[code] ?? UNKNOWN
}

// Severity rank for "max severity wins" portfolio aggregation.
const SEVERITY_RANK: Record<WeatherSeverity, number> = {
  ok: 0,
  muted: 1,
  ink: 2,
  accent: 3,
}

export function maxSeverityCode(codes: Array<number | null | undefined>): number | null {
  let bestCode: number | null = null
  let bestRank = -1
  for (const c of codes) {
    if (c == null) continue
    const lbl = weatherLabel(c)
    const rank = SEVERITY_RANK[lbl.severity]
    if (rank > bestRank) {
      bestRank = rank
      bestCode = c
    }
  }
  return bestCode
}
