import Link from "next/link"
import { PageHead } from "@/components/mobile/page-head"
import { Panel } from "@/components/mobile/panel"

// Renders inside the (mobile) `/m` layout by placement, so the tab bar
// stays visible — unlike the root `not-found.tsx`, which bypasses it.
export default function MobileNotFound() {
  return (
    <div data-perf-ready="/m/not-found">
      <PageHead dept="404" title="Not found" />

      <div className="dock-in dock-in-2">
        <Panel flush>
          <div className="m-empty m-empty--flush">
            This page doesn&rsquo;t exist on mobile. It may live on the
            desktop dashboard.
          </div>
        </Panel>
      </div>

      <div className="dock-in dock-in-3" style={{ marginTop: 14 }}>
        <Link href="/m" className="m-toolbar-btn">
          Back to Home →
        </Link>
      </div>
    </div>
  )
}
