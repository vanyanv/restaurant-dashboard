import { test, expect } from "@playwright/test"
import { phoneRoutes } from "../fidelity/routes"

/**
 * No route may scroll sideways, and nothing on it may stick out.
 *
 * The phone is where this matters and where nothing was watching for it. The
 * fidelity gate compares landmarks and eighteen computed properties on each;
 * none of them is "does this page fit". A table two columns too wide, a strip
 * whose track count exceeds the viewport, a long unbroken vendor name — each
 * one matches its design perfectly and each one pushes the body sideways on a
 * 412px screen.
 *
 * TWO CHECKS, because they fail differently. The document one catches a page
 * that scrolls as a whole. The element one catches a child that overflows its
 * own container without moving the document — which is the more common shape
 * on this design, since wide content is supposed to scroll INSIDE an
 * `overflow-x: auto` box. An element inside a scroller is therefore not a
 * finding; only one that escapes the viewport with no scroller above it is.
 *
 * A one-pixel tolerance: sub-pixel layout rounds, and a 412.5px box on a 412px
 * viewport is a rounding artefact, not a defect.
 */

test("no route overflows sideways (phone)", async ({ page }) => {
  test.setTimeout(900_000)
  const findings: string[] = []

  for (const route of phoneRoutes()) {
    await page.goto(route, { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(1200)

    const found = await page.evaluate(() => {
      const out: string[] = []
      const doc = document.documentElement
      const width = doc.clientWidth
      if (doc.scrollWidth > width + 1) {
        out.push(`DOCUMENT scrolls sideways: ${doc.scrollWidth}px in ${width}px`)
      }

      const scrollable = (el: Element): boolean => {
        for (let p: Element | null = el.parentElement; p; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX
          if (ox === "auto" || ox === "scroll" || ox === "hidden") return true
        }
        return false
      }

      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (r.right <= width + 1) continue
        if (scrollable(el)) continue
        out.push(
          `ESCAPES ${el.tagName.toLowerCase()}.${(el.className || "(no class)").toString().slice(0, 40)} ` +
            `right=${Math.round(r.right)} viewport=${width}`,
        )
      }
      // One line per page is enough to act on; a wide table reports every cell.
      return out.slice(0, 3)
    })

    for (const f of found) findings.push(`${route} :: ${f}`)
  }

  expect(findings).toEqual([])
})
