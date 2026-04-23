import Link from "next/link"
import { ListChecks } from "lucide-react"
import { listUnmatchedLineItems } from "@/app/actions/ingredient-match-actions"

/**
 * Renders only the "Needs review" link + badge that lives in the recipes
 * editorial topbar. Awaits `listUnmatchedLineItems()` purely to compute the
 * count. Wrapped in its own Suspense boundary so a slow invoice scan never
 * blocks the editor from opening.
 */
export async function UnmatchedCountSection() {
  const unmatched = await listUnmatchedLineItems()
  const count = unmatched.length

  return (
    <Link
      href="/dashboard/ingredients?tab=review"
      className="inline-flex h-8 items-center gap-1.5 border border-[var(--hairline-bold)] bg-[var(--paper)] px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-muted)] transition hover:border-[var(--ink)] hover:text-[var(--ink)]"
    >
      <ListChecks className="h-3 w-3" />
      Needs review
      {count > 0 && (
        <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center bg-[var(--accent)] px-1 text-[9px] text-white">
          {count}
        </span>
      )}
    </Link>
  )
}

/**
 * Minimal placeholder that keeps the topbar layout stable while the count
 * streams in. Styled to match the final link footprint so there is no CLS.
 */
export function UnmatchedCountFallback() {
  return (
    <span
      aria-hidden
      className="inline-flex h-8 items-center gap-1.5 border border-[var(--hairline)] bg-[var(--paper)] px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)]"
    >
      <ListChecks className="h-3 w-3" />
      Needs review
    </span>
  )
}
