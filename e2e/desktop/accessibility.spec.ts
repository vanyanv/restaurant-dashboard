import AxeBuilder from "@axe-core/playwright"
import { test, expect } from "../fixtures/test"

/**
 * The accessibility floor, as a gate rather than as a habit.
 *
 * ## Why this exists
 *
 * The hand-written accessibility in this app is unusually good and was, until
 * this file, defended entirely by whoever remembered it. `Section` renders
 * `<section aria-labelledby>` with a `useId` heading; `AppShell` renders a
 * real `<main id="ct-main">` named by the page title; the ⌘K palette traps
 * focus and restores it; the login form labels every input and announces
 * errors with `role="alert"`; `counter.css` carries a documented WCAG
 * contrast correction with measured ratios on every surface the token paints
 * on. None of that failed anything if the next page dropped a label.
 *
 * ## What it asserts, and what it deliberately does not
 *
 * Serious and critical violations only. Axe's `minor` and `moderate` findings
 * on a dense dashboard are mostly judgement calls — colour-contrast on a
 * disabled control, a landmark it would prefer named — and a gate that fails
 * on those gets muted within a month, which is worse than no gate. The two
 * tiers here are the ones that mean a person cannot use the page.
 *
 * ## Why these four pages
 *
 * One rebuilt Counter desk page, one Counter phone page, the signed-out front
 * door, and one editorial page — the four distinct chrome/markup systems in
 * the app. A fifth Counter page would exercise the same shell and the same
 * `Section`, so it would cost a minute of CI to assert what page one already
 * did. When the editorial tree is gone, that case goes with it.
 */

/**
 * MOTION IS STILLED BEFORE EVERY SCAN, and that is not a convenience.
 *
 * Counter fades its figures in (`components/counter/motion/use-entry`). A scan
 * that lands mid-transition measures the composited colour — the real ink
 * blended toward the background — and reports contrast the finished page never
 * has. That is exactly what happened the first time this ran: 60 "serious"
 * colour-contrast failures on the phone, including a section heading at 2.1:1,
 * with axe reporting #9f9995 where the resolved token is
 * `oklch(0.525 0.011 50)` — the WCAG-corrected value `counter.css` measured at
 * 4.8:1 on that surface. Every one was a partly-faded-in element.
 *
 * `e2e/fidelity` sets `reducedMotion` for the same reason, in its own words:
 * the text it captures must be final rather than mid-tween.
 */
const SERIOUS = ["serious", "critical"]

/** Axe's report, trimmed to something a failure message can be read from. */
function summarise(violations: Array<{ id: string; impact?: string | null; nodes: unknown[] }>) {
  return violations
    .map((v) => `${v.impact}: ${v.id} (${v.nodes.length} node(s))`)
    .join("\n")
}

async function scan(page: import("@playwright/test").Page) {
  // Belt and braces: the emulateMedia call below runs before navigation, and
  // this waits out anything still in flight when the page settles late.
  await page.waitForTimeout(600)
  const results = await new AxeBuilder({ page })
    // The dev/preview overlays are not ours and are not shipped: Next's
    // dev-tools portal and the TanStack query devtools launcher both inject
    // their own markup. Same two the screenshot script hides, same reason.
    .exclude("nextjs-portal")
    .exclude(".tsqd-parent-container")
    .analyze()
  return results.violations.filter((v) => SERIOUS.includes(v.impact ?? ""))
}

test.describe("accessibility floor", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
  })

  test("Counter desk page has no serious violations", async ({ page }) => {
    await page.goto("/dashboard/pnl")
    // Sections stream, so the assertion has to wait for the real page rather
    // than scanning a set of skeletons — which would pass for the wrong reason.
    await page.getByRole("heading", { name: /profit and loss/i }).waitFor({ timeout: 60_000 })
    const violations = await scan(page)
    expect(summarise(violations)).toBe("")
  })

  test("editorial page has no serious violations", async ({ page }) => {
    await page.goto("/dashboard/settings")
    await page.locator("main, .editorial-surface").first().waitFor({ timeout: 60_000 })
    const violations = await scan(page)
    expect(summarise(violations)).toBe("")
  })

  test("the signed-out front door has no serious violations", async ({ page, context }) => {
    // The one page a person who is not signed in actually sees, so it is the
    // one where a missing label cannot be worked around by knowing the app.
    await context.clearCookies()
    await page.goto("/login")
    await page.locator('input[type="email"]').waitFor({ timeout: 60_000 })
    const violations = await scan(page)
    expect(summarise(violations)).toBe("")
  })
})
