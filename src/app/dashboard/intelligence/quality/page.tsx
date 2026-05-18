import { Suspense } from "react"
import { AccuracySection } from "./components/accuracy-section"
import { ReconciliationSection } from "./components/reconciliation-section"
import { LifecycleSection } from "./components/lifecycle-section"
import { GateStreakSection } from "./components/gate-streak-section"

export default function QualityPage() {
  return (
    <div className="px-6 py-6 space-y-6">
      <Suspense fallback={<div className="inv-panel px-5 py-6">Loading accuracy…</div>}>
        <AccuracySection />
      </Suspense>
      <Suspense fallback={<div className="inv-panel px-5 py-6">Loading reconciliation…</div>}>
        <ReconciliationSection />
      </Suspense>
      <Suspense fallback={<div className="inv-panel px-5 py-6">Loading lifecycle…</div>}>
        <LifecycleSection />
      </Suspense>
      <Suspense fallback={<div className="inv-panel px-5 py-6">Loading gate streak…</div>}>
        <GateStreakSection />
      </Suspense>
    </div>
  )
}
