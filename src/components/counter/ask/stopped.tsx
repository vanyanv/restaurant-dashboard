"use client"

import { labelFor } from "@/components/chat/tool-labels"
import type { AskStep } from "@/lib/counter/ask-state"

/**
 * A turn the reader stopped — kept, not discarded.
 *
 * The mock's `.stopped` under the `.thinking` block it interrupted: the
 * source that was being read is marked in place (`is-out`, the same dot a
 * different colour, so nothing shifts), then one line says what happened —
 * how long it ran, how many of the sources it got through — and that the
 * question is kept. Continue asks it again as a follow-up. The thread never
 * loses a question to a mis-press (F-R10).
 */
export function Stopped({
  steps,
  durationMs,
  onContinue,
}: {
  steps: AskStep[]
  durationMs: number
  onContinue: () => void
}) {
  const read = steps.filter((s) => s.state === "read").length
  return (
    <>
      <div className="thinking">
        {steps.length === 0 ? (
          <div className="tstep is-out">
            <i />
            <b>Reading the question…</b>
            <em>stopped</em>
          </div>
        ) : (
          steps.map((step) => {
            const label = labelFor(step.tool)
            const out = step.state !== "read"
            return (
              <div key={step.tool} className={`tstep ${out ? "is-out" : "is-read"}`}>
                <i />
                <b>{out ? label.running : label.done}</b>
                <span>{label.short}</span>
                <em>{out ? "stopped" : "read"}</em>
              </div>
            )
          })
        )}
      </div>
      <div className="stopped">
        <b>Stopped</b> after {(durationMs / 1000).toFixed(1)}s ·{" "}
        {steps.length === 0
          ? "before any source was read"
          : `${read} of ${steps.length} source${steps.length === 1 ? "" : "s"} read`}{" "}
        · the question is kept
        <button className="btn" type="button" onClick={onContinue}>
          Continue
        </button>
      </div>
    </>
  )
}
