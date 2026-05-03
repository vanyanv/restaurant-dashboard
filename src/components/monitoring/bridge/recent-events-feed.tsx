import type { BridgeEventRow } from "@/lib/monitoring/queries"
import { monoLabel, fraunces17 } from "../styles"
import { SYSTEM_INK } from "../system-color"

const SYSTEM_COLOR_FOR_PILL: Record<BridgeEventRow["system"], string> = {
  db:     SYSTEM_INK.db,
  r2:     SYSTEM_INK.r2,
  cache:  SYSTEM_INK.cache,
  auth:   SYSTEM_INK.auth,
  syncs:  SYSTEM_INK.syncs,
  other:  "var(--ink-muted)",
}

/** Row 4 of the command bridge — chronological merged feed. */
export function RecentEventsFeed({ rows }: { rows: BridgeEventRow[] }) {
  if (rows.length === 0) {
    return (
      <section className="inv-panel" style={{ padding: "16px 18px" }}>
        <div style={{ ...monoLabel, color: "var(--ink-faint)", letterSpacing: "0.22em" }}>
          RECENT · 24H
        </div>
        <div style={{ ...fraunces17, fontStyle: "italic", color: "var(--ink-muted)", marginTop: 12 }}>
          Nothing of note in the last 24 hours.
        </div>
      </section>
    )
  }
  return (
    <section className="inv-panel" style={{ padding: "16px 18px" }}>
      <div
        style={{
          ...monoLabel,
          color: "var(--ink-faint)",
          letterSpacing: "0.22em",
          marginBottom: 8,
        }}
      >
        RECENT · 24H
      </div>
      <ul style={{ display: "flex", flexDirection: "column", margin: 0, padding: 0 }}>
        {rows.map((r) => (
          <li
            key={r.id}
            className="inv-row"
            style={{
              display: "grid",
              gridTemplateColumns: "84px 92px 1fr",
              alignItems: "baseline",
              gap: 12,
              padding: "10px 4px",
              listStyle: "none",
            }}
          >
            <span style={{ ...monoLabel, color: "var(--ink-faint)", letterSpacing: "0.10em" }}>
              {fmtTime(r.occurredAt)}
            </span>
            <span
              style={{
                ...monoLabel,
                color: r.isFailure ? "var(--accent)" : SYSTEM_COLOR_FOR_PILL[r.system],
                letterSpacing: "0.18em",
              }}
            >
              {r.sourceLabel}
            </span>
            <span
              style={{
                ...fraunces17,
                fontSize: 14,
                color: r.isFailure ? "var(--accent-dark)" : "var(--ink)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {r.description}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function fmtTime(d: Date): string {
  const date = d instanceof Date ? d : new Date(d)
  const hh = String(date.getHours()).padStart(2, "0")
  const mm = String(date.getMinutes()).padStart(2, "0")
  return `${hh}:${mm}`
}
