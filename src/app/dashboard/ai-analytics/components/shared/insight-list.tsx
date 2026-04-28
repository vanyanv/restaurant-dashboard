import type { PageInsight } from "@/lib/ai-analytics/read"

/**
 * The numbered insight list — a Top-N actions block. Mono ordinal, severity
 * stamp, Fraunces-italic headline, DM Sans body, optional impact stamp on
 * the right. No side stripes (banned by the design laws); severity is shown
 * as a small mono pill instead.
 */
export function InsightList({
  insights,
  startAt = 1,
  emptyMessage = "Nothing material to act on right now.",
}: {
  insights: PageInsight[]
  startAt?: number
  emptyMessage?: string
}) {
  if (insights.length === 0) {
    return (
      <p className="font-display text-[18px] italic text-(--ink-muted)">
        {emptyMessage}
      </p>
    )
  }

  return (
    <ol className="divide-y divide-(--hairline) border-t border-b border-(--hairline)">
      {insights.map((i, idx) => (
        <li key={i.id} className="grid grid-cols-[44px_1fr_auto] items-baseline gap-x-5 gap-y-1 py-5">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-(--ink-faint)">
            {(startAt + idx).toString().padStart(2, "0")}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-3">
              <SeverityStamp severity={i.severity} />
              <h3 className="font-display text-[20px] italic leading-tight text-(--ink)">
                {i.headline}
              </h3>
            </div>
            <p className="max-w-[62ch] font-sans text-[13px] leading-[1.55] text-(--ink-muted)">
              {i.body}
            </p>
          </div>

          {i.impactDollars != null ? (
            <div className="flex flex-col items-end">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
                Impact
              </div>
              <div className="font-sans text-[15.5px] font-semibold tabular-nums tracking-[-0.014em] text-(--ink)">
                ${formatDollars(i.impactDollars)}
              </div>
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

function SeverityStamp({ severity }: { severity: PageInsight["severity"] }) {
  const styles =
    severity === "ALERT"
      ? "bg-(--accent-bg) text-(--accent)"
      : severity === "WATCH"
        ? "bg-[rgba(138,58,58,0.08)] text-(--subtract)"
        : "bg-[rgba(26,22,19,0.04)] text-(--ink-muted)"
  return (
    <span
      className={`inline-flex items-center font-mono text-[9px] font-medium uppercase tracking-[0.22em] ${styles} px-1.5 py-[3px]`}
      style={{ borderRadius: 2 }}
    >
      {severity}
    </span>
  )
}

function formatDollars(n: number): string {
  const rounded = Math.round(n)
  return rounded.toLocaleString("en-US")
}
