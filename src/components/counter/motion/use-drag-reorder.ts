"use client"

import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react"
import { flushSync } from "react-dom"

/** Where a row dragged `dy` pixels from slot `from` would land, given every row's top and height. */
export function dropIndex(rows: { top: number; height: number }[], from: number, dy: number): number {
  const mid = rows[from].top + rows[from].height / 2 + dy
  let to = 0
  rows.forEach((r, i) => {
    if (i !== from && r.top + r.height / 2 < mid) to += 1
  })
  return to
}

/** How far row `i` steps aside while the row from `from` hovers over slot `to`. */
export function shiftFor(i: number, from: number, to: number, step: number): number {
  if (i === from) return 0
  if (from < i && i <= to) return -step
  if (to <= i && i < from) return step
  return 0
}

/**
 * Drag a row to a new place in its list.
 *
 * Mark each row `data-reorder-row` (siblings under one parent) and spread
 * `grip(index, onMove)` on a button inside it (the `Grip` block). While a row is held, it follows the
 * pointer and the others step aside with transforms only; the list itself
 * is reordered once, on the drop, through `onMove(from, to)`. The arrow keys
 * on the grip move the row one place, so nothing needs a pointer.
 *
 * The listeners sit on the window for the length of the drag: React moves
 * DOM nodes when keyed rows change order, and a moved node drops its pointer
 * capture.
 */
export function useDragReorder() {
  // The held row's full clean-up (transforms, marks, listeners), so a second
  // drag, a key press or an unmount can end it properly.
  const end = useRef<(() => void) | null>(null)
  useEffect(() => () => end.current?.(), [])

  const rowsOf = (el: Element) => {
    const row = el.closest<HTMLElement>("[data-reorder-row]")
    const all = row?.parentElement ? [...row.parentElement.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.hasAttribute("data-reorder-row")) : []
    return { row, all }
  }

  const grip = (index: number, onMove: (from: number, to: number) => void) => ({
    "data-reorder-grip": "",
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return
      const { row, all } = rowsOf(e.currentTarget)
      if (!row || all.length < 2) return
      e.preventDefault()
      const rects = all.map((r) => {
        const b = r.getBoundingClientRect()
        return { top: b.top, height: b.height }
      })
      const gap = all.length > 1 ? Math.max(0, rects[1].top - (rects[0].top + rects[0].height)) : 0
      const step = rects[index].height + gap
      const startY = e.clientY
      const pointer = e.pointerId
      let to = index
      end.current?.()
      row.dataset.dragging = ""
      row.parentElement!.dataset.reordering = ""
      const ac = new AbortController()
      const clear = () => {
        for (const r of all) r.style.transform = ""
        delete row.dataset.dragging
        delete row.parentElement?.dataset.reordering
        ac.abort()
        if (end.current === clear) end.current = null
      }
      end.current = clear
      // Only the finger or mouse that picked the row up moves or drops it.
      const mine = (ev: globalThis.PointerEvent) => ev.pointerId === pointer
      window.addEventListener(
        "pointermove",
        (ev) => {
          if (!mine(ev)) return
          const dy = ev.clientY - startY
          to = dropIndex(rects, index, dy)
          row.style.transform = `translateY(${dy}px)`
          all.forEach((r, i) => {
            if (i !== index) r.style.transform = `translateY(${shiftFor(i, index, to, step)}px)`
          })
        },
        { signal: ac.signal },
      )
      window.addEventListener(
        "pointerup",
        (ev) => {
          if (!mine(ev)) return
          // Commit the new order before the transforms come off, so no frame
          // shows the old order sitting in its resting places.
          if (to !== index) flushSync(() => onMove(index, to))
          clear()
        },
        { signal: ac.signal },
      )
      window.addEventListener("pointercancel", (ev) => mine(ev) && clear(), { signal: ac.signal })
      // The measured places are the screen's: if anything scrolls under a
      // held row they no longer hold, so the row is put back, not dropped wrong.
      window.addEventListener("scroll", clear, { signal: ac.signal, capture: true, passive: true })
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return
      const { row, all } = rowsOf(e.currentTarget)
      const to = index + (e.key === "ArrowUp" ? -1 : 1)
      if (!row || to < 0 || to >= all.length) return
      e.preventDefault()
      // A row still held by a pointer was measured against the old order.
      end.current?.()
      const parent = row.parentElement
      flushSync(() => onMove(index, to))
      // The row moved; put the focus back on its grip so the next press keeps moving it.
      const moved = parent ? [...parent.children].filter((c) => c.hasAttribute("data-reorder-row"))[to] : null
      moved?.querySelector<HTMLElement>("[data-reorder-grip]")?.focus()
    },
  })

  return { grip }
}
