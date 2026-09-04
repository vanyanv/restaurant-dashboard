"use client"

import { useEffect, useState } from "react"
import { useReducedMotion } from "./use-reduced-motion"

/** One character every 22ms: a 20-character sentence in under half a second. */
export const TYPE_CHAR_MS = 22

/**
 * A sentence typed out, ending exactly on the sentence.
 *
 * Built on the same two rules as `useCountUp`:
 *
 * 1. Hydration safety. `shown` initialises to the FULL text, so the server
 *    and the client's first render agree; the mount effect is the only place
 *    it is ever emptied. `useReducedMotion` starts `true` on every mount and
 *    flips after one tick, so a fresh mount shows one settled frame of the
 *    whole sentence before typing begins. The two callers (the sign-in doors)
 *    mount this under a panel that is still wiping in, so that frame is never
 *    painted where a reader can see it — but it is the accepted cost of the
 *    pattern regardless, for the reasons written on `useCountUp`.
 *
 * 2. Exactness. The interval is cleared the moment the count reaches the
 *    text's length and the LAST write is `text` itself, never a slice — a
 *    greeting missing its full stop because a timer fired one tick short is
 *    the typing equivalent of $7,467.98.
 *
 * `done` is its own state rather than `shown === text`, so it is false on
 * the settled first frame and only true once typing has actually finished
 * (or immediately, under reduced motion). A caller mounting something on
 * `done` therefore never flashes it for a frame at mount.
 */
export function useTypewriter(
  text: string,
  opts: { charMs?: number; delayMs?: number } = {},
): { shown: string; done: boolean } {
  const charMs = opts.charMs ?? TYPE_CHAR_MS
  const delayMs = opts.delayMs ?? 0
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(text)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (reduced) {
      setShown(text)
      setDone(true)
      return
    }
    setShown("")
    setDone(false)
    let i = 0
    let interval: ReturnType<typeof setInterval> | null = null
    const start = setTimeout(() => {
      interval = setInterval(() => {
        i += 1
        if (i >= text.length) {
          if (interval) clearInterval(interval)
          setShown(text) // exact, always
          setDone(true)
          return
        }
        setShown(text.slice(0, i))
      }, charMs)
    }, delayMs)
    return () => {
      clearTimeout(start)
      if (interval) clearInterval(interval)
    }
  }, [text, charMs, delayMs, reduced])

  return { shown, done }
}
