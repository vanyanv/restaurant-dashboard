import { test, expect } from "@playwright/test"
import { PAGES } from "../fidelity/manifest"
import { phoneRoutes } from "../fidelity/routes"

/**
 * Every gated phone page is linked from somewhere.
 *
 * A page can be built, gated, landmark-perfect and reachable only by typing
 * its URL. That has happened twice on this branch and neither time did any
 * gate notice: `/dashboard/stores/new` was linked from one place, the retired
 * editorial sidebar, which no Counter page renders; and the phone store file's
 * handoff button pointed at a desk route the proxy sends straight back. Both
 * were found by reading.
 *
 * The link sweep asks whether a link RESOLVES. This asks the other question —
 * whether anything links there at all — and they fail in opposite directions.
 *
 * ## Desk hrefs count, because the proxy makes them work
 *
 * Phone list pages routinely link to `/dashboard/<x>/<id>` and let
 * `src/proxy.ts` redirect a phone onto `/m/<x>/<id>`. That is indirect but it
 * is not broken, and a check that ignored it would report two thirds of the
 * phone as unreachable — the first run of this file did exactly that. So a
 * collected desk href is folded onto its phone equivalent before comparing,
 * with the one rename the proxy also makes.
 *
 * ## Shapes, not strings
 *
 * A detail route is reachable if the list above it links to SOME record, not
 * to the one the manifest happens to name. So both sides are reduced to a
 * shape first: any segment that looks like an id becomes `*`, and
 * `/m/orders/4551abf7-…` matches `/m/orders/abc123`.
 */
/** A desk href as the proxy would serve it to a phone. */
const asPhone = (href: string): string =>
  href.startsWith("/dashboard/admin/monitoring")
    ? href.replace("/dashboard/admin/monitoring", "/m/monitoring")
    : "/m" + href.slice("/dashboard".length)

/**
 * Pages you arrive at by being SENT, never by following a link — a sign-in
 * screen, a 404 and a refusal. Excluded rather than special-cased in the loop,
 * so the list is readable as what it is.
 */
const NOT_LINKED_BY_DESIGN = new Set(["/m/login", "/m/not-found", "/m/forbidden"])


/**
 * Pages with no entrance TODAY, each with the reason it has none.
 *
 * Two kinds, and the difference matters to whoever picks this up.
 *
 * A REAL GAP is a page a reader cannot get to. Every one below is a hub that
 * does not link its own children, which is a navigation job rather than a
 * page-building one — the pages themselves are built and gated.
 *
 * A SHAPE MISS is this file's own limitation. `shapeOf` collapses a segment
 * that LOOKS like an id, and a human-readable slug does not look like one, so
 * a list linking `/m/menu/catalog/add-pickles` does not match the manifest's
 * `/m/menu/catalog/soda`. The page is reachable; the matcher cannot see it.
 * Tightening it would mean teaching this file which segments are dynamic,
 * which is the router's knowledge and not worth duplicating for one row.
 */
const KNOWN_ORPHANS: Record<string, string> = {
  // SHAPE MISS — `/m/menu/catalog` links every item by slug, just not this one.
  catalogitem: "reachable by slug from the catalogue; the id matcher cannot see a word",

  // REAL GAPS — a hub that does not link its own children.
  usage: "the Operations hub does not link product usage",
  packaging: "the Operations hub does not link packaging",
  countnew: "the counts list does not offer starting one on the phone",
  prices: "the Ingredients page does not link its price history",
  storeedit: "nothing on the phone links the new-store form; the desk had the same defect until it was fixed",
  analyticsstore: "the per-store analytics page has no entrance; the phone has no store switcher into it",
  laborstore: "as analyticsstore, for labour",
  cogsstore: "as analyticsstore, for COGS",

  // REAL GAP — the phone monitoring page has no sub-navigation at all, where
  // the desk carries `MONITORING_TABS`. Seven pages behind one missing bar.
  monml: "the phone monitoring page renders no tab bar for its seven sub-pages",
  monpeople: "as monml",
  moninfra: "as monml",
  moncosts: "as monml",
  moncache: "as monml",
  monactivity: "as monml",
  moningredients: "as monml",
}

const idish = /^[0-9a-f]{8,}$|^c[a-z0-9]{20,}$|^[0-9a-f-]{30,}$/i
const shapeOf = (href: string): string =>
  href
    .split("?")[0]
    .split("/")
    .map((seg) => (idish.test(seg) ? "*" : seg))
    .join("/")
    .replace(/\/$/, "")

test("every gated phone page is linked from somewhere", async ({ page }) => {
  test.setTimeout(900_000)

  const linked = new Set<string>()
  for (const route of phoneRoutes()) {
    await page.goto(route, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(2500)
    const hrefs = await page.$$eval("a[href], [data-goto]", (els) =>
      els.map((e) => e.getAttribute("href") ?? e.getAttribute("data-goto") ?? ""),
    )
    for (const h of hrefs) {
      if (!h.startsWith("/") || h.startsWith("/api/")) continue
      linked.add(shapeOf(h))
      if (h.startsWith("/dashboard/")) linked.add(shapeOf(asPhone(h)))
    }
  }

  const orphans: string[] = []
  for (const p of PAGES) {
    if (p.status !== "counter") continue
    const route = p.mobileRoute ?? p.route
    if (!route.startsWith("/m")) continue
    if (route === "/m") continue // the tab bar's Home, and the app's front door
    if (NOT_LINKED_BY_DESIGN.has(route)) continue
    if (!linked.has(shapeOf(route))) orphans.push(`${p.protoId}: ${route}`)
  }

  const unexplained = orphans.filter((o) => !(o.split(":")[0] in KNOWN_ORPHANS))
  expect(
    unexplained,
    "A gated phone page nothing links to. Either give it an entrance, or add " +
      "it to KNOWN_ORPHANS with a reason that survives being read out loud.",
  ).toEqual([])

  // The mirror: an entry that is no longer an orphan is a line claiming a gap
  // that has been closed, and it has to go — the same contract
  // `applyAbsenceAllowances` holds its own list to.
  const ids = new Set(orphans.map((o) => o.split(":")[0]))
  const stale = Object.keys(KNOWN_ORPHANS).filter((k) => !ids.has(k))
  expect(
    stale,
    "These are reachable now. Delete their KNOWN_ORPHANS lines rather than " +
      "leave them forgiving a future regression.",
  ).toEqual([])
})
