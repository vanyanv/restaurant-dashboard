import { fraunces17, monoLabel, dmBody, number as numberStyle } from "../styles"
import { RegisterMark } from "../register-mark"
import { SYSTEM_INK } from "../system-color"
import type { PresenceUser } from "@/lib/monitoring/login-audit"

export function PresenceList({ users }: { users: PresenceUser[] }) {
  return (
    <section className="inv-panel" style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <RegisterMark color={SYSTEM_INK.auth} size={8} />
        <span style={{ ...fraunces17, fontStyle: "italic", color: "var(--ink)" }}>
          Online now
        </span>
        <span
          style={{
            ...numberStyle,
            fontSize: 18,
            color: "var(--ink)",
            marginLeft: "auto",
          }}
        >
          {users.length}
        </span>
      </div>

      {users.length === 0 ? (
        <p style={{ ...fraunces17, fontStyle: "italic", color: "var(--ink-muted)", marginTop: 12 }}>
          No active sessions in the last 8 hours.
        </p>
      ) : (
        <ul style={{ margin: "12px 0 0 0", padding: 0, listStyle: "none" }}>
          {users.map((u) => (
            <li
              key={u.userId}
              className="inv-row"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 200px 120px",
                alignItems: "baseline",
                gap: 12,
                padding: "8px 4px",
              }}
            >
              <span style={{ ...dmBody, color: "var(--ink)" }}>
                {u.name} <span style={{ color: "var(--ink-muted)" }}>· {u.email}</span>
              </span>
              <span style={{ ...monoLabel, color: "var(--ink-muted)" }}>
                {u.ipAddress ?? "unknown ip"}
              </span>
              <span style={{ ...monoLabel, color: "var(--ink-faint)" }}>
                {fmtRelative(u.lastSignInAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function fmtRelative(d: Date): string {
  const ms = Date.now() - new Date(d).getTime()
  const m = Math.floor(ms / 60_000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
