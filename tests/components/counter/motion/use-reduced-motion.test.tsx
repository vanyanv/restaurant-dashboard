// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useReducedMotion } from "@/components/counter/motion/use-reduced-motion"

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>()
  const mql = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.add(l),
    removeEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.delete(l),
  }
  vi.stubGlobal("matchMedia", () => mql)
  return {
    mql,
    fire: (next: boolean) => {
      mql.matches = next
      listeners.forEach((l) => l({ matches: next } as MediaQueryListEvent))
    },
  }
}

describe("useReducedMotion", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("is false when the user has expressed no preference", () => {
    mockMatchMedia(false)
    expect(renderHook(() => useReducedMotion()).result.current).toBe(false)
  })

  it("is true when the user prefers reduced motion", () => {
    mockMatchMedia(true)
    expect(renderHook(() => useReducedMotion()).result.current).toBe(true)
  })

  it("reacts when the preference changes mid-session", () => {
    const { fire } = mockMatchMedia(false)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
    act(() => fire(true))
    expect(result.current).toBe(true)
  })

  it("defaults to REDUCED when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined)
    // Erring toward no motion is the safe default: a missed animation is a
    // cosmetic loss, an unwanted one can cause real harm.
    expect(renderHook(() => useReducedMotion()).result.current).toBe(true)
  })

  it("removes its listener on unmount", () => {
    const { mql } = mockMatchMedia(false)
    const spy = vi.spyOn(mql, "removeEventListener")
    renderHook(() => useReducedMotion()).unmount()
    expect(spy).toHaveBeenCalled()
  })
})
