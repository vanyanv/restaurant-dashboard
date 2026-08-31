"use client"

/*
 * This file is ALONE in `src/app/(mobile)/m/more/` and the folder has no
 * `page.tsx`, so it is not a route — `/m/more` resolves to the Counter page in
 * `(counter)/more/`, which replaced the editorial one that used to sit beside
 * this.
 *
 * It stays here rather than moving to `src/components/mobile/` because
 * `/m/pnl/[storeId]` still imports it by this path, that page is still
 * editorial, and the `src/app/(mobile)/m` LEGACY exemption in
 * `scripts/counter-lint.ts` is keyed to file CONTENT: editing that page's
 * import line forfeits its exemption and fails `npm run tokens` on a
 * `no-direct-data-import` it has carried since before Counter. Moving one file
 * is not worth reopening an editorial page's data layer. It goes when that
 * page is rebuilt.
 */

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
