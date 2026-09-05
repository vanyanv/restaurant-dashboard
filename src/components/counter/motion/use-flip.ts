"use client"

import { useLayoutEffect, useRef, type RefObject } from "react"
import { useReducedMotion } from "./use-reduced-motion"

export const FLIP_MS = 220

/**
 * Rows travel to their new places instead of being redrawn there (D11).
 *
 * First, Last, Invert, Play, on the children of `host` that carry
 * `data-flip-key`: before a re-render their tops are remembered; after it,
 * any row whose top moved is offset back to where it was by a transform and
 * released on the next frame, so the eye watches it go. Transform only,
 * because layout has already happened by the time this runs, over `FLIP_MS`
 * on the design's one ease. A row that did not move gets nothing.
 *
 * `dep` is whatever changes when the rows change (their joined keys); the
 * measurement is taken on every change and compared, so the hook is correct
 * even when `dep` changes and nothing moved. Reduced motion measures nothing.
 */
export function useFlip(host: RefObject<HTMLElement | null>, dep: string): void {
  const reduced = useReducedMotion()
  const tops = useRef<Map<string, number>>(new Map())

  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const rows = Array.from(el.querySelectorAll<HTMLElement>("[data-flip-key]"))
    const before = tops.current
    const after = new Map<string, number>()
    for (const r of rows) {
      after.set(r.dataset.flipKey ?? "", r.getBoundingClientRect().top)
    }
    tops.current = after
    if (reduced || before.size === 0) return

    const moved: HTMLElement[] = []
    for (const r of rows) {
      const key = r.dataset.flipKey ?? ""
      const was = before.get(key)
      const now = after.get(key)
      if (was === undefined || now === undefined) continue
      const dy = was - now
      if (Math.abs(dy) < 1) continue
      r.style.transition = "none"
      r.style.transform = `translateY(${dy}px)`
      moved.push(r)
    }
    if (moved.length === 0) return
    // Force the inverted position to paint before releasing it.
    void el.getBoundingClientRect()
    const raf = requestAnimationFrame(() => {
      for (const r of moved) {
        r.style.transition = `transform ${FLIP_MS}ms var(--ct-ease)`
        r.style.transform = ""
      }
    })
    const done = setTimeout(() => {
      for (const r of moved) {
        r.style.transition = ""
        r.style.transform = ""
      }
    }, FLIP_MS + 40)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(done)
    }
  }, [host, dep, reduced])
}
