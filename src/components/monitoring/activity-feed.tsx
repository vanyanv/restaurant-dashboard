import type { ActivityRow } from "@/lib/monitoring/queries"
import { dmBody, fraunces17, monoLabel } from "./styles"

export function ActivityFeed({ rows }: { rows: ActivityRow[] }) {
  if (rows.length === 0) {
    return (
      <section className="inv-panel">
        <div className="inv-panel__head">
          <span className="inv-panel__dept">RECENT ACTIVITY</span>
        </div>
        <p
          style={{
            ...monoLabel,
            color: "var(--ink-faint)",
            marginTop: 8,
          }}
        >
          nothing has happened yet
        </p>
      </section>
    )
  }

  return (
    <section className="inv-panel">
      <div className="inv-panel__head">
        <span className="inv-panel__dept">RECENT ACTIVITY</span>
        <span style={{ ...monoLabel, color: "var(--ink-faint)" }}>
          last {rows.length}
        </span>
      </div>
      <div>
        {rows.map((r) => (
          <div
            key={r.id}
            className="inv-row"
            style={{
              display: "grid",
              gridTemplateColumns: "60px 80px minmax(160px, 1fr) 2fr",
              gap: 16,
              alignItems: "baseline",
              padding: "8px 4px",
            }}
          >
            <span
              style={{
                ...monoLabel,
                color: r.isFailure ? "var(--accent)" : "var(--ink-faint)",
                fontVariantNumeric: "tabular-nums lining-nums",
              }}
            >
              {formatTime(r.occurredAt)}
            </span>
            <span style={{ ...monoLabel, color: "var(--ink-muted)" }}>
              {r.kind}
            </span>
            <span
              style={{
                ...fraunces17,
                fontSize: 15,
                color: r.isFailure ? "var(--accent)" : "var(--ink)",
              }}
            >
              {r.label}
            </span>
            <span
              style={{
                ...dmBody,
                color: "var(--ink-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={r.detail ?? undefined}
            >
              {r.detail ?? "—"}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function formatTime(d: Date | string): string {
  const x = new Date(d)
  const hh = String(x.getHours()).padStart(2, "0")
  const mm = String(x.getMinutes()).padStart(2, "0")
  return `${hh}:${mm}`
}
