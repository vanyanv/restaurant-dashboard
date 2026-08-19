// Scroll behaviour for the thread. The rule the old code broke: never fight a
// scroll-up. Auto-scroll is allowed only while the reader is already parked at
// the bottom; the moment they scroll back to re-read an earlier answer, new
// tokens must stop dragging them forward.

import { describe, it, expect } from "vitest"
import { isNearBottom, shouldAutoScroll, STICK_THRESHOLD_PX } from "@/lib/chat/thread-scroll"

const view = (scrollTop: number, clientHeight = 600, scrollHeight = 2000) => ({
  scrollTop,
  clientHeight,
  scrollHeight,
})

describe("isNearBottom", () => {
  it("is true when parked exactly at the bottom", () => {
    expect(isNearBottom(view(1400))).toBe(true)
  })

  it("is true inside the threshold", () => {
    expect(isNearBottom(view(1400 - (STICK_THRESHOLD_PX - 1)))).toBe(true)
  })

  it("is false once past the threshold", () => {
    expect(isNearBottom(view(1400 - (STICK_THRESHOLD_PX + 1)))).toBe(false)
  })

  it("is false when scrolled well up to re-read", () => {
    expect(isNearBottom(view(200))).toBe(false)
  })

  it("is true when the thread is shorter than its viewport", () => {
    expect(isNearBottom(view(0, 600, 400))).toBe(true)
  })

  it("tolerates sub-pixel scroll positions from a trackpad", () => {
    expect(isNearBottom(view(1399.6))).toBe(true)
  })
})

describe("shouldAutoScroll", () => {
  it("follows new content while the reader is at the bottom", () => {
    expect(shouldAutoScroll({ stuck: true, isStreaming: true })).toBe(true)
  })

  it("stops following the moment the reader scrolls up mid-answer", () => {
    expect(shouldAutoScroll({ stuck: false, isStreaming: true })).toBe(false)
  })

  it("still lands at the bottom for a settled thread the reader is parked on", () => {
    expect(shouldAutoScroll({ stuck: true, isStreaming: false })).toBe(true)
  })

  it("leaves a scrolled-up reader alone when a turn finishes", () => {
    expect(shouldAutoScroll({ stuck: false, isStreaming: false })).toBe(false)
  })

  it("always scrolls on a first mount, wherever the flags sit", () => {
    expect(shouldAutoScroll({ stuck: false, isStreaming: false, firstPaint: true })).toBe(true)
  })
})
