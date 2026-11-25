import { flushSync } from "react-dom"
import type { KeyboardEvent, MouseEvent } from "react"

/**
 * The keyboard half of the menu, tabs and radio roles.
 *
 * A role is a promise: `role="menu"` tells a screen reader the arrow keys
 * work. Until 2026-11-24 the Ask and People menus, the People and Restock
 * tabs, the theme toggle and "Start from" all made that promise and kept none
 * of it. `focusgroup` will do this natively; it is not Baseline yet, so this
 * is its fallback: one tab stop per group, moved with the arrow keys.
 *
 * Plain functions over the DOM rather than hooks: nothing here is state. The
 * component owns `open` and which item is picked.
 */

/** The item an arrow, Home or End key lands on, or null when the key is not ours. */
function target(e: KeyboardEvent<HTMLElement>, selector: string, back: string[], forward: string[]): HTMLElement | null {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null
  const all = [...e.currentTarget.querySelectorAll<HTMLElement>(selector)].filter((x) => !x.matches(":disabled"))
  if (all.length === 0) return null
  const at = all.findIndex((x) => x.contains(e.target as Node))
  if (e.key === "Home") return all[0]
  if (e.key === "End") return all[all.length - 1]
  if (forward.includes(e.key)) return all[(at + 1) % all.length]
  if (back.includes(e.key)) return all[(Math.max(at, 0) - 1 + all.length) % all.length]
  return null
}

function moveAndPick(e: KeyboardEvent<HTMLElement>, selector: string, back: string[], forward: string[]) {
  const to = target(e, selector, back, forward)
  if (!to) return
  e.preventDefault()
  to.focus()
  to.click()
}

/** `onKeyDown` for a `role="tablist"`. Each tab's `tabIndex` is 0 when selected, else -1. */
export function tabKeys(e: KeyboardEvent<HTMLElement>) {
  moveAndPick(e, '[role="tab"]', ["ArrowLeft"], ["ArrowRight"])
}

/** `onKeyDown` for a `role="radiogroup"`. Each radio's `tabIndex` is 0 when checked, else -1. */
export function radioKeys(e: KeyboardEvent<HTMLElement>) {
  moveAndPick(e, '[role="radio"]', ["ArrowLeft", "ArrowUp"], ["ArrowRight", "ArrowDown"])
}

const firstItem = (menuId: string) =>
  document.getElementById(menuId)?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')

/**
 * Props for the button that opens a menu. Opening with the keyboard enters the
 * menu; a pointer click opens it and leaves focus on the button.
 */
export function menuTrigger({
  open,
  setOpen,
  menuId,
}: {
  open: boolean
  setOpen: (open: boolean) => void
  menuId: string
}) {
  const enter = () => {
    // The items must exist and be visible before they can take focus.
    flushSync(() => setOpen(true))
    firstItem(menuId)?.focus()
  }
  return {
    "aria-haspopup": "menu" as const,
    "aria-expanded": open,
    onClick: (e: MouseEvent<HTMLElement>) => {
      // `detail` is 0 for Enter and Space, 1 or more for a press.
      if (!open && e.detail === 0) enter()
      else setOpen(!open)
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        enter()
      } else if (e.key === "Tab" && open) {
        setOpen(false)
      }
    },
  }
}

/** `onKeyDown` for the `role="menu"` itself. Its items are `tabIndex={-1}`. */
export function menuKeys(e: KeyboardEvent<HTMLElement>, { close, triggerId }: { close: () => void; triggerId: string }) {
  if (e.key === "Escape" || e.key === "Tab") {
    // Focus goes back to the button first, so Tab carries on from there and
    // Escape never leaves focus inside something hidden.
    document.getElementById(triggerId)?.focus()
    close()
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
    }
    return
  }
  const to = target(e, '[role="menuitem"]', ["ArrowUp"], ["ArrowDown"])
  if (!to) return
  e.preventDefault()
  to.focus()
}
