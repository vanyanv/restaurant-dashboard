// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useChartDraw, LINE_DRAW_MS, BAR_STAGGER_MS } from "@/components/counter/motion/use-chart-draw"

function setReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", () => ({
    matches, media: "(prefers-reduced-motion: reduce)",
    addEventListener: () => {}, removeEventListener: () => {},
  }))
}

describe("useChartDraw", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("animates with the design's durations by default", () => {
    setReducedMotion(false)
    const r = renderHook(() => useChartDraw()).result.current
    expect(r).toEqual({ animate: true, lineDurationMs: LINE_DRAW_MS, barStaggerMs: BAR_STAGGER_MS })
  })

  it("reports animate:false under reduced motion, and zero durations", () => {
    setReducedMotion(true)
    const r = renderHook(() => useChartDraw()).result.current
    expect(r.animate).toBe(false)
    expect(r.lineDurationMs).toBe(0)
    expect(r.barStaggerMs).toBe(0)
  })

  it("carries the design's numbers, not invented ones", () => {
    expect(LINE_DRAW_MS).toBe(720)
    expect(BAR_STAGGER_MS).toBe(26)
  })
})
