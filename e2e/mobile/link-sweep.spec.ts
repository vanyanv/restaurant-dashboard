import { test, expect } from "@playwright/test"
import { phoneRoutes } from "../fidelity/routes"

/**
 * Every internal link on every route, followed once.
 *
 * A link that 404s is invisible to all four existing gates: it renders, it
 * carries the right class, it matches the design landmark for landmark, and
 * nothing asks whether the address behind it exists. The stores page shipped
 * with `/dashboard/stores/new` reachable from nowhere for exactly that reason,
 * and the phone store file shipped with a button that navigated back to
 * itself. Both were found by reading, not by a test.
 *
 * `[data-goto]` COUNTS TOO, and it is the half that matters most. Counter
 * table rows are not anchors — `Table`'s docblock argues that at length, and
 * the short version is that the prototype's affordance is the whole row and
 * every rule in `counter-components.css` is written for a `<tr role="link">`
 * carrying `data-goto`. Those destinations are detail routes built from live
 * ids, which is the exact class of address most likely to be wrong, and an
 * `a[href]` sweep would step straight past them: 43 links against 43 plus
 * every row on every table on the account.
 *
 * GET only, and never `/api/**`: some of those routes start a sync.
 */
const ROUTES = phoneRoutes()

test("every internal link resolves (phone)", async ({ page }) => {
  test.setTimeout(900_000)

  const hrefs = new Map<string, string>()
  for (const route of ROUTES) {
    await page.goto(route, { waitUntil: "domcontentloaded" })
    const found = await page.$$eval("a[href], [data-goto]", (els) =>
      els.map((e) => e.getAttribute("href") ?? e.getAttribute("data-goto") ?? ""),
    )
    for (const h of found) {
      if (!h.startsWith("/") || h.startsWith("/api/")) continue
      if (!hrefs.has(h)) hrefs.set(h, route)
    }
  }

  // A floor, so this cannot pass by finding nothing. If a selector change or a
  // shell regression empties the rail, the sweep would otherwise go green on
  // zero links and report a clean bill of health for a page with no navigation
  // at all.
  expect(hrefs.size).toBeGreaterThan(60)

  const broken: string[] = []
  for (const [href, from] of hrefs) {
    const res = await page.request.get(href, { maxRedirects: 5 })
    if (res.status() >= 400) broken.push(`${href} -> ${res.status()} (linked from ${from})`)
  }

  expect(broken).toEqual([])
})
