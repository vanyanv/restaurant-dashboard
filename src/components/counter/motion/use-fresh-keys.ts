"use client"

import { useEffect, useRef, useState } from "react"
import { useReducedMotion } from "./use-reduced-motion"

/** How long a row that arrived after first paint wears its mark. */
export const FRESH_MS = 1500

const SEP = "\n"

/**
 * Which of `keys` were not there on the previous render, AFTER the first
 * paint, and only while `scope` is unchanged.
 *
 * This is the difference between a row ARRIVING (an alert that opened while
 * the page was up: tier 2, it rings) and a row being RENDERED (the range
 * changed, so the whole queue is different rows: tier 3, it staggers in like
 * everything else and rings at nothing). `scope` is whatever names the
 * reader's own act, typically the store and range, so a change the reader
 * made is never mistaken for a change that happened to them.
 *
 * Returns the empty set on the server and on the first client render.
 */
export function useFreshKeys(keys: readonly string[], scope: string): ReadonlySet<string> {
  const reduced = useReducedMotion()
  const seen = useRef<{ scope: string; keys: Set<string> } | null>(null)
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set())
  // Joined, because `keys` is a new array every render; a newline, because a
  // key may carry a space.
  const joined = keys.join(SEP)

  useEffect(() => {
    const now = new Set(joined === "" ? [] : joined.split(SEP))
    const before = seen.current
    seen.current = { scope, keys: now }
    if (!before || before.scope !== scope || reduced) return
    const arrived = [...now].filter((k) => !before.keys.has(k))
    if (arrived.length === 0) return
    setFresh(new Set(arrived))
    const t = setTimeout(() => setFresh(new Set()), FRESH_MS)
    return () => clearTimeout(t)
  }, [joined, scope, reduced])

  return fresh
}
