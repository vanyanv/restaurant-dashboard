// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useEntry, ENTRY_STAGGER_MS, ENTRY_TOTAL_MS } from "@/components/counter/motion/use-entry"

function setReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", () => ({
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

describe("useEntry", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("staggers each section 36ms after the one before it", () => {
    setReducedMotion(false)
    expect(renderHook(() => useEntry(0)).result.current.style.animationDelay).toBe("0ms")
    expect(renderHook(() => useEntry(1)).result.current.style.animationDelay).toBe("36ms")
    expect(renderHook(() => useEntry(4)).result.current.style.animationDelay).toBe("144ms")
  })

  it("finishes inside 330ms however many sections there are", () => {
    setReducedMotion(false)
    // The stagger is capped so a long page does not animate for two seconds.
    const last = renderHook(() => useEntry(40)).result.current.style
    const delay = parseInt(String(last.animationDelay), 10)
    const duration = parseInt(String(last.animationDuration), 10)
    expect(delay + duration).toBeLessThanOrEqual(ENTRY_TOTAL_MS)
  })

  it("emits NO animation at all under reduced motion", () => {
    setReducedMotion(true)
    const style = renderHook(() => useEntry(3)).result.current.style
    expect(style.animationName).toBeUndefined()
    expect(style.animationDelay).toBeUndefined()
    expect(style.opacity).toBeUndefined()
  })

  it("exposes the stagger as a constant so nobody retypes 36", () => {
    expect(ENTRY_STAGGER_MS).toBe(36)
  })
})
