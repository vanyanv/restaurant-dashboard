import { fraunces17, monoLabel, dmBody } from "../styles"
import { RegisterMark } from "../register-mark"
import { SYSTEM_INK } from "../system-color"
import type { LoginKind } from "@/generated/prisma/client"

export type LoginHistoryRow = {
  id: string
  userId: string | null
  emailTried: string
  kind: LoginKind
  ipAddress: string | null
  userAgent: string | null
  createdAt: Date
}

export function LoginHistoryTable({ rows }: { rows: LoginHistoryRow[] }) {
  return (
    <section className="inv-panel" style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <RegisterMark color={SYSTEM_INK.auth} size={8} />
        <span style={{ ...fraunces17, fontStyle: "italic", color: "var(--ink)" }}>
          Login history
        </span>
        <span
          style={{
            ...monoLabel,
            color: "var(--ink-faint)",
            letterSpacing: "0.16em",
            marginLeft: "auto",
          }}
        >
          {rows.length} events
        </span>
      </div>

      {rows.length === 0 ? (
        <p style={{ ...fraunces17, fontStyle: "italic", color: "var(--ink-muted)", marginTop: 12 }}>
          No login events recorded yet.
        </p>
      ) : (
        <ul style={{ margin: "12px 0 0 0", padding: 0, listStyle: "none" }}>
          {rows.map((r) => (
            <li
              key={r.id}
              className="inv-row"
              style={{
                display: "grid",
                gridTemplateColumns: "120px 90px 1fr 140px",
                alignItems: "baseline",
                gap: 12,
                padding: "8px 4px",
              }}
            >
              <span style={{ ...monoLabel, color: "var(--ink-faint)" }}>
                {fmtTime(r.createdAt)}
              </span>
              <span
                style={{
                  ...monoLabel,
                  color:
                    r.kind === "SIGN_IN_FAILED"
                      ? "var(--accent)"
                      : r.kind === "SIGN_OUT"
                      ? "var(--ink-muted)"
                      : "var(--ink-ledger)",
                  letterSpacing: "0.18em",
                }}
              >
                {r.kind.replace("SIGN_", "")}
              </span>
              <span style={{ ...dmBody, color: "var(--ink)" }}>{r.emailTried}</span>
              <span style={{ ...monoLabel, color: "var(--ink-muted)" }}>
                {r.ipAddress ?? "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function fmtTime(d: Date): string {
  const date = d instanceof Date ? d : new Date(d)
  const month = date.toLocaleString(undefined, { month: "short" })
  const day = String(date.getDate()).padStart(2, "0")
  const hh = String(date.getHours()).padStart(2, "0")
  const mm = String(date.getMinutes()).padStart(2, "0")
  return `${month} ${day} · ${hh}:${mm}`
}
