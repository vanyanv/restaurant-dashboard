import type { TokenHealth } from "@/lib/monitoring/jwt-health"
import { monoLabel, number, fraunces17 } from "./styles"

const PROVIDER_LABEL: Record<TokenHealth["provider"], string> = {
  otter: "Otter JWT",
  harri: "Harri Cognito refresh",
}

const PROVIDER_NOTE: Record<TokenHealth["provider"], string> = {
  otter: "auto-rotates daily 00:00 UTC",
  harri: "manual rotation — see runbook",
}

function fmtAbs(d: Date | null): string {
  if (!d) return "—"
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  })
}

function fmtRelative(d: Date | null): string {
  if (!d) return "never"
  const s = Math.round((Date.now() - d.getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

function statusFor(row: TokenHealth): { tone: "ok" | "warn" | "danger"; text: string } {
  if (!row.hasToken) return { tone: "danger", text: "missing" }
  if (row.daysLeft === null) return { tone: "warn", text: "undecodable" }
  if (row.daysLeft < 0) return { tone: "danger", text: "expired" }
  if (row.daysLeft <= 3) return { tone: "danger", text: `${row.daysLeft}d left` }
  if (row.daysLeft <= 14) return { tone: "warn", text: `${row.daysLeft}d left` }
  return { tone: "ok", text: `${row.daysLeft}d left` }
}

const TONE_COLOR: Record<"ok" | "warn" | "danger", string> = {
  ok: "var(--ink-ledger)",
  warn: "var(--ink-ochre)",
  danger: "var(--accent)",
}

export function TokensPanel({ rows }: { rows: TokenHealth[] }) {
  return (
    <section id="tokens" className="inv-panel">
      <div
        className="inv-panel__head"
        style={{ display: "flex", alignItems: "baseline", gap: 12 }}
      >
        <span className="inv-panel__dept">§ Tokens</span>
        <span style={{ ...fraunces17, color: "var(--ink)" }}>JWT health</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map((r) => {
          const status = statusFor(r)
          return (
            <div
              key={r.provider}
              className="inv-row"
              style={{
                display: "grid",
                gridTemplateColumns: "180px 1fr 110px 140px 200px",
                gap: 16,
                alignItems: "baseline",
              }}
            >
              <span style={{ ...fraunces17, color: "var(--ink)" }}>
                {PROVIDER_LABEL[r.provider]}
              </span>
              <span
                style={{
                  ...monoLabel,
                  color: "var(--ink-faint)",
                  letterSpacing: "0.12em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {r.envVar} · {PROVIDER_NOTE[r.provider]}
              </span>
              <span
                style={{
                  ...monoLabel,
                  color: TONE_COLOR[status.tone],
                  letterSpacing: "0.14em",
                }}
              >
                {status.text}
              </span>
              <span style={{ ...number, color: "var(--ink-muted)" }}>
                {r.expiresAt ? fmtAbs(r.expiresAt) : "—"}
              </span>
              <span style={{ ...monoLabel, color: "var(--ink-faint)" }}>
                last sync · {fmtRelative(r.lastSuccessAt)}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
