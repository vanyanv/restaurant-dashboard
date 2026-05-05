"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"

type Phase = "intro" | "hold" | "collapse" | "done"

const INTRO_MS = 1700
const HOLD_MS = 450
const COLLAPSE_MS = 400
const REDUCED_INTRO_MS = 600
const REDUCED_HOLD_MS = 800

export function WelcomeMarquee({ firstName }: { firstName: string }) {
  const reduceMotion = useReducedMotion()
  const [phase, setPhase] = useState<Phase>("intro")

  useEffect(() => {
    if (phase === "intro") {
      const t = setTimeout(
        () => setPhase("hold"),
        reduceMotion ? REDUCED_INTRO_MS : INTRO_MS,
      )
      return () => clearTimeout(t)
    }
    if (phase === "hold") {
      const t = setTimeout(
        () => setPhase("collapse"),
        reduceMotion ? REDUCED_HOLD_MS : HOLD_MS,
      )
      return () => clearTimeout(t)
    }
    if (phase === "collapse") {
      const t = setTimeout(() => setPhase("done"), COLLAPSE_MS)
      return () => clearTimeout(t)
    }
  }, [phase, reduceMotion])

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

  const visible = phase === "intro" || phase === "hold"

  if (reduceMotion) {
    return (
      <AnimatePresence>
        {visible && (
          <motion.div
            key="welcome"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="welcome-marquee welcome-marquee--reduced"
            role="status"
            aria-live="polite"
          >
            <span className="welcome-text">
              Welcome <em>back</em>, <em>{firstName}</em>.
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    )
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="welcome"
          className="welcome-marquee"
          initial={{ opacity: 0, scaleY: 0.985 }}
          animate={{ opacity: 1, scaleY: 1 }}
          exit={{ opacity: 0, scaleY: 0 }}
          transition={{
            opacity: { duration: 0.3, ease: "easeOut" },
            scaleY: { duration: 0.4, ease: [0.7, 0, 0.84, 0] },
          }}
          style={{ transformOrigin: "top", overflow: "hidden" }}
          role="status"
          aria-live="polite"
        >
          <motion.div
            className="welcome-rule"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.5, ease: [0.32, 0.72, 0.32, 1] }}
            style={{ transformOrigin: "left" }}
          />
          <div className="welcome-line">
            <motion.span
              className="welcome-greeting"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.5, ease: "easeOut" }}
            >
              Welcome <em>back</em>,
            </motion.span>
            <motion.span
              className="welcome-name"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 1.0, ease: "easeOut" }}
            >
              <em>{firstName}</em>.
            </motion.span>
            <motion.span
              className="welcome-stamp"
              initial={{ scale: 0, rotate: -12, opacity: 0 }}
              animate={{ scale: 1, rotate: 3, opacity: 1 }}
              transition={{
                delay: 1.3,
                duration: 0.45,
                type: "spring",
                stiffness: 220,
                damping: 14,
              }}
              aria-hidden="true"
            >
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
              <motion.span
                className="welcome-stamp-puff"
                initial={{ scale: 0, opacity: 0.35 }}
                animate={{ scale: 2.2, opacity: 0 }}
                transition={{ delay: 1.3, duration: 0.6, ease: "easeOut" }}
                aria-hidden="true"
              />
            </motion.span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
