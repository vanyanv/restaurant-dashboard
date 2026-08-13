import { fraunces17, monoLabel, dmBody, number } from "../styles"
import { RegisterMark } from "../register-mark"
import { SYSTEM_INK } from "../system-color"
import type { EngagementSummaryRow } from "@/lib/monitoring/engagement"

export function fmtDuration(ms: number): string {
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  return `${hours}h ${mins % 60}m`
}

export function fmtAgo(d: Date): string {
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function EngagementSummary({ rows }: { rows: EngagementSummaryRow[] }) {
  return (
    <section className="inv-panel" style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <RegisterMark color={SYSTEM_INK.auth} size={8} />
        <span style={{ ...fraunces17, fontStyle: "italic", color: "var(--ink)" }}>
          Engagement
        </span>
        <span
          style={{
            ...monoLabel,
            color: "var(--ink-faint)",
            letterSpacing: "0.16em",
            marginLeft: "auto",
          }}
        >
          last 30 days
        </span>
      </div>

      {rows.length === 0 ? (
        <p
          style={{
            ...fraunces17,
            fontStyle: "italic",
            color: "var(--ink-muted)",
            marginTop: 12,
          }}
        >
          No page views recorded yet. Data begins accumulating once a
          non-developer signs in.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
          {rows.map((r) => (
            <div
              key={r.userId}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr repeat(4, minmax(90px, auto))",
                gap: 16,
                alignItems: "baseline",
                paddingBottom: 12,
                borderBottom: "1px solid var(--hairline)",
              }}
            >
              <div>
                <div style={{ ...dmBody, color: "var(--ink)" }}>{r.name}</div>
                <div style={{ ...monoLabel, color: "var(--ink-faint)", marginTop: 3 }}>
                  {r.lastSeenAt
                    ? `${fmtAgo(r.lastSeenAt)} · ${r.lastPath ?? "—"}`
                    : "never seen"}
                </div>
              </div>
              <Stat label="sessions" value={String(r.sessionCount)} />
              <Stat label="today" value={String(r.sessionsToday)} />
              <Stat label="time" value={fmtDuration(r.totalMs)} />
              <Stat
                label="streak"
                value={`${r.currentStreak}d`}
                accent={r.currentStreak === 0}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ ...number, color: accent ? "var(--accent)" : "var(--ink)" }}>
        {value}
      </div>
      <div style={{ ...monoLabel, color: "var(--ink-faint)", marginTop: 3 }}>
        {label}
      </div>
    </div>
  )
}
