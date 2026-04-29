"use client"

export function SwitchToDesktopButton() {
  function setCookieAndGo() {
    // 7-day prefer-desktop cookie. Middleware reads this and skips the
    // /dashboard → /m redirect for the duration.
    const seconds = 60 * 60 * 24 * 7
    document.cookie = `prefer-desktop=1; Max-Age=${seconds}; Path=/; SameSite=Lax`
    window.location.href = "/dashboard"
  }
  return (
    <button type="button" className="toolbar-btn" onClick={setCookieAndGo}>
      Switch to desktop view →
    </button>
  )
}
