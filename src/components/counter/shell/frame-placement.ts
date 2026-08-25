"use client"

import { useLayoutEffect, useState, type RefObject } from "react"

/**
 * Note 21: "A popover that leaves its frame is broken, not clever."
 *
 * Ported verbatim from the prototype's own `place()` function
 * (docs/counter/counter-prototype.html) rather than reinvented per control:
 * right-anchor by default, size to `clamp(minWidth, viewport - padding,
 * maxWidth)`, and — only when right-anchoring at that width would push the
 * left edge past `minLeft` from the viewport's own left edge — pin an
 * explicit `left` offset instead of the CSS default `right: 0`.
 *
 * `DateControl`'s range and comparison menus, and `StoreSwitcher`'s popover,
 * all import this rather than each carrying their own copy of the same
 * arithmetic. See docs/counter/controls-verification.md for the measured
 * boxes (1440/900/390px, both the range menu and the store popover) this
 * was verified against in a real browser — jsdom reports zero-sized boxes
 * for every element, so none of this is provable in a unit test.
 */

export interface FramePlacement {
  width: number
  /** null means the CSS default (right-aligned to the trigger, `right: 0`). Set only when that would overflow the viewport's left edge. */
  left: number | null
}

export const DEFAULT_FRAME_PLACEMENT: FramePlacement = { width: 280, left: null }

/** Mirrors the prototype's own frame padding and clamp bounds. */
const MAX_WIDTH = 438
const MIN_WIDTH = 280
const FRAME_PADDING = 24
const MIN_LEFT = 10

export function computeFramePlacement(
  triggerRect: DOMRect,
  viewportWidth: number,
  bounds: { maxWidth?: number; minWidth?: number } = {},
): FramePlacement {
  const maxWidth = bounds.maxWidth ?? MAX_WIDTH
  const minWidth = bounds.minWidth ?? MIN_WIDTH
  const width = Math.min(maxWidth, Math.max(minWidth, viewportWidth - FRAME_PADDING))
  const rightAlignedLeft = triggerRect.right - width
  if (rightAlignedLeft < MIN_LEFT) {
    return { width, left: MIN_LEFT - triggerRect.left }
  }
  return { width, left: null }
}

/** Recomputes placement each time the menu opens — the same moment the prototype's `place(dr)` runs. */
export function useFramePlacement(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  bounds?: { maxWidth?: number; minWidth?: number },
): FramePlacement {
  const [placement, setPlacement] = useState<FramePlacement>(DEFAULT_FRAME_PLACEMENT)
  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    if (!trigger) return
    setPlacement(computeFramePlacement(trigger.getBoundingClientRect(), window.innerWidth, bounds))
    // Deliberately NOT depending on `bounds` — callers pass an inline object
    // literal, and re-running this on every render (rather than only when
    // `open`/`triggerRef` change) would defeat the "recompute once, at the
    // moment the menu opens" contract the doc comment above describes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, triggerRef])
  return placement
}
