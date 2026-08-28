import AxeBuilder from "@axe-core/playwright"
import { test, expect } from "../fixtures/test"

/**
 * The phone half of `e2e/desktop/accessibility.spec.ts` — see that file for
 * what this asserts and why it is limited to serious and critical findings.
 *
 * Worth its own case rather than folding into the desk suite: `PhoneShell` is
 * a different frame with a different tab bar, and the phone sheet
 * (`phone-sheet.tsx`) is the app's only `role="dialog" aria-modal` outside the
 * ⌘K palette. A desk scan would exercise neither.
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

test("Counter phone page has no serious accessibility violations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/m/pnl")
  await page.locator(".mscroll, main").first().waitFor({ timeout: 60_000 })
  await page.waitForTimeout(600)
  const results = await new AxeBuilder({ page })
    .exclude("nextjs-portal")
    .exclude(".tsqd-parent-container")
    .analyze()
  const violations = results.violations.filter((v) => SERIOUS.includes(v.impact ?? ""))
  expect(violations.map((v) => `${v.impact}: ${v.id} (${v.nodes.length} node(s))`).join("\n")).toBe("")
})
