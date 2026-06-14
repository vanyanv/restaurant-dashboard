"use client"

import { useEffect } from "react"

/**
 * Shared dashboard route-error fallback. Each segment's `error.tsx` renders this
 * with its own title so a thrown server component shows a scoped, on-brand
 * editorial error card (inv-panel + Retry) instead of bubbling to the root
 * boundary's generic page.
 */
export function RouteError({
  error,
  reset,
  title = "Something went wrong",
}: {
  error: Error & { digest?: string }
  reset: () => void
  title?: string
}) {
  useEffect(() => {
    // Surface to the console/logs; Next.js also captures the digest server-side.
    console.error(error)
  }, [error])

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto px-4 pb-8 pt-4 sm:px-6 sm:pt-5">
        <div className="mx-auto max-w-350">
          <section className="inv-panel">
            <div className="inv-panel__head">
              <div>
                <div className="inv-panel__dept">Error</div>
                <h2 className="inv-panel__title">{title}</h2>
              </div>
            </div>
            <p className="max-w-[60ch] text-[13px] leading-6 text-[var(--ink-muted)]">
              This section could not load. Retry the request; if it keeps
              failing, the underlying data or an upstream sync may be
              unavailable.
            </p>
            <button type="button" className="toolbar-btn mt-5" onClick={reset}>
              Retry
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
