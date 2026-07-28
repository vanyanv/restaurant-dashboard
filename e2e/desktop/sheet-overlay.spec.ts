import { test, expect } from "../fixtures/test"

/**
 * Regression (July 2026): the "AI proposals" sheet opened to a blurred overlay
 * with no visible panel. Two independent defects stacked:
 *
 *  1. `[data-slot="sheet-content"] { position: relative }` in
 *     editorial-dashboard.css tied Tailwind's `.fixed` on specificity (both
 *     0,1,0) and won on source order, dropping the panel into normal document
 *     flow at the end of <body> — rendered ~900px below the fold.
 *  2. Radix portals the panel to <body>, OUTSIDE `.editorial-surface`, so
 *     `--paper` / `--ink` / `--hairline-bold` resolved to nothing and the
 *     panel painted fully transparent.
 *
 * Either defect alone reads to the operator as "screen goes blurry, nothing
 * happens", so both are asserted here.
 */
test.describe("editorial sheet panel", () => {
  test("AI proposals sheet opens onscreen and opaque", async ({ page }) => {
    await page.goto("/dashboard/recipes")

    const trigger = page.getByRole("button", { name: /AI proposals/i })
    await trigger.waitFor({ state: "visible", timeout: 30_000 })
    await trigger.click()

    const content = page.locator('[data-slot="sheet-content"]')
    await expect(content).toBeVisible({ timeout: 10_000 })

    const box = await content.evaluate((el) => {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return {
        position: cs.position,
        backgroundColor: cs.backgroundColor,
        paper: cs.getPropertyValue("--paper").trim(),
        ink: cs.getPropertyValue("--ink").trim(),
        top: r.top,
        right: r.right,
        viewportH: window.innerHeight,
        viewportW: window.innerWidth,
      }
    })

    // 1. Pinned to the viewport, not flowed to the bottom of the document.
    expect(box.position, "sheet must stay fixed to the viewport").toBe("fixed")
    expect(box.top, "sheet top must be onscreen").toBeLessThan(box.viewportH)
    expect(box.right, "right-side sheet must reach the right edge").toBeCloseTo(
      box.viewportW,
      0
    )

    // 2. Editorial tokens resolve through the portal, so paper is opaque.
    expect(box.paper, "--paper must resolve inside the portal").not.toBe("")
    expect(box.ink, "--ink must resolve inside the portal").not.toBe("")
    expect(
      box.backgroundColor,
      "panel must not be transparent"
    ).not.toBe("rgba(0, 0, 0, 0)")

    // The title is genuinely readable, not just present in the DOM.
    await expect(
      page.getByRole("heading", { name: /AI Mapping Proposals/i })
    ).toBeVisible()
  })
})
