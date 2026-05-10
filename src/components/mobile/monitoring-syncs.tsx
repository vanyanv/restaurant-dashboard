import type { SyncRow } from "@/lib/monitoring/queries"

type Props = {
  rows: SyncRow[]
}

const fmtRelative = (d: Date | null): string => {
  if (!d) return "never"
  const diffMs = Date.now() - d.getTime()
  if (diffMs < 60_000) return "just now"
  if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m ago`
  if (diffMs < 86_400_000) return `${Math.round(diffMs / 3_600_000)}h ago`
  return `${Math.round(diffMs / 86_400_000)}d ago`
}

const fmtMs = (n: number | null): string => {
  if (n == null) return "—"
  if (n < 1000) return `${n}ms`
  return `${(n / 1000).toFixed(1)}s`
}

const STATUS_TONE: Record<NonNullable<SyncRow["status"]>, "alert" | "watch" | "info" | "ok"> = {
  RUNNING: "watch",
  SUCCESS: "ok",
  FAILURE: "alert",
  PARTIAL: "watch",
}

/**
 * Cron status table for the bridge. Overdue jobs and FAILURE rows turn the
 * total accent on hover (standard `.inv-row` pattern) and stamp the status.
 * Sorted by overdue first, then most-recent run.
 */
export function MonitoringSyncs({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="m-empty m-empty--flush">
        No cron jobs registered.
      </div>
    )
  }
  const sorted = [...rows].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
    if (a.status !== b.status) {
      if (a.status === "FAILURE") return -1
      if (b.status === "FAILURE") return 1
    }
    const at = a.lastRunAt?.getTime() ?? 0
    const bt = b.lastRunAt?.getTime() ?? 0
    return bt - at
  })

  return (
    <div>
      {sorted.map((row) => {
        const stampTone = row.status ? STATUS_TONE[row.status] : "muted"
        const showOverdue = row.overdue && row.status !== "FAILURE"
        return (
          <div
            key={row.jobName}
            className="inv-row m-mon-sync"
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
              <div className="inv-row__vendor-name">{row.jobName}</div>
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
                {row.cadenceLabel} · last {fmtRelative(row.lastRunAt)}
                {row.durationMs != null
                  ? ` · ${fmtMs(row.durationMs)}`
                  : ""}
                {row.rowsWritten != null
                  ? ` · ${row.rowsWritten.toLocaleString()} rows`
                  : ""}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                alignItems: "flex-end",
              }}
            >
              <span className="inv-stamp" data-tone={stampTone}>
                {row.status ?? "—"}
              </span>
              {showOverdue ? (
                <span className="inv-stamp" data-tone="alert">
                  OVERDUE
                </span>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
