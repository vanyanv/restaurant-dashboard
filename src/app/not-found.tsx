import Link from "next/link"
import { Fraunces } from "next/font/google"
import "@/styles/editorial-tokens.css"
import "@/styles/editorial-auth.css"

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
  // Not preloaded. `next/font` emits a preload hint for every font in a route's
  // entry graph, and Next puts the root `not-found` in EVERY route's entry — so
  // this 117 KB serif (three axes: SOFT, WONK, opsz — larger than Bricolage, DM
  // Sans and JetBrains Mono put together) was fetched on every screen in the
  // product and painted on almost none. Measured with a cold cache: `/login`,
  // `/dashboard/pnl`, `/dashboard/orders`, `/m`, `/m/orders` and `/m/settings`
  // all downloaded it and reported zero elements computing to Fraunces.
  // Without the hint the browser fetches it when a page actually paints with
  // it, which is what an unused @font-face already does. `display: swap` means
  // the pages that do use it swap rather than block.
  preload: false,
})

export default function NotFound() {
  return (
    <div
      className={`${fraunces.variable} editorial-surface`}
      style={{ minHeight: "100vh" }}
    >
      <div className="missing-dispatch full-bleed">
        <span className="brand-seal" aria-hidden="true">
          <span className="brand-seal__mark">C·N</span>
        </span>
        <div className="dispatch-issue">ChrisnEddys · Vol. 01 · Missing page</div>
        <div className="dispatch-rule" aria-hidden="true" />
        <div className="dispatch-bracket" aria-hidden="true">
          <span>&#x2e27;</span>
          <span>&#x2e28;</span>
        </div>
        <div className="dispatch-number">404</div>
        <h1 className="dispatch-title">
          This is a <em>missing</em> dispatch.
        </h1>
        <p className="dispatch-caption">
          The page at this address has either been filed elsewhere, withdrawn,
          or was never published. Try the front page, or sign in to the
          management console.
        </p>
        <div className="dispatch-actions">
          <Link href="/" className="editorial-submit">
            To the front page
          </Link>
          <Link
            href="/login"
            className="editorial-submit"
            style={{
              background: "rgba(255, 255, 255, 0.55)",
              color: "var(--ink)",
              border: "1px solid var(--hairline-bold)",
            }}
          >
            Sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
