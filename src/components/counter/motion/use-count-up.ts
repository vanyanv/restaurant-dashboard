"use client"

import { useEffect, useRef, useState } from "react"
import { useReducedMotion } from "./use-reduced-motion"

export const COUNT_UP_MS = 480

/**
 * A figure counts up to what it already says.
 *
 * The subtlety worth getting right: the animation must END on the exact
 * target. Interpolating by elapsed-time fraction and stopping when the clock
 * runs out can leave a figure a fraction short, and a dashboard that renders
 * $7,467.98 where the data says $7,468 has done something worse than not
 * animating at all.
 */
export function useCountUp(value: number, opts: { durationMs?: number } = {}): number {
  const duration = opts.durationMs ?? COUNT_UP_MS
  const reduced = useReducedMotion()
  const [display, setDisplay] = useState(() => (reduced ? value : 0))
  const frame = useRef<number | null>(null)

  useEffect(() => {
    if (reduced) {
      setDisplay(value)
      return
    }
    const from = 0
    const start = performance.now()

    const tick = (now: number) => {
      const elapsed = now - start
      if (elapsed >= duration) {
        setDisplay(value) // exact, always
        return
      }
      const t = elapsed / duration
      // Ease-out: fast at first, settling into the figure.
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(from + (value - from) * eased)
      frame.current = requestAnimationFrame(tick)
    }

    frame.current = requestAnimationFrame(tick)
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [value, duration, reduced])

  return display
}
