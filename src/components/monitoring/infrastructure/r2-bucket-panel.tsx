import { fraunces17, monoLabel, number as numberStyle, dmBody } from "../styles"
import { RegisterMark } from "../register-mark"
import { SYSTEM_INK } from "../system-color"

type Snapshot = {
  capturedAt: Date
  totalBytes: number | bigint
  objectCount: number
  byPrefix: unknown // Json
} | null

export function R2BucketPanel({ snapshot }: { snapshot: Snapshot }) {
  return (
    <section className="inv-panel" id="r2" style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <RegisterMark color={SYSTEM_INK.r2} size={8} />
        <span style={{ ...fraunces17, fontStyle: "italic", color: "var(--ink)" }}>
          R2 bucket
        </span>
        {snapshot && (
          <span
            style={{
              ...monoLabel,
              color: "var(--ink-faint)",
              letterSpacing: "0.16em",
              marginLeft: "auto",
            }}
          >
            snapshot {fmtRelative(snapshot.capturedAt)}
          </span>
        )}
      </div>

      {!snapshot ? (
        <p style={{ ...fraunces17, fontStyle: "italic", color: "var(--ink-muted)", marginTop: 12 }}>
          No snapshot yet. The daily cron writes one at 04:00 UTC, or hit
          <code> /api/cron/r2-snapshot</code> directly.
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 18,
            marginTop: 14,
          }}
        >
          <Stat label="TOTAL" value={fmtBytes(snapshot.totalBytes)} />
          <Stat label="OBJECTS" value={snapshot.objectCount.toLocaleString()} />
          <ByPrefix value={snapshot.byPrefix} />
        </div>
      )}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ ...monoLabel, color: "var(--ink-faint)", letterSpacing: "0.18em" }}>
        {label}
      </span>
      <span style={{ ...numberStyle, fontSize: 22, color: "var(--ink)" }}>{value}</span>
    </div>
  )
}

function ByPrefix({ value }: { value: unknown }) {
  if (!value || typeof value !== "object") return null
  const entries = Object.entries(value as Record<string, { bytes: number; count: number }>)
    .sort((a, b) => (b[1]?.bytes ?? 0) - (a[1]?.bytes ?? 0))
    .slice(0, 6)
  return (
    <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ ...monoLabel, color: "var(--ink-faint)", letterSpacing: "0.18em" }}>
        BY PREFIX
      </span>
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {entries.map(([prefix, { bytes, count }]) => (
          <li
            key={prefix}
            className="inv-row"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 100px 80px",
              alignItems: "baseline",
              padding: "6px 4px",
              gap: 12,
            }}
          >
            <span style={{ ...dmBody, color: "var(--ink)" }}>{prefix}</span>
            <span style={{ ...numberStyle, fontSize: 14, color: "var(--ink-muted)" }}>
              {fmtBytes(bytes)}
            </span>
            <span style={{ ...monoLabel, color: "var(--ink-faint)" }}>
              {count.toLocaleString()} objs
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function fmtBytes(n: number | bigint): string {
  const v = typeof n === "bigint" ? Number(n) : n
  if (v < 1024) return `${v} B`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`
  if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`
  return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB`
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
