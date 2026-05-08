"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { acknowledgeAnomaly, type OpenAnomaliesData } from "@/app/actions/forecasts/anomaly-actions"

interface Props {
  data: OpenAnomaliesData
}

const TARGET_LABEL: Record<string, string> = {
  REVENUE: "Revenue",
  MENU_ITEM: "Menu item",
  INGREDIENT: "Ingredient",
  LABOR: "Labor",
  REFUNDS: "Refunds",
}

function fmtSignedNum(n: number) {
  const sign = n > 0 ? "+" : ""
  return `${sign}${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function fmtZ(z: number | null) {
  if (z == null || !Number.isFinite(z)) return "—"
  const sign = z > 0 ? "+" : ""
  return `${sign}${z.toFixed(2)}σ`
}

export function AnomalyFeed({ data }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const ack = (id: string) => {
    startTransition(async () => {
      await acknowledgeAnomaly({ anomalyId: id })
      router.refresh()
    })
  }

  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">Anomaly feed</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          {data.events.length} open · z ≥ 3
        </span>
      </header>
      {data.events.length === 0 ? (
        <div className="px-5 py-6 text-[var(--ink-muted)]">
          No anomalies in the last detection pass. The pipeline scores yesterday's revenue
          and top menu items against the trailing 28-day distribution.
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-[100px_1fr_120px_120px_100px] gap-4 px-5 py-2 border-t border-[var(--hairline)] font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            <span>Date</span>
            <span>What</span>
            <span className="text-right">Residual</span>
            <span className="text-right">Z-score</span>
            <span className="text-right">Action</span>
          </div>
          {data.events.map((e) => (
            <div
              key={e.id}
              className="grid grid-cols-[100px_1fr_120px_120px_100px] gap-4 items-center px-5 py-2 border-t border-[var(--hairline)] hover:bg-[rgba(220,38,38,0.045)] transition-colors"
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                {format(new Date(e.occurredOn), "MMM d")}
              </div>
              <div className="text-[14px] text-[var(--ink)] truncate">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)] mr-2">
                  {TARGET_LABEL[e.target] ?? e.target}
                </span>
                {e.targetId ?? "—"}
              </div>
              <div
                className={`text-right text-[13px] tabular-nums ${
                  e.residual < 0 ? "text-[var(--accent)]" : "text-[var(--ink)]"
                }`}
                style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
              >
                {fmtSignedNum(e.residual)}
              </div>
              <div
                className={`text-right font-mono text-[11px] uppercase tracking-[0.18em] ${
                  Math.abs(e.zScore ?? 0) >= 4
                    ? "text-[var(--accent)] font-semibold"
                    : "text-[var(--accent)]"
                }`}
                style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
              >
                {fmtZ(e.zScore)}
              </div>
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => ack(e.id)}
                  disabled={isPending}
                  className="font-mono text-[10px] uppercase tracking-[0.18em] hover:text-[var(--accent)] disabled:opacity-40"
                >
                  Acknowledge
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
