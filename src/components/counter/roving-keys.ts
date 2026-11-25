import type { KeyboardEvent } from "react"

const NEXT = new Set(["ArrowDown", "ArrowRight"])
const PREV = new Set(["ArrowUp", "ArrowLeft"])

/**
 * Arrow, Home and End move focus between the `selector` items inside the
 * element the handler sits on: the keyboard half of a menu or a radio group.
 * With `select`, the newly focused item is also clicked, so a radio group's
 * choice follows focus as the ARIA pattern expects.
 */
export function rovingKeyDown(
  e: KeyboardEvent<HTMLElement>,
  selector: string,
  { select = false }: { select?: boolean } = {},
): void {
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(selector))
  if (items.length === 0) return
  const at = items.indexOf(document.activeElement as HTMLElement)
  let to: number
  if (NEXT.has(e.key)) to = at < 0 ? 0 : (at + 1) % items.length
  else if (PREV.has(e.key)) to = at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length
  else if (e.key === "Home") to = 0
  else if (e.key === "End") to = items.length - 1
  else return
  e.preventDefault()
  items[to].focus()
  if (select) items[to].click()
}

/** Puts focus on the first menu item once a menu has opened. */
export function focusFirstItem(menu: HTMLElement | null): void {
  menu?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
}
