"use client"

import { useEffect, useRef } from "react"

/**
 * Asks before throwing away unsaved edits. Two exits are covered:
 *
 *  - closing the tab, reloading, or typing another address — the browser's
 *    own "Leave site?" prompt (`beforeunload`; browsers show their own text);
 *  - a link inside the app (rail, tabs, back links) — Next's `<Link>` is a
 *    plain `<a>`, so a capture-phase click listener sees it before the router
 *    does and can stop it.
 *
 * Only while `dirty` is true; a page with nothing unsaved is never slowed.
 * Links that stay on the same path (a `?store=` switch, a `#` jump) and links
 * opening a new tab are let through.
 */
export const LEAVE_MESSAGE = "You have changes that aren't saved. Leave without saving?"

export function useLeaveGuard(dirty: boolean, message = LEAVE_MESSAGE) {
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  useEffect(() => {
    if (!dirty) return

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      e.preventDefault()
      e.returnValue = ""
    }

    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || e.defaultPrevented) return
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return
      let url: URL
      try {
        url = new URL(a.href, window.location.href)
      } catch {
        return
      }
      if (url.origin === window.location.origin && url.pathname === window.location.pathname) return
      if (!window.confirm(message)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    window.addEventListener("beforeunload", onBeforeUnload)
    document.addEventListener("click", onClick, true)
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload)
      document.removeEventListener("click", onClick, true)
    }
  }, [dirty, message])
}
