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
 * It defaults to REDUCED when `matchMedia` is unavailable (SSR, a test
 * environment, an old embedded webview). A missed animation is a cosmetic
 * loss; an unwanted one can trigger vestibular symptoms in people who
 * specifically asked not to have it. The safe default is the still one.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() =>
    typeof matchMedia === "function" ? matchMedia(QUERY).matches : true,
  )

  useEffect(() => {
    if (typeof matchMedia !== "function") return
    const mql = matchMedia(QUERY)
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    mql.addEventListener("change", onChange)
    // Re-read on mount: the value may have changed between the initial
    // render and the effect, and on the server it was always `true`.
    setReduced(mql.matches)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return reduced
}
