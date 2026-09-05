"use client"

import { useEffect, useRef, useState } from "react"
import { useReducedMotion } from "./use-reduced-motion"

/** How long a changed figure wears its mark: the cool-down's own length. */
export const CHANGED_MS = 1300

/**
 * True for `CHANGED_MS` after `value` changes, and never on mount, so a
 * page's first paint carries no marks. This is the one-shot "touch" a strip
 * cell takes when a sync or a range change moved its figure (D3): the CSS
 * reads the class this earns, the hook decides when it is earned.
 *
 * Hydration-safe by construction: `false` on the server and on the first
 * client render; only the effect, after mount, can ever flip it.
 */
export function useChanged(value: unknown): boolean {
  const reduced = useReducedMotion()
  const prev = useRef<unknown>(value)
  const mounted = useRef(false)
  const [changed, setChanged] = useState(false)

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      prev.current = value
      return
    }
    if (Object.is(prev.current, value)) return
    prev.current = value
    if (reduced) return
    setChanged(true)
    const t = setTimeout(() => setChanged(false), CHANGED_MS)
    return () => clearTimeout(t)
  }, [value, reduced])

  return changed
}
