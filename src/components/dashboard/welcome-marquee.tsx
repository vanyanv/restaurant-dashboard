"use client"

import { useEffect, useState } from "react"

type Phase = "intro" | "hold" | "collapse" | "done"

const INTRO_MS = 1700
const HOLD_MS = 450
const COLLAPSE_MS = 400

export function WelcomeMarquee({ firstName }: { firstName: string }) {
  const [phase, setPhase] = useState<Phase>("intro")

  useEffect(() => {
    if (phase === "intro") {
      const t = setTimeout(() => setPhase("hold"), INTRO_MS)
      return () => clearTimeout(t)
    }
    if (phase === "hold") {
      const t = setTimeout(() => setPhase("collapse"), HOLD_MS)
      return () => clearTimeout(t)
    }
    if (phase === "collapse") {
      const t = setTimeout(() => setPhase("done"), COLLAPSE_MS)
      return () => clearTimeout(t)
    }
  }, [phase])

  useEffect(() => {
    if (phase !== "intro" && phase !== "hold") return
    const skip = () => setPhase("collapse")
    document.addEventListener("pointerdown", skip)
    document.addEventListener("keydown", skip)
    return () => {
      document.removeEventListener("pointerdown", skip)
      document.removeEventListener("keydown", skip)
    }
  }, [phase])

  if (phase === "done") return null

  return (
    <div
      className={`welcome-marquee is-${phase}`}
      role="status"
      aria-live="polite"
    >
      <div className="welcome-rule" />
      <div className="welcome-line">
        <span className="welcome-greeting">
          Welcome <em>back</em>,
        </span>
        <span className="welcome-name">
          <em>{firstName}</em>.
        </span>
        <span className="welcome-stamp" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="28" height="28" fill="none">
            <rect
              x="2"
              y="2"
              width="28"
              height="28"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M9 16 L14 21 L23 11"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="welcome-stamp-puff" aria-hidden="true" />
        </span>
      </div>
    </div>
  )
}
