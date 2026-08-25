"use client"

import { useEffect, useState } from "react"

const QUERY = "(prefers-reduced-motion: reduce)"

/**
 * The single place Counter asks whether motion should run.
 *
 * Every motion hook consults this, so honouring the preference is one
 * decision rather than a discipline repeated in every animated component —
 * which is the same reason `SectionData` exists for states.
 *
 * The initial state is unconditionally `true` (reduced) — it does NOT call
 * `matchMedia` during render, even though the client could answer that
 * question immediately. That's deliberate, not a missed optimisation:
 * `matchMedia` reflects the *client's* preference, and the server has no
 * client to ask, so reading it during render makes the server's answer
 * (always "unavailable" -> `true`) and a `no-preference` client's answer
 * (`false`) disagree on the very first render. That exact split is what
 * produced real, reproduced-every-time hydration mismatches downstream —
 * `useCountUp` (server painted the final value, client wanted to animate
 * from 0 — React discarded and regenerated the whole subtree) and
 * `useEntry` (a milder, attribute-only version of the same thing, only
 * visible once the `useCountUp` failure stopped masking it). Both were
 * symptoms of this hook's initialiser reading a client-only value during
 * render; fixing it once here, instead of in every consumer, is what
 * actually closes the hole. See docs/counter/motion-verification.md.
 *
 * The effect below is what turns on the real preference — one tick after
 * mount, after hydration has already succeeded — and keeps listening for
 * changes. The consequence (motion is OFF through SSR and hydration, then
 * switches on) is a feature, not a cost, and it's consistent with the
 * safe-default reasoning below: a missed animation is a cosmetic loss; an
 * unwanted one can trigger vestibular symptoms in people who specifically
 * asked not to have it. Erring toward stillness in every uncertain moment
 * — including the moment before the browser has told us anything at all —
 * is correct, not merely convenient.
 *
 * Do not "optimise" this back into reading `matchMedia` in the
 * initialiser. That's the bug.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true)

  useEffect(() => {
    if (typeof matchMedia !== "function") return
    const mql = matchMedia(QUERY)
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    mql.addEventListener("change", onChange)
    // Read the real preference now, post-mount — this is the one and only
    // place a client-only value is allowed to reach `reduced`.
    setReduced(mql.matches)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return reduced
}
