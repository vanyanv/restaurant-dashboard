"use client"

type Props = {
  /** Desktop path to hard-navigate to after the cookie is set. Defaults to
   *  the dashboard home, matching this button's original behavior on the
   *  More page. */
  target?: string
  /** Button copy — callers driving a specific page's handoff (P&L, Labor)
   *  want their own phrasing instead of the generic More-page label. */
  label?: string
}

export function SwitchToDesktopButton({
  target = "/dashboard",
  label = "Switch to desktop view →",
}: Props = {}) {
  function setCookieAndGo() {
    // 7-day prefer-desktop cookie. Middleware reads this and skips the
    // /dashboard → /m redirect for the duration.
    const seconds = 60 * 60 * 24 * 7
    document.cookie = `prefer-desktop=1; Max-Age=${seconds}; Path=/; SameSite=Lax`
    window.location.href = target
  }
  return (
    <button type="button" className="m-toolbar-btn" onClick={setCookieAndGo}>
      {label}
    </button>
  )
}
