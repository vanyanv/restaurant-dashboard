import type { BusyHoursModelStatus } from "@/lib/monitoring/queries"
import { monoLabel } from "../styles"

function fmtPct(n: number | null): string {
  if (n == null) return "—"
  return `${(n * 100).toFixed(1)}%`
}

function fmtNum(n: number | null): string {
  if (n == null) return "—"
  return n.toFixed(2)
}

function fmtDate(d: Date | null): string {
  if (!d) return "—"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d)
}

function modelFlavor(version: string | null | undefined): string {
  if (!version) return "—"
  if (version.includes("weather-events")) return "weather + events"
  if (version.includes("baseline")) return "baseline"
  return version
}

export function BusyHoursPanel({ status }: { status: BusyHoursModelStatus }) {
  const failedRuns = status.runs.filter((r) => r.status === "FAILED")
  const staleCount = status.staleForecasts.filter((r) => r.stale).length
  const weakCoverage = status.harriCoverage.filter((r) => r.insufficient).length
  const latestRun = [...status.runs].sort(
    (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
  )[0]

  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">Busy-hours ML</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          latest {fmtDate(latestRun?.startedAt ?? null)}
        </span>
      </header>

      <div className="grid gap-3 px-5 pb-5 md:grid-cols-4">
        <Metric label="Latest MAPE" value={fmtPct(latestRun?.mape ?? null)} />
        <Metric label="Latest MAE" value={fmtNum(latestRun?.mae ?? null)} />
        <Metric label="Flavor" value={modelFlavor(latestRun?.modelVersion)} />
        <Metric label="Stale stores" value={String(staleCount)} alert={staleCount > 0} />
      </div>

      <div className="grid gap-5 px-5 pb-5 lg:grid-cols-2">
        <div>
          <div style={monoLabel} className="mb-2 text-[var(--ink-faint)]">
            Store forecast freshness
          </div>
          <table className="w-full text-[12px]">
            <tbody>
              {status.staleForecasts.map((row) => (
                <tr key={row.storeId} className="border-t border-[var(--hairline)]">
                  <td className="py-2 pr-3 text-[var(--ink)]">{row.storeName}</td>
                  <td className="py-2 px-3 text-right text-[var(--ink-muted)] tabular-nums">
                    {row.forecastRows} rows
                  </td>
                  <td className="py-2 px-3 text-right text-[var(--ink-muted)]">
                    {fmtDate(row.latestGeneratedAt)}
                  </td>
                  <td
                    className={`py-2 pl-3 text-right font-mono text-[10px] uppercase tracking-[0.18em] ${
                      row.stale ? "text-[var(--accent)]" : "text-[var(--ink-muted)]"
                    }`}
                  >
                    {row.stale ? "stale" : "ready"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <div style={monoLabel} className="mb-2 text-[var(--ink-faint)]">
            Harri coverage, trailing 90d
          </div>
          <table className="w-full text-[12px]">
            <tbody>
              {status.harriCoverage.map((row) => (
                <tr key={row.storeId} className="border-t border-[var(--hairline)]">
                  <td className="py-2 pr-3 text-[var(--ink)]">{row.storeName}</td>
                  <td className="py-2 px-3 text-right text-[var(--ink-muted)] tabular-nums">
                    {row.daysWithLabor} days
                  </td>
                  <td className="py-2 px-3 text-right text-[var(--ink-muted)] tabular-nums">
                    {fmtPct(row.coveragePct)}
                  </td>
                  <td
                    className={`py-2 pl-3 text-right font-mono text-[10px] uppercase tracking-[0.18em] ${
                      row.insufficient ? "text-[var(--accent)]" : "text-[var(--ink-muted)]"
                    }`}
                  >
                    {row.insufficient ? "thin" : "covered"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {failedRuns.length > 0 ? (
        <div className="border-t border-[var(--hairline)] px-5 py-4">
          <div style={monoLabel} className="mb-2 text-[var(--ink-faint)]">
            Failed stores
          </div>
          <div className="space-y-2">
            {failedRuns.map((run) => (
              <div key={run.storeId} className="text-[12px] text-[var(--accent)]">
                {run.storeId}: {run.errorMessage ?? "failed"}
              </div>
            ))}
          </div>
        </div>
      ) : null}
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
      <div
        className={`mt-1 text-[22px] font-semibold tabular-nums ${
          alert ? "text-[var(--accent)]" : "text-[var(--ink)]"
        }`}
      >
        {value}
      </div>
    </div>
  )
}
