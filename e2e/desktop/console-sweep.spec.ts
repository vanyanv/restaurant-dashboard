import { test, expect } from "@playwright/test"
import { deskRoutes } from "../fidelity/routes"

/**
 * Every route a reader can reach, opened in order, console watched.
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
/*
 * EVERY manifest row, not only the gated ones. The three that are not gated —
 * `ask`, `pnlstore`, `more` — are real routes a reader reaches, and a page
 * being ungated says nothing about whether it throws. They were outside this
 * walk for as long as it existed, which is part of why the legacy-redirect
 * bug went unseen for so long.
 */
const ROUTES = deskRoutes()

test("no console errors across every route", async ({ page }) => {
  test.setTimeout(600_000)
  const found: string[] = []
  /*
   * Next's DEV-ONLY render instrumentation, filtered — and the one exception
   * this file makes, so it is argued rather than assumed.
   *
   * A Server Component that calls `redirect()` aborts mid-render, so the
   * `performance.measure` Next opened for it closes before it started and the
   * browser refuses a negative duration. It is Next's own timing code, it names
   * our component only because that is what it was timing, and it does not
   * exist in a production build — verified by probing the same routes against
   * `npm run start`, where it is gone.
   *
   * What IS real about those routes is checked properly, and elsewhere:
   * `e2e/desktop/legacy-redirect.spec.ts` asserts each legacy path answers a
   * 3xx from the middleware rather than a rendered document with a meta
   * refresh in it. That is the defect this noise sat on top of.
   */
  const devRedirectNoise = /cannot have a negative time stamp/
  page.on("console", (m) => {
    if (m.type() !== "error") return
    if (devRedirectNoise.test(m.text())) return
    found.push(`${page.url()} :: ${m.text().slice(0, 160)}`)
  })
  page.on("pageerror", (e) => {
    if (devRedirectNoise.test(e.message)) return
    found.push(`${page.url()} :: PAGEERROR ${e.message.slice(0, 160)}`)
  })

  for (const route of ROUTES) {
    await page.goto(route, { waitUntil: "domcontentloaded" })
    // Long enough for hydration to run and the page-view beacon to go out.
    await page.waitForTimeout(1000)
  }

  expect(found).toEqual([])
})
