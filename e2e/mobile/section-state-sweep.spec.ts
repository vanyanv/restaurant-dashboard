import { test, expect } from "@playwright/test"
import { phoneRoutes } from "../fidelity/routes"

/**
 * No route may finish loading in a FAILED state, or still skeleton.
 *
 * This is the hole in the fidelity gate that a landmark count cannot see. A
 * section whose loader threw still renders `.sec`, `.sec__head` and
 * `.sec__body` — `Section`'s state machine puts the `Failed` body inside the
 * same box — so the structure pass counts three landmarks either way and goes
 * green on a page where every section errored. Ours would then be a page that
 * matches its design and shows the reader nothing.
 *
 * `.failed` is the state itself; `[data-skeleton-row]` is a section that never
 * resolved within the wait. `.stale` is deliberately NOT a finding — a stale
 * section is showing the last good answer and saying so, which is the state
 * working.
 *
 * `not_computed` (`Owed`) is not checked here either: two Counter pages
 * legitimately render it, and the P&L's two panels are named in its own
 * manifest entry. That is a product state, not a failure.
 */

test("no route renders a failed or unresolved section (phone)", async ({ page }) => {
  test.setTimeout(900_000)
  const findings: string[] = []

  for (const route of phoneRoutes()) {
    await page.goto(route, { waitUntil: "domcontentloaded" })
    // Long enough for every streamed section to resolve. The fidelity harness
    // waits on the content root; this waits on the sections beneath it.
    await page.waitForTimeout(2500)

    const failed = await page.$$eval(".failed", (els) =>
      els.map((e) => (e.textContent ?? "").trim().slice(0, 120)),
    )
    for (const f of failed) findings.push(`${route} :: FAILED ${f}`)

    const pending = await page.locator("[data-skeleton-row]").count()
    if (pending > 0) findings.push(`${route} :: STILL LOADING (${pending} skeleton rows)`)
  }

  expect(findings).toEqual([])
})
