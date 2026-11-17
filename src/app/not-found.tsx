import Link from "next/link"

/**
 * The root 404, on Counter.
 *
 * Next puts the root `not-found` in EVERY route's entry graph, so whatever this
 * file imports is downloaded by every screen, desk and phone, before it can
 * draw. Until 2026-11-17 it drew the pre-Counter "missing dispatch" in the
 * old serif design and imported that design's token and auth stylesheets
 * to do it: measured on a production build, a 48 KB stylesheet (9 KB
 * compressed) on every page for a screen almost nobody sees. It now uses the
 * global Counter sheet that every page already has, and opens its own Counter
 * root because it renders outside both shells (like `(mobile)/m/not-found.tsx`).
 */
export default function NotFound() {
  return (
    <div className="ct-root" style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <div style={{ display: "grid", gap: 14, justifyItems: "center", padding: "44px 16px" }}>
        <div className="empty">
          <span className="t">Nothing here</span>
          <span className="s">The link may be old, or the page has moved.</span>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link className="mbtn mbtn--primary" href="/">
            To the front page
          </Link>
          <Link className="mbtn" href="/login">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
