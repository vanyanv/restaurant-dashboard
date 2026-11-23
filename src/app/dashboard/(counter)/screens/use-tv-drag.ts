"use client"

import { useEffect, useEffectEvent } from "react"

export type DragItem = { kind: "pic" | "tv" | "slide"; id: string }

const ITEM = "data-sc-drag"
const DROP = "data-sc-drop"

function read(el: Element | null, attr: string): [string, string] | null {
  const raw = el?.closest(`[${attr}]`)?.getAttribute(attr)
  if (!raw) return null
  const at = raw.indexOf(":")
  return at < 0 ? [raw, ""] : [raw.slice(0, at), raw.slice(at + 1)]
}

/**
 * Drag a picture (or a whole TV) onto a TV, and files from the computer too.
 *
 * Mark what can be picked up `data-sc-drag="pic:ID"` and where it can land
 * `data-sc-drop="tv:ID"`. The page stays still while dragging: a small copy
 * follows the pointer and the place it would land lights up. Mouse and pen
 * only; on a touch screen a tap picks a picture and another tap places it,
 * which is also the keyboard's way (see ScreensClient), so nothing here is
 * the only way to do something. A slide in the TV panel drags on touch as
 * well, by its picture.
 *
 * The listeners sit on the document: React may replace the dragged node, and
 * a replaced node drops its pointer capture.
 */
export function useTvDrag(opts: {
  /** What this caller picks up: the board takes pictures and TVs, an open TV its slides. */
  slides?: boolean
  enabled: boolean
  onDrop: (item: DragItem, to: [kind: string, id: string]) => void
  onFiles?: (files: File[], to: [kind: string, id: string] | null) => void
}) {
  const drop = useEffectEvent(opts.onDrop)
  const files = useEffectEvent((list: File[], to: [string, string] | null) => opts.onFiles?.(list, to))
  const enabled = useEffectEvent(() => opts.enabled)
  const slides = useEffectEvent(() => opts.slides ?? false)

  useEffect(() => {
    const root = document.documentElement
    const ac = new AbortController()
    const on = { signal: ac.signal }
    let held: { item: DragItem; from: Element; pointer: number; x: number; y: number; ghost: HTMLElement | null } | null = null
    let dragged = false
    let fileTimer: ReturnType<typeof setTimeout> | undefined

    const unlight = () => document.querySelectorAll("[data-sc-hit]").forEach((n) => n.removeAttribute("data-sc-hit"))
    const light = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y)?.closest(`[${DROP}]`) ?? null
      if (el?.hasAttribute("data-sc-hit")) return el
      unlight()
      el?.setAttribute("data-sc-hit", "")
      return el
    }
    const rest = () => {
      delete root.dataset.scDragging
      unlight()
    }
    const end = (at: { clientX: number; clientY: number } | null) => {
      const h = held
      held = null
      if (!h?.ghost) return
      h.ghost.remove()
      const to = at ? read(light(at.clientX, at.clientY), DROP) : null
      rest()
      // The click that follows the drop belongs to the drag.
      dragged = true
      setTimeout(() => (dragged = false), 0)
      if (to) drop(h.item, to)
    }

    document.addEventListener(
      "pointerdown",
      (e) => {
        dragged = false
        if (e.button !== 0 || held || !(e.target instanceof Element)) return
        const from = e.target.closest(`[${ITEM}]`)
        const got = read(from, ITEM)
        if (!from || !got) return
        const kind = got[0] as DragItem["kind"]
        if ((kind === "slide") !== slides() || !enabled()) return
        if (kind !== "slide" && e.pointerType === "touch") return
        held = { item: { kind, id: got[1] }, from, pointer: e.pointerId, x: e.clientX, y: e.clientY, ghost: null }
      },
      on,
    )
    document.addEventListener(
      "pointermove",
      (e) => {
        if (!held || e.pointerId !== held.pointer) return
        if (!held.ghost) {
          if (Math.hypot(e.clientX - held.x, e.clientY - held.y) < 5) return
          const face = held.from.querySelector(".sc-face")
          if (!face) {
            held = null
            return
          }
          const ghost = document.createElement("div")
          ghost.className = "sc-ghost"
          ghost.append(face.cloneNode(true))
          ;(held.from.closest("dialog") ?? document.body).append(ghost)
          held.ghost = ghost
          root.dataset.scDragging = held.item.kind
        }
        e.preventDefault()
        held.ghost.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 16}px)`
        light(e.clientX, e.clientY)
        const edge = 70
        if (held.item.kind !== "slide") {
          if (e.clientY < edge) window.scrollBy(0, -14)
          else if (e.clientY > window.innerHeight - edge) window.scrollBy(0, 14)
        }
      },
      { ...on, passive: false },
    )
    document.addEventListener("pointerup", (e) => held && e.pointerId === held.pointer && end(e), on)
    document.addEventListener("pointercancel", (e) => held && e.pointerId === held.pointer && end(null), on)
    document.addEventListener("keydown", (e) => e.key === "Escape" && held?.ghost && (e.preventDefault(), end(null)), { ...on, capture: true })
    document.addEventListener(
      "click",
      (e) => {
        if (!dragged) return
        dragged = false
        e.preventDefault()
        e.stopPropagation()
      },
      { ...on, capture: true },
    )
    document.addEventListener("dragstart", (e) => e.target instanceof Element && e.target.closest(".sc, .sc-dlg") && e.preventDefault(), on)

    const isFiles = (e: DragEvent) => Boolean(e.dataTransfer && [...e.dataTransfer.types].includes("Files"))
    document.addEventListener(
      "dragover",
      (e) => {
        if (!isFiles(e) || slides()) return
        // Refused while a dialog is open, but never opened in the tab.
        e.preventDefault()
        if (!enabled()) return
        root.dataset.scDragging = "pic"
        light(e.clientX, e.clientY)
        clearTimeout(fileTimer)
        fileTimer = setTimeout(rest, 400)
      },
      on,
    )
    document.addEventListener(
      "drop",
      (e) => {
        if (!isFiles(e) || !e.dataTransfer || slides()) return
        e.preventDefault()
        clearTimeout(fileTimer)
        const to = enabled() ? read(light(e.clientX, e.clientY), DROP) : null
        rest()
        if (enabled()) files([...e.dataTransfer.files], to)
      },
      on,
    )
    return () => {
      ac.abort()
      clearTimeout(fileTimer)
      held?.ghost?.remove()
      rest()
    }
  }, [])
}
