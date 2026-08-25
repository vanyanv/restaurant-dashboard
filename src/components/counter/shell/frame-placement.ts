"use client"

import { useLayoutEffect, useState, type RefObject } from "react"

/**
 * Note 21: "A popover that leaves its frame is broken, not clever."
 *
 * Ported from the prototype's own `place()` (docs/counter/counter-prototype.html
 * line ~1990) rather than reinvented per control: right-anchor by default, size
 * to `clamp(minWidth, viewport - padding, maxWidth)`, and — only when
 * right-anchoring at that width would push the left edge past `minLeft` from the
 * viewport's own left edge — pin an explicit `left` offset instead of the CSS
 * default `right: 0`, and add `.is-clamped` so `right:auto` takes over.
 *
 * TWO THINGS THIS DID NOT PORT, AND NOW DOES (task 5):
 *
 *   1. SHEET MODE. `place()`'s very first act, after clearing what it set last
 *      time, is `if (window.matchMedia('(max-width:640px)').matches) return` —
 *      because below 640px `.drpop` stops being an anchored popover and becomes
 *      a bottom sheet: `position:fixed; left:10px; right:10px; bottom:10px;
 *      width:auto` (counter-components.css, the `@media (max-width:640px)`
 *      block). An inline `left` computed against the TRIGGER is viewport-relative
 *      once the element is `fixed`, so `MIN_LEFT - triggerRect.left` — a
 *      negative number for any trigger more than 10px from the left edge — would
 *      push the sheet off the left of a 390px screen. `sheetBelow` is that early
 *      return, and a placement with `width: null` means "position nothing, the
 *      stylesheet has this".
 *   2. RESIZE. The prototype re-places every open `.dr` on `window.resize`.
 *      Without it a popover opened at 1440 and then narrowed keeps a width
 *      wider than the window.
 *
 * The one consumer is `DateControl`. `StoreSwitcher` deliberately does NOT use
 * it any more: `.storepop` is pinned by the ported sheet to `left:10px;
 * right:10px` inside the rail's own relatively-positioned wrapper, so it can
 * never leave the rail, and the prototype's `place()` is likewise only ever
 * called on `.drpop` (`dr.querySelector('.drpop')`) — never on the store
 * popover. See docs/counter/controls-verification.md for the real-browser
 * measurements; jsdom reports zero-sized boxes for every element, so none of
 * this is provable in a unit test.
 */

export interface FramePlacement {
  /** null means "leave the width to CSS" — sheet mode, below `sheetBelow`. */
  width: number | null
  /** null means the CSS default (right-aligned to the trigger, `right: 0`). */
  left: number | null
}

/** Nothing positioned: what a closed popover, and a sheet-mode one, get. */
export const DEFAULT_FRAME_PLACEMENT: FramePlacement = { width: null, left: null }

/** Mirrors the prototype's own frame padding and clamp bounds. */
const MAX_WIDTH = 438
const MIN_WIDTH = 280
const FRAME_PADDING = 24
const MIN_LEFT = 10

export interface FrameBounds {
  maxWidth?: number
  minWidth?: number
  /**
   * At or below this viewport width the stylesheet turns the popover into a
   * bottom sheet and positioning it from JS is actively harmful. The
   * prototype's own threshold is 640px.
   */
  sheetBelow?: number
}

export function computeFramePlacement(
  triggerRect: DOMRect,
  viewportWidth: number,
  bounds: FrameBounds = {},
): FramePlacement {
  if (bounds.sheetBelow != null && viewportWidth <= bounds.sheetBelow) {
    return DEFAULT_FRAME_PLACEMENT
  }
  const maxWidth = bounds.maxWidth ?? MAX_WIDTH
  const minWidth = bounds.minWidth ?? MIN_WIDTH
  const width = Math.min(maxWidth, Math.max(minWidth, viewportWidth - FRAME_PADDING))
  const rightAlignedLeft = triggerRect.right - width
  if (rightAlignedLeft < MIN_LEFT) {
    return { width, left: MIN_LEFT - triggerRect.left }
  }
  return { width, left: null }
}

/**
 * Recomputes placement each time the menu opens — the same moment the
 * prototype's `place(dr)` runs — and again on resize, which it also does.
 */
export function useFramePlacement(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  bounds?: FrameBounds,
): FramePlacement {
  const [placement, setPlacement] = useState<FramePlacement>(DEFAULT_FRAME_PLACEMENT)
  useLayoutEffect(() => {
    if (!open) {
      setPlacement(DEFAULT_FRAME_PLACEMENT)
      return
    }
    const measure = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      setPlacement(computeFramePlacement(trigger.getBoundingClientRect(), window.innerWidth, bounds))
    }
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
    // Deliberately NOT depending on `bounds` — callers pass an inline object
    // literal, and re-running this on every render (rather than only when
    // `open`/`triggerRef` change) would defeat the "recompute at the moment the
    // menu opens" contract the doc comment above describes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, triggerRef])
  return placement
}
