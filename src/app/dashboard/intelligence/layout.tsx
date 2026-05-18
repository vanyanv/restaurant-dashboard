import Link from "next/link"
import type { ReactNode } from "react"

export default function IntelligenceLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col h-full">
      <header className="px-6 pt-4 border-b border-[color:var(--hairline-bold)]">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]">§ 09 Intelligence</p>
        <h1 className="font-serif italic text-[28px] text-[color:var(--ink)]">Recommendations & quality</h1>
        <nav className="flex gap-6 pt-4 pb-3">
          <Link
            href="/dashboard/intelligence/opportunities"
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-muted)] hover:text-[color:var(--ink)]"
          >
            Opportunities
          </Link>
          <Link
            href="/dashboard/intelligence/quality"
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-muted)] hover:text-[color:var(--ink)]"
          >
            Quality
          </Link>
        </nav>
      </header>
      {children}
    </div>
  )
}
