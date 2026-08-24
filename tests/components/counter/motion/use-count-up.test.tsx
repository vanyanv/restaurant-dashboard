// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useCountUp, COUNT_UP_MS } from "@/components/counter/motion/use-count-up"

function setReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", () => ({
    matches, media: "(prefers-reduced-motion: reduce)",
    addEventListener: () => {}, removeEventListener: () => {},
  }))
}

describe("useCountUp", () => {
  beforeEach(() => { vi.unstubAllGlobals(); vi.useFakeTimers() })
  afterEach(() => vi.useRealTimers())

  it("returns the final value immediately under reduced motion", () => {
    setReducedMotion(true)
    expect(renderHook(() => useCountUp(7468)).result.current).toBe(7468)
  })

  it("starts below the target and arrives at it exactly", () => {
    setReducedMotion(false)
    const { result } = renderHook(() => useCountUp(7468))
    expect(result.current).toBeLessThan(7468)
    act(() => { vi.advanceTimersByTime(COUNT_UP_MS + 50) })
    // Exactly the target, not 7467.98 — a figure that lands one cent short
    // after animating is worse than one that never animated.
    expect(result.current).toBe(7468)
  })

  it("restarts toward a new target when the value changes", () => {
    setReducedMotion(false)
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), {
      initialProps: { v: 100 },
    })
    act(() => { vi.advanceTimersByTime(COUNT_UP_MS + 50) })
    expect(result.current).toBe(100)
    rerender({ v: 200 })
    act(() => { vi.advanceTimersByTime(COUNT_UP_MS + 50) })
    expect(result.current).toBe(200)
  })

  it("handles a negative target", () => {
    setReducedMotion(false)
    const { result } = renderHook(() => useCountUp(-2208))
    act(() => { vi.advanceTimersByTime(COUNT_UP_MS + 50) })
    expect(result.current).toBe(-2208)
  })

  it("is 480ms by the design's choosing", () => {
    expect(COUNT_UP_MS).toBe(480)
  })
})
