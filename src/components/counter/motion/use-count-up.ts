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
 *
 * Two defects were found by driving this in a real browser
 * (`docs/counter/motion-verification.md`) that stubbed-`matchMedia` unit
 * tests could not see, and both are fixed here:
 *
 * 1. Hydration safety. `useReducedMotion` can only know "reduced" during
 *    SSR (no `matchMedia` on the server), so the server always paints
 *    `value`. The initial client render MUST paint the same thing, or React
 *    sees a text mismatch, throws "Hydration failed", and discards and
 *    regenerates the whole subtree — far more expensive, and more visibly
 *    broken, than the thing this is trying to avoid. So `display` always
 *    initialises to `value`, on the server and on the client's first
 *    render, regardless of `reduced`. The count-DOWN-then-up-again for a
 *    `no-preference` visitor happens only in the mount effect, after
 *    hydration has already succeeded: one settled frame at the target,
 *    then it drops to 0 and animates back up. That single settled frame is
 *    the accepted cost of this pattern — cheap and invisible in practice —
 *    against a hydration error, which is neither. Don't "optimise" it back
 *    to starting at 0 immediately; that's what caused the mismatch.
 *
 *    (`CounterThemeProvider`/`ThemeToggle` in `theme-provider.tsx` reads
 *    client-only state during render for the same reason this hook used
 *    to — same latent hydration risk, not fixed here because it has no
 *    mounted consumer yet. Whoever mounts `ThemeToggle` should look at
 *    this fix first.)
 *
 * 2. Clock safety. `requestAnimationFrame`'s timestamp is the time its
 *    frame began, not the time the callback runs — it can predate a
 *    `performance.now()` read taken after that frame started (measured
 *    directly: a captured `start` of 125.5ms against a first callback
 *    `now` of 115.7ms). An unclamped `elapsed` going negative fed the
 *    cubic ease-out an out-of-range fraction and painted -542 / -664 for
 *    one frame. `elapsed` is clamped to 0 and the eased fraction to
 *    [0, 1], so no timestamp ordering, remount timing, or arithmetic path
 *    can display anything outside [start, value].
 */
export function useCountUp(value: number, opts: { durationMs?: number } = {}): number {
  const duration = opts.durationMs ?? COUNT_UP_MS
  const reduced = useReducedMotion()
  // Always the target on the server AND on the client's first render —
  // see the hydration-safety note above. Only the mount effect below ever
  // moves it to `from`.
  const [display, setDisplay] = useState(value)
  const frame = useRef<number | null>(null)

  useEffect(() => {
    if (reduced) {
      setDisplay(value)
      return
    }
    const from = 0
    setDisplay(from)
    const start = performance.now()

    const tick = (now: number) => {
      // Clamp: a remounted animation's first frame can report a `now`
      // earlier than `start` (see the clock-safety note above).
      const elapsed = Math.max(0, now - start)
      if (elapsed >= duration) {
        setDisplay(value) // exact, always
        return
      }
      const t = Math.min(1, Math.max(0, elapsed / duration))
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
