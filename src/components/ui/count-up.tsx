"use client"

import { useEffect, useRef, useState } from "react"

type CountUpProps = {
  value: number
  format?: (n: number) => string
  duration?: number
  className?: string
}

const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4)

function prefersReducedMotion() {
  if (typeof window === "undefined") return false
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

export function CountUp({
  value,
  format = (n) => n.toLocaleString(),
  duration = 320,
  className,
}: CountUpProps) {
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef<number | null>(null)

  useEffect(() => {
    const target = value
    const start = fromRef.current

    if (start === target) {
      setDisplay(target)
      return
    }

    if (prefersReducedMotion() || duration <= 0) {
      fromRef.current = target
      setDisplay(target)
      return
    }

    startRef.current = null
    const tick = (t: number) => {
      if (startRef.current === null) startRef.current = t
      const elapsed = t - startRef.current
      const progress = Math.min(elapsed / duration, 1)
      const eased = easeOutQuart(progress)
      const next = start + (target - start) * eased
      setDisplay(next)
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = target
        rafRef.current = null
      }
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      fromRef.current = target
    }
  }, [value, duration])

  return <span className={className}>{format(display)}</span>
}
