import { cn } from "@/lib/utils"

/**
 * Section wrapper for analytics pages: the editorial dateline treatment
 * (mono uppercase label + dotted rule) rather than a bare sans heading —
 * matches the section furniture on the overview and P&L pages.
 */
export function DashboardSection({
  title,
  children,
  className,
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("space-y-4", className)}>
      <div className="flex items-center gap-3">
        <h2 className="editorial-section-label">{title}</h2>
        <div className="flex-1 h-px border-t border-dotted border-(--hairline-bold)" />
      </div>
      {children}
    </section>
  )
}
