import type { HarriAlertRow } from "@/app/actions/harri-actions"

type Props = {
  alerts: HarriAlertRow[]
  /** Cap rendered count to avoid bloating the page on a long alert log. */
  limit?: number
}

const SEVERE_CODES = new Set([
  "MISSED_CLOCK_OUT_OT_NOW",
  "MISSED_CLOCK_OUT",
  "MISSED_CLOCK_IN",
  "OVERTIME_NOW",
])

const fmtTime = (iso: string) => {
  const d = new Date(iso)
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

const fmtDelta = (sec: number | null) => {
  if (sec == null) return "—"
  const abs = Math.abs(sec)
  if (abs < 60) return `${abs}s`
  if (abs < 3600) return `${Math.round(abs / 60)}m`
  const h = Math.floor(abs / 3600)
  const m = Math.round((abs % 3600) / 60)
  return m === 0 ? `${h}h` : `${h}h${m}m`
}

const formatCode = (code: string) =>
  code.replaceAll("_", " ").toLowerCase()

const fullName = (a: HarriAlertRow) =>
  [a.firstName, a.lastName].filter(Boolean).join(" ") || `User #${a.userId}`

/**
 * Read-only timekeeping alerts inbox. One `.inv-row` per alert.
 * Severe alert codes (missed clock-out, OT-now) get the accent stamp; minor
 * delays stay in `info` tone. Sorted newest first by the action upstream.
 */
export function LaborAlertsList({ alerts, limit = 30 }: Props) {
  if (alerts.length === 0) {
    return (
      <div className="m-empty m-empty--flush">
        No timekeeping alerts in this window.
      </div>
    )
  }

  const top = alerts.slice(0, limit)

  return (
    <div>
      {top.map((alert) => {
        const severe = SEVERE_CODES.has(alert.alertCode)
        const tone = severe ? "alert" : "info"
        return (
          <div
            key={alert.id}
            className="inv-row m-labor-alert"
            style={{
              gridTemplateColumns:
                "[rule] 8px [name] minmax(0, 1fr) [stamp] auto",
              gap: 12,
              padding: "12px 4px",
              alignItems: "flex-start",
            }}
          >
            <div />
            <div style={{ minWidth: 0 }}>
              <div className="inv-row__vendor-name">{fullName(alert)}</div>
              <div
                style={{
                  fontFamily:
                    "var(--font-jetbrains-mono), ui-monospace, monospace",
                  fontSize: 9.5,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--ink-faint)",
                  marginTop: 4,
                  fontVariantNumeric: "tabular-nums lining-nums",
                }}
              >
                {alert.positionName ?? "—"} · {fmtTime(alert.alertTime)}
                {alert.timeDiffSec != null
                  ? ` · ${fmtDelta(alert.timeDiffSec)}`
                  : ""}
              </div>
            </div>
            <div>
              <span className="inv-stamp" data-tone={tone}>
                {formatCode(alert.alertCode)}
              </span>
            </div>
          </div>
        )
      })}
      {alerts.length > limit ? (
        <div
          style={{
            fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace",
            fontSize: 9.5,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--ink-faint)",
            padding: "12px 4px 4px",
          }}
        >
          + {alerts.length - limit} more · open desktop labor for full log
        </div>
      ) : null}
    </div>
  )
}
