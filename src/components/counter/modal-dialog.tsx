"use client"

import { useLayoutEffect, useRef, type ComponentPropsWithoutRef } from "react"

/**
 * The browser's own modal `<dialog>`, opened with `showModal()`.
 *
 * Every pop-up, sheet and lightbox in the app goes through this, so none of
 * them hand-builds what the platform already does: the dialog sits in the top
 * layer (above every z-index, never clipped by a parent), the page behind it is
 * inert, Tab stays inside, Escape and the Android back gesture ask it to close,
 * and focus goes back to whatever opened it. The modern-web-guidance `dialog`
 * guide is the rule: no `role="dialog"`, no `aria-modal`, no focus trap, no
 * Escape listener, no `overflow: hidden` on `<body>`.
 *
 * The class you pass keeps drawing the look. `.ct-dialog` (counter-components
 * .css) only strips the browser's default dialog box at zero specificity, so a
 * class like `.ckc__sheet` that paints its own full-screen scrim is still the
 * whole picture, and `::backdrop` stays clear.
 *
 * Two ways to use it:
 *  - mounted only while open (`{open && <ModalDialog …/>}`): leave `open` out;
 *  - always mounted (the Ask palette, which keeps child state):
 *    pass `open`.
 *
 * `onClose` runs when the browser asks to close (Escape, back gesture). Leave
 * it out to refuse, as the photo sheet does while an upload is running. Clicks
 * on a scrim stay with the caller's own `onClick`, which works in every
 * browser, unlike `closedby="any"` (no Safari yet).
 */
export function ModalDialog({
  open = true,
  onClose,
  className,
  children,
  ...rest
}: Omit<ComponentPropsWithoutRef<"dialog">, "open" | "onClose" | "onCancel"> & {
  open?: boolean
  onClose?: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const closeRef = useRef(onClose)
  const wantOpen = useRef(open)
  useLayoutEffect(() => {
    closeRef.current = onClose
    wantOpen.current = open
  })

  useLayoutEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      if (typeof d.showModal === "function") d.showModal()
      else d.setAttribute("open", "")
    } else if (!open && d.open) {
      close(d)
    }
  }, [open])

  // Closing before React removes the node is what hands focus back to the
  // button that opened it; a dialog that is only detached returns it nowhere.
  useLayoutEffect(() => {
    const d = ref.current
    return () => {
      wantOpen.current = false
      if (d?.open) close(d)
    }
  }, [])

  return (
    <dialog
      ref={ref}
      className={className ? `ct-dialog ${className}` : "ct-dialog"}
      onCancel={(e) => {
        // React's state decides when it closes, not the browser.
        e.preventDefault()
        closeRef.current?.()
      }}
      onClose={(e) => {
        // A browser may still close it on a repeated Escape with no tap in
        // between. If the app still wants it open, tell the app, or reopen it
        // when it has no way to close (an upload in progress).
        //
        // The event is queued, so it can land after the dialog was opened
        // again: React's development double-mount closes it in the unmount
        // pass and reopens it in the next. A dialog that is open when its
        // close event arrives was not closed by the browser; acting on the
        // stale event used to shut every sheet the moment it opened.
        const d = e.currentTarget
        if (!wantOpen.current || d.open) return
        if (closeRef.current) closeRef.current()
        else if (typeof d.showModal === "function" && d.isConnected) d.showModal()
      }}
      {...rest}
    >
      {children}
    </dialog>
  )
}

function close(d: HTMLDialogElement) {
  if (typeof d.close === "function") d.close()
  else d.removeAttribute("open")
}
