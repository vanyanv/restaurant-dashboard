import { test, expect } from "@playwright/test"

/**
 * Every legacy path answers with a real redirect, from the middleware.
 *
 * ## The bug this exists to keep fixed
 *
 * These six routes each had a Server Component whose whole body was
 * `redirect(...)`. That is the documented way to forward an old bookmark and
 * it DOES NOT WORK from inside a streamed layout: by the time the page
 * component runs, the layout above it has flushed the shell, the response
 * headers are gone, and Next falls back to what it can still do —
 *
 *     <meta id="__next-page-redirect" http-equiv="refresh" content="1;url=/dashboard/ask">
 *
 * — a one-second wait on a page that is not the page, and React hydrating a
 * document it is about to discard. Measured against a production build, 15 of
 * 18 loads threw a hydration mismatch (React #418).
 *
 * It was invisible everywhere it could have been caught. Dev never reproduces
 * it: eighteen loads, all clean, because dev does not stream the same way. The
 * fidelity harness follows the redirect and measures the destination. The
 * console sweep walks the fifty GATED routes and none of these six is one.
 *
 * ## Why this asserts the STATUS and not the destination
 *
 * A meta-refresh page is a 200 that lands on the right URL a second later, so
 * "did I end up in the right place" passes on the broken version. The status
 * is the thing that separates them: 3xx means the middleware answered before
 * anything rendered, 200 means a document was built, sent, hydrated and thrown
 * away.
 */
const LEGACY: Array<[string, string]> = [
  ["/dashboard/chat", "/dashboard/ask"],
  ["/dashboard/operations/costs", "/dashboard/menu-profit"],
  ["/dashboard/operations/recipes", "/dashboard/recipes"],
  ["/dashboard/stores/cmexd4zia0001jr04ljkdt9na/edit", "/dashboard/stores/cmexd4zia0001jr04ljkdt9na"],
  ["/dashboard/pnl/cmexd4zia0001jr04ljkdt9na", "/dashboard/pnl?store=cmexd4zia0001jr04ljkdt9na"],
  ["/m/settings", "/m/more"],
]

test("every legacy path redirects before it renders", async ({ page }) => {
  test.setTimeout(300_000)
  const wrong: string[] = []

  for (const [from, to] of LEGACY) {
    const res = await page.request.get(from, { maxRedirects: 0 })
    const status = res.status()
    const location = res.headers()["location"] ?? "(none)"
    if (status < 300 || status >= 400) {
      wrong.push(`${from} answered ${status}, not a redirect — it rendered a document first`)
      continue
    }
    if (location !== to) wrong.push(`${from} -> ${location}, expected ${to}`)
  }

  expect(wrong).toEqual([])
})
