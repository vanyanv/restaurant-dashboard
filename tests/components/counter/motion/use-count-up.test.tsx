// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, render } from "@testing-library/react"
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

  // docs/counter/motion-verification.md: a real no-preference browser found
  // the server (always "reduced" — no matchMedia) and the client's first
  // render disagreeing, which React reports as a hydration failure and
  // recovers from by discarding and regenerating the whole subtree.
  it("renders the target on the very first render, regardless of motion preference — the hydration-safety property", () => {
    for (const reduced of [true, false]) {
      setReducedMotion(reduced)
      const values: number[] = []
      function Harness({ target }: { target: number }) {
        const display = useCountUp(target)
        values.push(display) // captured during render, before any effect runs
        return <div>{display}</div>
      }
      render(<Harness target={7468} />)
      // The FIRST push is what React's render phase produced before the
      // mount effect ever ran — exactly what SSR (no effects at all) would
      // also have produced. It must equal the target either way, or a real
      // no-preference client mismatches the server's SSR text.
      expect(values[0]).toBe(7468)
    }
  })

  // docs/counter/motion-verification.md: measured directly in a browser —
  // a remounted animation's first requestAnimationFrame callback fired with
  // a `now` of 115.7ms against a `start` of 125.5ms, i.e. BEFORE it. The
  // unclamped ease-out turned that negative `elapsed` into a displayed
  // value of -542 / -664. Reproduce the exact condition (a backwards rAF
  // timestamp), not an approximation of it.
  it("clamps a rAF timestamp that arrives before the captured start, instead of painting a value outside [start, target]", () => {
    vi.useRealTimers()
    setReducedMotion(false)
    let rafCallback: FrameRequestCallback | null = null
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCallback = cb
      return 1
    })
    vi.stubGlobal("cancelAnimationFrame", () => {})

    const { result } = renderHook(() => useCountUp(7468))
    // The mount effect's one settled-then-reset frame: display moves to
    // `from` (0) synchronously, before the first rAF tick ever runs.
    expect(result.current).toBe(0)

    // A timestamp far earlier than any real `start` (performance.now() at
    // effect-time is always positive during a running process) reproduces
    // the measured "now < start" condition exactly.
    act(() => {
      rafCallback?.(-1)
    })

    expect(result.current).toBe(0)
    expect(result.current).toBeGreaterThanOrEqual(0)
    expect(result.current).toBeLessThanOrEqual(7468)
  })
})
