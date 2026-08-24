"use client"

import type { CSSProperties } from "react"
import { useReducedMotion } from "./use-reduced-motion"

/** Sections rise 36ms apart, in reading order. */
export const ENTRY_STAGGER_MS = 36
/** Each section's own rise, when there is room for the full duration. */
export const ENTRY_DURATION_MS = 220
/** The whole orchestration is over by here, however long the page is. */
export const ENTRY_TOTAL_MS = 330

/**
 * One orchestrated entry per screen (note 27). The animation exists to show
 * the shape of the page arriving in reading order — which is what streaming
 * actually does here — not to decorate it.
 *
 * Two quantities are capped, independently, against the same budget
 * (ENTRY_TOTAL_MS):
 *
 *   - DELAY is capped at the full budget (not budget-minus-duration). An
 *     early brief draft capped delay at `ENTRY_TOTAL_MS - ENTRY_DURATION_MS`
 *     (110ms), which forces every section from index 4 onward to the same
 *     110ms delay — section 4 (uncapped: 144ms) and section 40 would rise
 *     at the same instant. That is not a stagger, it is a stagger that stops
 *     working after three sections.
 *   - DURATION is what actually shrinks to make room: a late section still
 *     rises, but over whatever time is left in the budget once its delay is
 *     spent, down to 0ms (an instant appearance) at the point its delay
 *     alone consumes the full 330ms. That is how a forty-section page still
 *     finishes by 330ms without every late section snapping in at once.
 */
export function useEntry(index: number): { style: CSSProperties } {
  const reduced = useReducedMotion()
  if (reduced) return { style: {} }

  const delay = Math.min(index * ENTRY_STAGGER_MS, ENTRY_TOTAL_MS)
  const duration = Math.max(0, Math.min(ENTRY_DURATION_MS, ENTRY_TOTAL_MS - delay))

  return {
    style: {
      animationName: "ct-entry",
      animationDuration: `${duration}ms`,
      animationDelay: `${delay}ms`,
      animationTimingFunction: "var(--ct-ease)",
      animationFillMode: "both",
    },
  }
}
