import { monoLabel, number, fraunces17 } from "./styles"

type Stat = { status: string; count: number }
type Turn = {
  id: string
  occurredAt: Date
  status: string
  finishReason: string | null
  userMessage: string
  assistantMessage: string | null
  errorMessage: string | null
}

const STATUS_ORDER = [
  "OK",
  "TRUNCATED",
  "REFUSED",
  "EMPTY",
  "RATE_LIMITED",
  "TOOL_FAILED",
  "ERROR",
] as const

export function ChatPanel({
  stats,
  recent,
}: {
  stats: Stat[]
  recent: Turn[]
}) {
  const total = stats.reduce((a, b) => a + b.count, 0)
  const failures = stats
    .filter((s) => s.status === "ERROR" || s.status === "TOOL_FAILED")
    .reduce((a, b) => a + b.count, 0)

  return (
    <section className="inv-panel">
      <div
        className="inv-panel__head"
        style={{ display: "flex", alignItems: "baseline", gap: 12 }}
      >
        <span className="inv-panel__dept">CHAT</span>
        <span style={{ ...number }}>{total}</span>
        <span style={{ ...monoLabel, color: "var(--ink-muted)" }}>
          turns / 24h
        </span>
        {failures > 0 && (
          <span style={{ ...monoLabel, color: "var(--accent)" }}>
            · {failures} failures
          </span>
        )}
      </div>

      {total > 0 && (
        <div
          style={{
            display: "flex",
            height: 1,
            marginBottom: 14,
            marginTop: 4,
            background: "var(--hairline)",
          }}
        >
          {STATUS_ORDER.map((status) => {
            const count = stats.find((s) => s.status === status)?.count ?? 0
            if (count === 0) return null
            const isErr = status === "ERROR" || status === "TOOL_FAILED"
            return (
              <div
                key={status}
                title={`${status}: ${count}`}
                style={{
                  flex: count,
                  background: isErr ? "var(--accent)" : "var(--ink)",
                  opacity: isErr ? 1 : status === "OK" ? 0.6 : 0.3,
                }}
              />
            )
          })}
        </div>
      )}

      {recent.length === 0 ? (
        <p style={{ ...monoLabel, color: "var(--ink-faint)" }}>
          no failures in recent turns
        </p>
      ) : (
        <div>
          {recent.map((t) => (
            <div
              key={t.id}
              className="inv-row"
              style={{
                display: "grid",
                gridTemplateColumns: "80px 110px 1fr 1.5fr",
                gap: 16,
                alignItems: "baseline",
              }}
            >
              <span style={{ ...monoLabel, color: "var(--accent)" }}>
                {new Date(t.occurredAt).toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })}
              </span>
              <span style={{ ...monoLabel, color: "var(--accent)" }}>
                {t.status}
              </span>
              <span
                style={{
                  ...fraunces17,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {t.userMessage.slice(0, 80)}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-dm-sans), ui-sans-serif, sans-serif",
                  fontSize: 13,
                  color: "var(--ink-muted)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {t.errorMessage ?? t.assistantMessage?.slice(0, 100) ?? "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
