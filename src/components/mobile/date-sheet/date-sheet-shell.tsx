"use client"

import { useEffect, useRef, type ReactNode } from "react"

type Props = {
  open: boolean
  onClose: () => void
  /** Caps cap shown in the header, e.g. "DATE RANGE". */
  dept: string
  children: ReactNode
  footer: ReactNode
}

export function DateSheetShell({ open, onClose, dept, children, footer }: Props) {
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)

    // iOS Safari: setting body overflow alone doesn't stop momentum scroll.
    // Pin scroll position with position:fixed and restore on cleanup.
    const scrollY = window.scrollY
    const prev = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    }
    document.body.style.overflow = "hidden"
    document.body.style.position = "fixed"
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = "100%"

    // Move focus into the sheet so Escape works without prior Tab.
    closeBtnRef.current?.focus()

    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev.overflow
      document.body.style.position = prev.position
      document.body.style.top = prev.top
      document.body.style.width = prev.width
      window.scrollTo(0, scrollY)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <div className="m-sheet__backdrop" onClick={onClose} aria-hidden />
      <div
        className="m-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={dept}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="m-sheet__head">
          <span className="m-sheet__head-left">
            <span className="m-sheet__proofmark" aria-hidden />
            <span className="m-cap">{dept}</span>
          </span>
          <button
            type="button"
            ref={closeBtnRef}
            className="m-sheet__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="m-sheet__body">{children}</div>
        <div className="m-sheet__foot">{footer}</div>
      </div>
    </>
  )
}
