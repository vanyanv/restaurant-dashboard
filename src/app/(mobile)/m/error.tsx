"use client"

import { useEffect } from "react"
import { PageHead } from "@/components/mobile/page-head"
import { Panel } from "@/components/mobile/panel"

// Renders inside the (mobile) `/m` layout by placement, so the tab bar
// stays visible while this view is up.
export default function MobileError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Surface to the console/logs; Next.js also captures the digest server-side.
    console.error(error)
  }, [error])

  return (
    <div data-perf-ready="/m/error">
      <PageHead dept="Error" title="Couldn't load" />

      <div className="dock-in dock-in-2">
        <Panel flush>
          <div className="m-empty m-empty--flush">
            We couldn&rsquo;t load this view right now. Try refreshing in a
            moment.
          </div>
        </Panel>
      </div>

      <div className="dock-in dock-in-3" style={{ marginTop: 14 }}>
        <button type="button" className="m-toolbar-btn" onClick={reset}>
          Retry
        </button>
      </div>
    </div>
  )
}
