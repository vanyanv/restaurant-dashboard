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
 * (`docs/counter/motion-verification.md`):
 *
 * 1. Hydration safety. This USED to be fixed locally, here: `display`
 *    forced to initialise to `value` regardless of `reduced`, because
 *    `useReducedMotion` used to read `matchMedia` during render, which
 *    disagreed between the server (always "reduced", no `matchMedia`
 *    there) and a `no-preference` client's first render — a real,
 *    reproduced-every-time hydration mismatch. That root cause is now
 *    fixed systemically, in `useReducedMotion` itself (its initial state
 *    is unconditionally `true`, full stop — see that hook's module
 *    comment), which means `reduced` is now ALSO always `true` on this
 *    hook's first render, on the server and the client alike. The local
 *    `useState(value)` below is therefore redundant with that fix — but
 *    kept anyway, deliberately, as defense-in-depth: it doesn't rely on a
 *    caller trusting `useReducedMotion`'s internal contract to hold
 *    forever, it costs nothing (the two forms produce an identical first
 *    render today), and it keeps this hook's own hydration-safety
 *    invariant readable in one place without having to go verify it
 *    against another module. The count-DOWN-then-up-again for a
 *    `no-preference` visitor happens only in the mount effect, after
 *    hydration has already succeeded: one settled frame at the target,
 *    then it drops to 0 and animates back up. That single settled frame is
 *    the accepted cost of this pattern — cheap and invisible in practice —
 *    against a hydration error, which is neither. Don't "optimise" it back
 *    to starting at 0 immediately; that's what caused the mismatch.
 *
 *    (`CounterThemeProvider`/`ThemeToggle` in `theme-provider.tsx` reads a
 *    different client-only value — `localStorage`, not motion preference —
 *    during render, for the same underlying reason this hook used to.
 *    `useReducedMotion`'s fix does not cover it. Not fixed here because it
 *    has no mounted consumer yet; whoever mounts `ThemeToggle` should look
 *    at both fixes first.)
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
  // redundant with useReducedMotion's own fix now, kept as local
  // defense-in-depth (see the hydration-safety note above). Only the
  // mount effect below ever moves it to `from`.
  const [display, setDisplay] = useState(value)
  const frame = useRef<number | null>(null)
  /** The last value this hook animated to; null until the first mount effect. */
  const prevRef = useRef<number | null>(null)

  useEffect(() => {
    if (reduced) {
      setDisplay(value)
      return
    }
    // D3 ("only what changed moves"): on mount the figure counts from 0; on
    // a later change it counts from the figure it was showing; and when the
    // value did not change it does not move at all. Counting a page from 0
    // again because one cell changed is how the one cell that did gets lost.
    const prev = prevRef.current
    prevRef.current = value
    if (prev !== null && prev === value) {
      setDisplay(value)
      return
    }
    const from = prev === null ? 0 : prev
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
