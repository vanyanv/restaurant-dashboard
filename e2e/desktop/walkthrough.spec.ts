import { test, expect } from "../fixtures/test"

/**
 * The recipe → cost → owner-view loop, read-only against real data: the server
 * points at the live Neon DB, so these tests assert everything up to (but never
 * through) a mutating click.
 *
 * ## Rewritten for Counter, 2026-09-01
 *
 * Every assertion in this file used to name the pre-Counter UI — `?days=90`,
 * `a[aria-current="true"]` preset links, `data-testid="menu-profit-table"`,
 * "Profit matrix", "Stars — protect these", an "AI proposals" button. The file
 * was last touched 2026-07-27; `/dashboard/recipes` was rebuilt in Counter on
 * 2026-08-31 and `/dashboard/menu-profit` on 2026-09-01, so all five tests had
 * been failing against a UI that no longer exists. Both pages are healthy —
 * probed directly they return 200 with real figures, charts and rows and zero
 * console errors — which is the whole problem with a stale spec: it reports a
 * page as broken while the page works, and it stops guarding anything.
 *
 * The Counter names the assertions below use were read off the running pages,
 * not guessed:
 *
 *   - the per-item ledger moved from a `menu-profit-table` on the profit page
 *     to its own view, `/dashboard/menu/catalog` (`MENU_TABS`' "Items" tab).
 *   - "Profit matrix" is now the `Volume against margin` section, and the
 *     coverage strip is `What these figures did not see`.
 *   - the lookback is `?range=d30`, driven by `DateControl`: its trigger
 *     carries the CURRENT preset's label, and the popover it opens carries the
 *     others. A preset click rewrites `range` and the page head together.
 *
 * ## One thing this file no longer covers, deliberately
 *
 * THE AI-PROPOSAL REVIEW ENTRY POINT IS GONE. Three tests here used to open it
 * from `/dashboard/recipes`. Nothing in `src/` renders "AI proposals" any more,
 * while `src/app/actions/mapping-proposal-actions.ts` and
 * `src/app/api/cron/proposals/route.ts` both still run — so proposals are still
 * being generated nightly with no way to review or accept one. That is a
 * product gap, not a test gap, and inventing an assertion for a button that
 * does not exist would only hide it. It is recorded here so the next person to
 * rebuild the reviewer knows this file is where its walkthrough belongs.
 */

test.describe("recipes", () => {
  test("@smoke recipes page renders its figures and opens a recipe", async ({
    page,
  }) => {
    await page.goto("/dashboard/recipes")
    await expect(page).toHaveURL(/\/dashboard\/recipes/)

    const main = page.locator("#ct-main")
    await expect(main).toContainText(/recipes/i, { timeout: 20_000 })
    // The brief's own figures, which only render once the section resolves.
    await expect(main).toContainText(/confirmed/i, { timeout: 20_000 })
    await expect(main).toContainText(/\$[\d,]+/, { timeout: 20_000 })

    // The list is the page's reason to exist: it has to reach a recipe.
    const recipeLink = main.locator('a[href*="/dashboard/recipes/"]').first()
    await expect(recipeLink).toBeVisible({ timeout: 20_000 })
  })

  test("a costed item shows a live server-side cost walk", async ({ page }) => {
    /*
     * The catalog detail page walks the cost on the SERVER, so a real dollar
     * figure here proves invoice → canonical cost → recipe cost end to end.
     *
     * `/dashboard/menu/catalog/soda` by name, and it is the manifest's own
     * catalog-detail route rather than one discovered by clicking: the Counter
     * catalog's item rows are not links (see `manifest.ts` — the item rows
     * point at `catalogitem`, which is not rebuilt), so the ledger-link walk
     * this test used to do has nothing to click. A recipe picked at random is
     * no good either: `/dashboard/recipes` reports "PLATES COSTING NOTHING",
     * and the first link on it is one of them, which would assert $0.00.
     */
    await page.goto("/dashboard/menu/catalog/soda?range=d30")

    const main = page.locator("#ct-main")
    await expect(main).toContainText(/plate cost/i, { timeout: 20_000 })
    await expect(main).toContainText(/\$\d+\.\d{2}/, { timeout: 20_000 })
  })
})

test.describe("menu profit", () => {
  test("@smoke menu-profit renders the figures, the matrix and the coverage", async ({
    page,
  }) => {
    await page.goto("/dashboard/menu-profit?range=d30")
    await expect(page).toHaveURL(/\/dashboard\/menu-profit/)

    const main = page.locator("#ct-main")
    // The figures strip: real currency in the brief.
    await expect(main).toContainText(/revenue/i, { timeout: 20_000 })
    await expect(main).toContainText(/\$[\d,]+/, { timeout: 20_000 })

    // The quadrant scatter, by its Counter name.
    await expect(main.getByText(/volume against margin/i)).toBeVisible({
      timeout: 20_000,
    })
    // The chart mounts its <svg> after ResizeObserver reports a size — this
    // auto-waits rather than counting in the same tick.
    await expect(
      main.locator("section:has-text('Volume against margin') svg").first(),
    ).toBeVisible({ timeout: 20_000 })

    // The honesty strip is always present.
    await expect(main.getByText(/what these figures did not see/i)).toBeVisible({
      timeout: 20_000,
    })
  })

  test("the per-item ledger lives on the Items view and has rows", async ({
    page,
  }) => {
    // The ledger this describe block used to assert in place. It moved with
    // the rebuild; asserting it where it now is keeps the coverage rather than
    // dropping it along with the old selector.
    await page.goto("/dashboard/menu/catalog?range=d30")

    const main = page.locator("#ct-main")
    await expect(main.locator("tbody tr").first()).toBeVisible({
      timeout: 20_000,
    })
    await expect(main.locator('[aria-current="page"]')).toHaveText(/items/i)
  })

  test("a lookback preset re-renders the window", async ({ page }) => {
    await page.goto("/dashboard/menu-profit?range=d30")

    const main = page.locator("#ct-main")
    await expect(main).toContainText(/last 30 days/i, { timeout: 20_000 })

    // `DateControl`'s trigger carries the CURRENT preset; the popover it opens
    // carries the rest. Two clicks, because that is what a reader does.
    await page.getByRole("button", { name: /last 30 days/i }).first().click()
    await page.getByRole("button", { name: /^last 90 days/i }).click()

    await expect(page).toHaveURL(/range=d90/, { timeout: 20_000 })
    await expect(main).toContainText(/last 90 days/i, { timeout: 20_000 })
  })
})
