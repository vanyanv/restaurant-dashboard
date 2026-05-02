import type { Quota, QuotaKey } from "@/lib/monitoring/vercel-usage"
import { monoLabel, number as numberStyle } from "./styles"
import { RegisterMark } from "./register-mark"
import { SYSTEM_INK } from "./system-color"

/** Quota-bar treatment per the spec:
 *   bar    --ink         (0–69%)
 *   bar    --ink-ochre   (70–89%)
 *   bar    --accent      (90–100%, plus pulse at 100%)
 *   track  --hairline    (always)
 * Each gauge is prefixed with a Vercel sepia register mark so a row of
 * gauges reads as belonging to the Vercel system. */
export function QuotaGauge({
  quotaKey,
  quota,
}: {
  quotaKey: QuotaKey
  quota: Quota
}) {
  const used = quota.used ?? 0
  const limit = quota.limit ?? 0
  const pct =
    quota.used != null && quota.limit != null && quota.limit > 0
      ? Math.min(100, (used / limit) * 100)
      : 0
  const tone = pct >= 90 ? "danger" : pct >= 70 ? "warn" : "ok"
  const barColor =
    tone === "danger"
      ? "var(--accent)"
      : tone === "warn"
      ? "var(--ink-ochre)"
      : "var(--ink)"
  const isAtCap = pct >= 100

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}
      data-quota-key={quotaKey}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <RegisterMark color={SYSTEM_INK.vercel} />
        <span
          style={{
            ...numberStyle,
            fontSize: 14,
            color: "var(--ink)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {formatValue(quota)}
        </span>
        <span
          style={{
            ...monoLabel,
            color: tone === "ok" ? "var(--ink-faint)" : barColor,
            marginLeft: "auto",
          }}
        >
          {Math.round(pct)}%
        </span>
      </div>
      <div
        style={{
          height: 4,
          background: "var(--hairline)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${pct}%`,
            background: barColor,
            transition: "width 320ms cubic-bezier(0.22, 1, 0.36, 1)",
            ...(isAtCap
              ? { animation: "quota-pulse 4s ease-in-out infinite" }
              : null),
          }}
        />
      </div>
      <span
        style={{
          ...monoLabel,
          color: "var(--ink-muted)",
          letterSpacing: "0.16em",
        }}
      >
        {quota.label}
      </span>
    </div>
  )
}

function formatValue(quota: Quota): string {
  if (quota.used == null) return "—"
  const u = formatScalar(quota.used, quota.unit)
  if (quota.limit == null) return u
  return `${u} / ${formatScalar(quota.limit, quota.unit)}`
}

function formatScalar(n: number, unit: Quota["unit"]): string {
  if (unit === "bytes") {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
  }
  if (unit === "gbHours") return `${n.toFixed(1)} GB-Hrs`
  if (unit === "cpuMs") {
    const totalMin = n / 60_000
    const h = Math.floor(totalMin / 60)
    const m = Math.round(totalMin % 60)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }
  if (unit === "ms") return `${(n / 1000).toFixed(1)}s`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return `${n}`
}
