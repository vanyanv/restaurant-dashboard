import type { ExternalSignalStatus } from "@/lib/monitoring/queries"
import { monoLabel } from "../styles"

function fmtDate(d: Date | null): string {
  if (!d) return "—"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d)
}

function fmtDay(d: Date | null): string {
  if (!d) return "—"
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d)
}

function flavor(modelVersion: string | null): string {
  if (!modelVersion) return "—"
  if (modelVersion.includes("weather-events")) return "weather + events"
  if (modelVersion.includes("baseline")) return "baseline"
  return modelVersion
}

export function ExternalSignalsPanel({ status }: { status: ExternalSignalStatus }) {
  const coveragePct =
    status.coverage.activeStores > 0
      ? status.coverage.geocodedStores / status.coverage.activeStores
      : 0
  const staleWeather = status.freshness.filter((r) => r.staleWeather).length
  const staleEvents = status.freshness.filter((r) => r.staleEvents).length

  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">External forecast signals</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          Open-Meteo · PredictHQ
        </span>
      </header>

      <div className="grid gap-3 px-5 pb-5 md:grid-cols-4">
        <Metric label="Geocoded" value={`${(coveragePct * 100).toFixed(0)}%`} alert={status.coverage.missingCoordinates > 0} />
        <Metric label="Missing coords" value={String(status.coverage.missingCoordinates)} alert={status.coverage.missingCoordinates > 0} />
        <Metric label="Stale weather" value={String(staleWeather)} alert={staleWeather > 0} />
        <Metric label="Stale PredictHQ" value={String(staleEvents)} alert={staleEvents > 0} />
      </div>

      <div className="grid gap-5 px-5 pb-5 lg:grid-cols-2">
        <div>
          <div style={monoLabel} className="mb-2 text-[var(--ink-faint)]">
            Backfill range by store
          </div>
          <table className="w-full text-[12px]">
            <tbody>
              {status.freshness.map((row) => (
                <tr key={row.storeId} className="border-t border-[var(--hairline)]">
                  <td className="py-2 pr-3 text-[var(--ink)]">{row.storeName}</td>
                  <td className="py-2 px-3 text-right text-[var(--ink-muted)] tabular-nums">
                    {fmtDay(row.earliestWeatherDate)}-{fmtDay(row.latestWeatherDate)}
                  </td>
                  <td className="py-2 px-3 text-right text-[var(--ink-muted)] tabular-nums">
                    {fmtDay(row.earliestEventDate)}-{fmtDay(row.latestEventDate)}
                  </td>
                  <td className="py-2 pl-3 text-right text-[var(--ink-muted)] tabular-nums">
                    {row.weatherRows}/{row.eventRows}/{row.rawEventRows}
                  </td>
                  <td className="py-2 pl-3 text-right text-[var(--ink-muted)] tabular-nums">
                    {row.radiusMiles == null ? "—" : `${row.radiusMiles.toFixed(1)} mi`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <div style={monoLabel} className="mb-2 text-[var(--ink-faint)]">
            Promoted model flavor
          </div>
          <table className="w-full text-[12px]">
            <tbody>
              {status.promotedModels.map((row) => (
                <tr key={row.target} className="border-t border-[var(--hairline)]">
                  <td className="py-2 pr-3 text-[var(--ink)]">{row.target}</td>
                  <td className="py-2 px-3 text-right text-[var(--ink-muted)]">{flavor(row.modelVersion)}</td>
                  <td className="py-2 px-3 text-right text-[var(--ink-muted)] tabular-nums">
                    {row.mape == null ? "—" : `${(row.mape * 100).toFixed(1)}%`}
                  </td>
                  <td className="py-2 pl-3 text-right text-[var(--ink-muted)]">{fmtDate(row.startedAt)}</td>
                </tr>
              ))}
              {status.promotedModels.length === 0 ? (
                <tr className="border-t border-[var(--hairline)]">
                  <td className="py-2 text-[var(--ink-muted)]" colSpan={4}>
                    No successful enriched training runs yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function Metric({
  label,
  value,
  alert = false,
}: {
  label: string
  value: string
  alert?: boolean
}) {
  return (
    <div className="border border-[var(--hairline)] px-3 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
        {label}
      </div>
      <div className={`mt-1 text-[22px] font-semibold tabular-nums ${alert ? "text-[var(--accent)]" : "text-[var(--ink)]"}`}>
        {value}
      </div>
    </div>
  )
}
