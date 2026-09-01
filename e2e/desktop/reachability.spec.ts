import { test, expect } from "@playwright/test"
import { PAGES } from "../fidelity/manifest"
import { deskRoutes } from "../fidelity/routes"

/**
 * Every gated DESK page is linked from somewhere.
 *
 * The phone's twin found nine pages with no entrance. This asks the same of
 * the desk, where the rail carries most of the navigation and a page missing
 * from it is a page nobody opens.
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
 *
 * ## Shapes, not strings
 *
 * A detail route is reachable if the list above it links to SOME record, not
 * to the one the manifest happens to name. So both sides are reduced to a
 * shape first: any segment that looks like an id becomes `*`, and
 * `/m/orders/4551abf7-…` matches `/m/orders/abc123`.
 */
/**
 * Pages you arrive at by being SENT, never by following a link — a sign-in
 * screen, a 404 and a refusal. Excluded rather than special-cased in the loop,
 * so the list is readable as what it is.
 */
const NOT_LINKED_BY_DESIGN = new Set([
  "/dashboard/not-found",
  "/dashboard/forbidden",
])


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
  // Operations has an entrance in the design — on the PHONE. `P.more`'s table
  // lists it there as "a hub of hubs", and the phone's More list carries it.
  // The desk's `GROUPS` deliberately does not: the rail already links
  // Invoices, Inventory, Ingredients and Vendors directly, so a hub whose
  // whole content is four things one click away earns nothing on a desk.
  //
  // So this is not a missing link but a page whose desk audience the design
  // does not think exists. Adding it to the rail would put a sixth item in a
  // group of four that the prototype wrote deliberately. Left as it is, and
  // named here, until someone decides whether the desk wants the hub at all.
  operations: "reachable on the phone, where the design puts it; the desk rail omits it on purpose",
}

// The three per-store pages used to be listed here. `storeViewTabs` builds
// their "One store" tab in the client from `?store=`, so they are reachable
// and their lines are gone — which the stale check below is what forces.


const idish = /^[0-9a-f]{8,}$|^c[a-z0-9]{20,}$|^[0-9a-f-]{30,}$/i
const shapeOf = (href: string): string =>
  href
    .split("?")[0]
    .split("/")
    .map((seg) => (idish.test(seg) ? "*" : seg))
    .join("/")
    .replace(/\/$/, "")

test("every gated desk page is linked from somewhere", async ({ page }) => {
  test.setTimeout(900_000)

  const linked = new Set<string>()
  for (const route of deskRoutes()) {
    await page.goto(route, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(2500)
    const hrefs = await page.$$eval("a[href], [data-goto]", (els) =>
      els.map((e) => e.getAttribute("href") ?? e.getAttribute("data-goto") ?? ""),
    )
    for (const h of hrefs) {
      if (!h.startsWith("/") || h.startsWith("/api/")) continue
      linked.add(shapeOf(h))
    }
  }

  const orphans: string[] = []
  for (const p of PAGES) {
    if (p.status !== "counter") continue
    const route = p.route
    if (!route.startsWith("/dashboard")) continue
    if (route === "/dashboard") continue // the rail's Overview, and the front door
    if (NOT_LINKED_BY_DESIGN.has(route)) continue
    if (!linked.has(shapeOf(route))) orphans.push(`${p.protoId}: ${route}`)
  }

  for (const o of orphans) console.log(`ORPHAN>>> ${o}`)
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
