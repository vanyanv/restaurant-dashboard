import { existsSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import * as nav from "@/lib/counter/nav"
import { DESK_ONLY, mobilePathFor, phoneHref } from "@/lib/phone-routes"

/**
 * Every desk destination a reader can click — the rail and every sub-tab bar —
 * either lands a phone on a phone page that exists, or is named in
 * `DESK_ONLY`. A new desk page with neither fails here, and so does a phone
 * page that shipped while its desk path was left on the list.
 */

const PHONE_ROOTS = ["src/app/(mobile)/m/(counter)", "src/app/(mobile)/m"]

function phonePageExists(route: string): boolean {
  const rest = route.replace(/^\/m/, "")
  return PHONE_ROOTS.some((root) => existsSync(path.join(root, rest, "page.tsx")))
}

const tabBars = Object.entries(nav)
  .filter(([name, v]) => /_TABS$/.test(name) && !name.startsWith("PHONE_") && Array.isArray(v))
  .flatMap(([, v]) => v as readonly nav.SubNavItem[])

const deskHrefs = [
  ...new Set(
    [...nav.NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)), ...tabBars.map((t) => t.href)].filter(
      (h) => h.startsWith("/dashboard"),
    ),
  ),
]

describe("phone routes", () => {
  it("reads the rail and the tab bars", () => {
    expect(deskHrefs.length).toBeGreaterThan(30)
  })

  it.each(deskHrefs)("%s has a phone page or is listed as desk-only", (href) => {
    const target = mobilePathFor(href)
    if (DESK_ONLY.has(href)) {
      expect(target, `${href} is listed as desk-only but the proxy maps it to ${target}`).toBeNull()
      return
    }
    expect(target, `${href} has no phone page and is not in DESK_ONLY`).not.toBeNull()
    expect(phonePageExists(target!), `${href} maps to ${target}, which has no page.tsx`).toBe(true)
  })

  it("lists only desk paths something links to", () => {
    const stale = [...DESK_ONLY].filter((h) => !deskHrefs.includes(h))
    expect(stale).toEqual([])
  })

  it("keeps a path with no phone page on its desk href", () => {
    // DESK_ONLY is empty now; any unmapped path behaves the way its entries did.
    expect(phoneHref("/dashboard/not-a-page")).toBe("/dashboard/not-a-page")
    expect(phoneHref("/dashboard/menu/items")).toBe("/m/menu/items")
    expect(phoneHref("/dashboard/menu")).toBe("/m/menu")
  })
})
