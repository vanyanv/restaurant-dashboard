import type { OperatorGateStatus } from "@/lib/monitoring/queries"
import { monoLabel } from "../styles"

function fmtDate(d: Date | null): string {
  if (!d) return "-"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d)
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return "-"
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function statusTone(passed: boolean): string {
  return passed ? "text-[var(--ink-muted)]" : "text-[var(--accent)]"
}

export function OperatorGatePanel({ status }: { status: OperatorGateStatus }) {
  const latestPassed = status.latestRun?.status === "SUCCESS"

  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">Validation discipline gate</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          ml.operator-gate-check
        </span>
      </header>

      <div className="grid gap-3 px-5 pb-5 md:grid-cols-4">
        <Metric
          label="Latest run"
          value={status.latestRun?.status?.toLowerCase() ?? "-"}
          alert={status.latestRun != null && !latestPassed}
        />
        <Metric
          label="Pass streak"
          value={`${Math.min(status.passStreak, status.neededPasses)}/${status.neededPasses}`}
          alert={status.latestRun != null && !latestPassed}
        />
        <Metric label="Last checked" value={fmtDate(status.latestRun?.startedAt ?? null)} />
        <Metric label="Runtime" value={fmtDuration(status.latestRun?.durationMs ?? null)} />
      </div>

      <div className="grid gap-5 px-5 pb-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          <div style={monoLabel} className="mb-2 text-[var(--ink-faint)]">
            Gate signals
          </div>
          <table className="w-full text-[12px]">
            <tbody>
              {status.gates.map((gate) => (
                <tr key={gate.key} className="border-t border-[var(--hairline)]">
                  <td className="py-2 pr-3 text-[var(--ink)]">{gate.label}</td>
                  <td className="py-2 px-3 text-[var(--ink-muted)]">{gate.detail}</td>
                  <td
                    className={`py-2 pl-3 text-right font-mono text-[10px] uppercase tracking-[0.18em] ${statusTone(gate.passed)}`}
                  >
                    {gate.passed ? "pass" : "fail"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-[var(--hairline)] pt-3 lg:border-t-0 lg:border-l lg:pl-5 lg:pt-0">
          <div style={monoLabel} className="mb-2 text-[var(--ink-faint)]">
            Cron
          </div>
          <div className="space-y-3 text-[12px] text-[var(--ink-muted)]">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                Schedule
              </div>
              <div className="mt-1 text-[var(--ink)]">Daily at 14:00 UTC</div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                Command
              </div>
              <code className="mt-1 block break-words font-mono text-[11px] leading-5 text-[var(--ink)]">
                ml/.venv/bin/python -m ml.evaluation.operator_gate_check
              </code>
            </div>
            {status.latestRun?.errorMessage ? (
              <div className="border-t border-[var(--hairline)] pt-3 text-[var(--accent)]">
                {status.latestRun.errorMessage}
              </div>
            ) : null}
          </div>
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
      <div
        className={`mt-1 text-[20px] font-semibold tabular-nums ${
          alert ? "text-[var(--accent)]" : "text-[var(--ink)]"
        }`}
      >
        {value}
      </div>
    </div>
  )
}
