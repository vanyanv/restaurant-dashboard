import type { QuotaKey, VercelUsageMetrics } from "@/lib/monitoring/vercel-usage"
import { QuotaGauge } from "../quota-gauge"
import { fraunces17, monoLabel } from "../styles"
import { RegisterMark } from "../register-mark"
import { SYSTEM_INK } from "../system-color"

/** Full grid of every Vercel quota — used by the Infrastructure drilldown. */
export function VercelQuotasGrid({
  metrics,
  capturedAt,
}: {
  metrics: VercelUsageMetrics | null
  capturedAt: Date | null
}) {
  if (!metrics) {
    return (
      <section className="inv-panel" id="vercel" style={{ padding: "16px 18px" }}>
        <Header capturedAt={null} />
        <p style={{ ...fraunces17, fontStyle: "italic", color: "var(--ink-muted)", marginTop: 12 }}>
          No snapshot yet. The cron writes one every 15 minutes.
        </p>
      </section>
    )
  }
  const entries = Object.entries(metrics) as Array<[QuotaKey, VercelUsageMetrics[QuotaKey]]>
  return (
    <section className="inv-panel" id="vercel" style={{ padding: "16px 18px" }}>
      <Header capturedAt={capturedAt} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 18,
          marginTop: 14,
        }}
      >
        {entries.map(([key, q]) => (
          <QuotaGauge key={key} quotaKey={key} quota={q} />
        ))}
      </div>
    </section>
  )
}

function Header({ capturedAt }: { capturedAt: Date | null }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
      <RegisterMark color={SYSTEM_INK.vercel} size={8} />
      <span style={{ ...fraunces17, fontStyle: "italic", color: "var(--ink)" }}>
        Vercel quotas
      </span>
      {capturedAt && (
        <span
          style={{
            ...monoLabel,
            color: "var(--ink-faint)",
            letterSpacing: "0.16em",
            marginLeft: "auto",
          }}
        >
          captured {fmtRelative(capturedAt)}
        </span>
      )}
    </div>
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
