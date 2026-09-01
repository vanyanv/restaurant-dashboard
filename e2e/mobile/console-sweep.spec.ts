import { test, expect } from "@playwright/test"
import { PAGES } from "../fidelity/manifest"

/**
 * Every gated route, opened in order, with the browser console watched.
 *
 * WHAT THIS CATCHES THAT THE FIDELITY GATE CANNOT. The fidelity harness reads
 * the DOM a page produced and compares it to the design. It never looks at
 * what the page SAID while producing it, so a page can match its design
 * landmark for landmark while throwing on hydration or hammering an endpoint
 * into a 429. Both of those were live when this file was written:
 *
 *   - `/api/telemetry/page-view` sat on the 30-a-minute `moderate` tier. One
 *     beacon or two per navigation means a reader scanning the dashboard trips
 *     it partway through and spends the rest of the session logging errors
 *     from the endpoint whose own docblock says it must never emit one.
 *   - `Donut` wrote its SVG `<title>` as two expression children, so React's
 *     `<!-- -->` separators did not survive the parser and every page with a
 *     ring — /cogs, /menu, /menu/catalog — threw a hydration mismatch and
 *     regenerated its tree on the client.
 *
 * Neither shows up in `npm test`, `npm run tokens`, `npm run build` or
 * `npm run fidelity`. They show up here.
 *
 * ONE PAGE OBJECT, walked in sequence, deliberately: a rate limit is a
 * property of a SESSION rather than of a request, and fifty parallel fresh
 * contexts would never reach one. The walk is the test.
 */
const ROUTES = [
  ...new Set(PAGES.filter((p) => p.status === "counter").map((p) => (p.mobileRoute ?? p.route) + (p.query ?? ""))),
]

test("no console errors across every gated route (phone)", async ({ page }) => {
  test.setTimeout(600_000)
  const found: string[] = []
  page.on("console", (m) => {
    if (m.type() === "error") found.push(`${page.url()} :: ${m.text().slice(0, 160)}`)
  })
  page.on("pageerror", (e) => found.push(`${page.url()} :: PAGEERROR ${e.message.slice(0, 160)}`))

  for (const route of ROUTES) {
    await page.goto(route, { waitUntil: "domcontentloaded" })
    // Long enough for hydration to run and the page-view beacon to go out.
    await page.waitForTimeout(1000)
  }

  expect(found).toEqual([])
})
