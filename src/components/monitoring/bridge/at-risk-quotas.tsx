import { selectAtRiskQuotas, type VercelUsageMetrics } from "@/lib/monitoring/vercel-usage"
import { QuotaGauge } from "../quota-gauge"
import { monoLabel } from "../styles"

/** Row 2 — at-risk Vercel quotas (≥70%). Hides when nothing qualifies, so
 * a calm cycle gets a calm bridge. */
export function AtRiskQuotas({ metrics }: { metrics: VercelUsageMetrics | null }) {
  if (!metrics) return null
  const atRisk = selectAtRiskQuotas(metrics, 70)
  if (atRisk.length === 0) return null

  return (
    <section className="inv-panel" style={{ padding: "14px 16px" }}>
      <div
        style={{
          ...monoLabel,
          color: "var(--ink-faint)",
          letterSpacing: "0.22em",
          marginBottom: 12,
        }}
      >
        AT RISK · VERCEL QUOTAS
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 18,
        }}
      >
        {atRisk.map((q) => (
          <QuotaGauge key={q.key} quotaKey={q.key} quota={q} />
        ))}
      </div>
    </section>
  )
}
