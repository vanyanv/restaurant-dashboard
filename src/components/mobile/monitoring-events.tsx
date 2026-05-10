import type { BridgeEventRow } from "@/lib/monitoring/queries"

type Props = {
  events: BridgeEventRow[]
}

const fmtTime = (d: Date) => {
  const diffMs = Date.now() - d.getTime()
  if (diffMs < 60_000) return "just now"
  if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m`
  return d.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })
}

const KIND_LABEL: Record<BridgeEventRow["kind"], string> = {
  sync: "SYNC",
  error: "ERROR",
  login: "LOGIN",
}

/**
 * Recent merged event feed (syncs + errors + logins). Failure rows stamp
 * `alert`; everything else stays `info`. Each row uses the `.inv-row` pattern
 * so the red bar + total color shift apply on hover.
 */
export function MonitoringEvents({ events }: Props) {
  if (events.length === 0) {
    return (
      <div className="m-empty m-empty--flush">
        No bridge events in the last 24h.
      </div>
    )
  }
  return (
    <div>
      {events.map((event) => {
        const tone = event.isFailure ? "alert" : "info"
        return (
          <div
            key={event.id}
            className="inv-row m-mon-event"
            style={{
              gridTemplateColumns:
                "[rule] 8px [body] minmax(0, 1fr) [time] auto",
              gap: 12,
              padding: "12px 4px",
              alignItems: "flex-start",
            }}
          >
            <div />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 4,
                  flexWrap: "wrap",
                }}
              >
                <span className="inv-stamp" data-tone={tone}>
                  {KIND_LABEL[event.kind]}
                </span>
                <span
                  style={{
                    fontFamily:
                      "var(--font-jetbrains-mono), ui-monospace, monospace",
                    fontSize: 9.5,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "var(--ink-faint)",
                  }}
                >
                  {event.system}
                </span>
              </div>
              <div
                style={{
                  fontFamily: "var(--font-dm-sans), ui-sans-serif, sans-serif",
                  fontSize: 13,
                  color: event.isFailure ? "var(--accent-dark)" : "var(--ink)",
                  lineHeight: 1.4,
                }}
              >
                {event.description}
              </div>
            </div>
            <div
              style={{
                fontFamily:
                  "var(--font-jetbrains-mono), ui-monospace, monospace",
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--ink-faint)",
                fontVariantNumeric: "tabular-nums lining-nums",
                whiteSpace: "nowrap",
              }}
            >
              {fmtTime(event.occurredAt)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
