import type { SyncRow } from "@/lib/monitoring/queries"
import { monoLabel, number, fraunces17 } from "./styles"

export function SyncsPanel({ rows }: { rows: SyncRow[] }) {
  if (rows.length === 0) {
    return (
      <section className="inv-panel">
        <div className="inv-panel__head">
          <span className="inv-panel__dept">SYNCS</span>
        </div>
        <p style={{ ...monoLabel, color: "var(--ink-faint)", marginTop: 12 }}>
          no syncs registered
        </p>
      </section>
    )
  }
  return (
    <section className="inv-panel">
      <div className="inv-panel__head">
        <span className="inv-panel__dept">SYNCS</span>
      </div>
      <div>
        {rows.map((r) => {
          const isFail = r.status === "FAILURE"
          const isOverdue = r.overdue
          return (
            <div
              key={r.jobName}
              className="inv-row"
              style={{
                display: "grid",
                gridTemplateColumns: "120px 1fr 100px 80px 80px 120px",
                gap: 16,
                alignItems: "baseline",
              }}
            >
              <span
                style={{
                  ...monoLabel,
                  color: isFail ? "var(--accent)" : "var(--ink-faint)",
                }}
              >
                {r.lastRunAt ? formatAgo(r.lastRunAt) : "NEVER"}
              </span>
              <span style={{ ...fraunces17, color: "var(--ink)" }}>{r.jobName}</span>
              <span
                style={{
                  ...monoLabel,
                  color: isFail ? "var(--accent)" : "var(--ink-muted)",
                }}
              >
                · {(r.status ?? "—").toLowerCase()}
              </span>
              <span style={{ ...number, color: "var(--ink)" }}>
                {r.rowsWritten ?? "—"}
              </span>
              <span style={{ ...number, color: "var(--ink-muted)" }}>
                {r.durationMs != null ? formatDuration(r.durationMs) : "—"}
              </span>
              <span
                style={{
                  ...monoLabel,
                  color: isOverdue ? "var(--accent)" : "var(--ink-muted)",
                }}
              >
                {r.cadenceLabel}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function formatAgo(d: Date | string): string {
  const t = new Date(d).getTime()
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return `${s}S AGO`
  if (s < 3600) return `${Math.round(s / 60)}M AGO`
  if (s < 86400) return `${Math.round(s / 3600)}H AGO`
  return `${Math.round(s / 86400)}D AGO`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}MS`
  return `${(ms / 1000).toFixed(1)}S`
}
