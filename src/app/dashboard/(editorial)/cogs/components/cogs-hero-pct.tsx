"use client"

import { useEffect, useState } from "react"

const DURATION_MS = 700

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

export function CogsHeroPct({
  value,
  isOver,
}: {
  value: number
  isOver: boolean
}) {
  const [shown, setShown] = useState(0)

  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS)
      setShown(value * easeOutCubic(t))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])

  return (
    <div className={isOver ? "cogs-hero-pct cogs-hero-pct--over" : "cogs-hero-pct"}>
      {shown.toFixed(1)}
      <span className="cogs-hero-pct__unit">%</span>
    </div>
  )
}
