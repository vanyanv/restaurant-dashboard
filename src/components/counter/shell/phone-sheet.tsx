"use client"

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react"

/**
 * `.pshade` + `.msheet` — the phone's bottom sheet, and the ONE place the two
 * divergences it needs are written down.
 *
 * The prototype composes this shape twice inside `CD.sheet()` (line 1945) and
 * styles it in three rules (counter-components.css:983–991):
 *
 * ```
 * <div class="pshade" data-mclose></div>
 * <div class="msheet"><span class="msheet__grab"></span><h4>…</h4> … </div>
 * ```
 *
 * Both are always in the DOM; `.on` shows them. That is the prototype's own
 * choice and it is kept — the open state is a class, not a mount, so the
 * sheet's children keep their state across an open/close and there is no
 * mount cost on the first tap.
 *
 * ## The two divergences, both about the shell this route still lives in
 *
 * 1. **`position: fixed`, not `absolute`.** `.msheet` and `.pshade` are
 *    positioned against `.pframe`, a 718px-tall bezel that never scrolls.
 *    `/m` is a document that does. Left `absolute`, the sheet would anchor to
 *    the bottom of the whole scrolled page, so a reader who opened it from the
 *    top would see nothing happen. `fixed` is what "absolute inside a fixed
 *    bezel" MEANS once the bezel is a real phone.
 *
 * 2. **A z-index above `.m-tabbar`.** The prototype's 15/20 are relative to a
 *    bezel with nothing overlaying it: `.mtabs` is an in-flow sibling and the
 *    sheet's `bottom:0` covers it — which is the behaviour being preserved,
 *    not changed. The editorial mobile shell that still wraps this route pins
 *    its tab bar at `position:fixed; z-index:40`, so both are raised past it,
 *    keeping the prototype's own order (shade under sheet). These two numbers
 *    go away with the shell when the phone is rebuilt on Counter.
 *
 * Neither is a colour and neither is a layout the design decided differently;
 * they are the cost of mounting a bezel's furniture in a scrolling document.
 */
const SHEET_STYLE: CSSProperties = { position: "fixed", zIndex: 42 }
const SHADE_STYLE: CSSProperties = { position: "fixed", zIndex: 41 }

export function PhoneSheet({
  open,
  onClose,
  title,
  id,
  children,
}: {
  open: boolean
  onClose: () => void
  /** The sheet's `<h4>`, and its accessible name. */
  title: string
  /** So the trigger can `aria-controls` it. */
  id: string
  children: ReactNode
}) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  // Escape closes without choosing anything — the same contract `DateControl`
  // and `StoreSwitcher` keep on the desk. The prototype has no key handling at
  // all here; a sheet a keyboard cannot dismiss is a trap, and a phone in a
  // browser still has a keyboard on it more often than the bezel suggests.
  useEffect(() => {
    const sheet = sheetRef.current
    if (!open || !sheet) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusable = () => Array.from(sheet.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    )).filter((el) => !el.closest('[hidden], [inert], [aria-hidden="true"]'))
    const focusFirst = () => (focusable()[0] ?? sheet).focus()
    // Mark background branches inert, leaving the dismissing shade clickable.
    const background: Array<[HTMLElement, boolean]> = []
    let branch: HTMLElement = sheet
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (!(sibling instanceof HTMLElement) || sibling === branch || sibling.classList.contains("pshade")) continue
        background.push([sibling, sibling.inert])
        sibling.inert = true
      }
      branch = branch.parentElement
      if (branch === document.body) break
    }
    focusFirst()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        closeRef.current()
      }
      if (e.key === "Tab") {
        const items = focusable()
        const first = items[0] ?? sheet
        const last = items.at(-1) ?? sheet
        if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet)) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && (document.activeElement === last || document.activeElement === sheet)) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    const onFocus = (e: FocusEvent) => {
      if (!sheet.contains(e.target as Node)) focusFirst()
    }
    document.addEventListener("keydown", onKeyDown, true)
    document.addEventListener("focusin", onFocus)
    return () => {
      document.removeEventListener("keydown", onKeyDown, true)
      document.removeEventListener("focusin", onFocus)
      for (const [element, inert] of background) element.inert = inert
      if (previous?.isConnected) previous.focus()
    }
  }, [open])

  return (
    <>
      <div
        className={open ? "pshade on" : "pshade"}
        style={SHADE_STYLE}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={open ? "msheet on" : "msheet"}
        style={SHEET_STYLE}
        id={id}
        ref={sheetRef}
        tabIndex={-1}
        inert={!open}
        aria-hidden={!open}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <span className="msheet__grab" />
        <h4>{title}</h4>
        {children}
      </div>
    </>
  )
}
