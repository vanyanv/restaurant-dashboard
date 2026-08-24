"use client"

import { useReducedMotion } from "./use-reduced-motion"

/** A line strokes itself on over 720ms. */
export const LINE_DRAW_MS = 720
/** Bars grow from the baseline, 26ms apart. */
export const BAR_STAGGER_MS = 26

/**
 * Whether a chart should draw itself, and how fast.
 *
 * Returns zeroed durations rather than just `animate:false` so a caller can
 * pass the numbers straight through to Recharts without branching — Recharts
 * treats a zero duration as "appear immediately", which is exactly what
 * reduced motion should mean.
 */
export function useChartDraw(): {
  animate: boolean
  lineDurationMs: number
  barStaggerMs: number
} {
  const reduced = useReducedMotion()
  return reduced
    ? { animate: false, lineDurationMs: 0, barStaggerMs: 0 }
    : { animate: true, lineDurationMs: LINE_DRAW_MS, barStaggerMs: BAR_STAGGER_MS }
}
