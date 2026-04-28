import type { PageInsight } from "@/lib/ai-analytics/read"

/**
 * The "lead article" rendering of the highest-priority Overview insight. Fills
 * the role the plan called the "morning briefing" — a Fraunces-italic display
 * line + a longer prose body. Distinct from the numbered insight list below.
 *
 * If no insights exist this renders nothing — the page composes an EmptyEdition
 * panel instead.
 */
export function LeadBriefing({ insight }: { insight: PageInsight }) {
  return (
    <section className="space-y-4 border-b border-(--hairline-bold) pb-7">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-(--accent)">
          Lead
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-(--ink-faint)">
          {insight.severity}
        </span>
      </div>
      <h2 className="font-display text-[clamp(28px,3.6vw,40px)] italic leading-[1.05] tracking-[-0.024em] text-(--ink)">
        {insight.headline}
      </h2>
      <p className="max-w-[68ch] font-sans text-[15px] leading-[1.6] text-(--ink-muted)">
        {insight.body}
      </p>
    </section>
  )
}
