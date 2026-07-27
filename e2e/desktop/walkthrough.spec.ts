import { test, expect } from "../fixtures/test"

// End-to-end walkthrough of the recipe → cost → owner-view loop, read-only
// against real dev data: the dev server points at a live Neon DB, so these
// tests assert everything up to (but never through) a mutating click.

test.describe("recipes editor", () => {
  test("@smoke recipes page renders the editor with AI-proposal entry point", async ({
    page,
  }) => {
    await page.goto("/dashboard/recipes")
    await expect(page).toHaveURL(/\/dashboard\/recipes/)

    await expect(page.locator("body")).toContainText(/recipes/i, {
      timeout: 15_000,
    })
    // New proposal review entry point streams into the topbar.
    await expect(page.getByRole("button", { name: /ai proposals/i })).toBeVisible({
      timeout: 15_000,
    })
  })

  test("a mapped recipe shows a live server-side cost walk", async ({ page }) => {
    // Discover a real recipeId from the Menu Profit ledger (plain table,
    // links carry ?recipeId=) rather than the virtualized recipes list.
    await page.goto("/dashboard/menu-profit")
    const ledgerLink = page
      .getByTestId("menu-profit-table")
      .locator('a[href*="recipeId="]')
      .first()
    await expect(ledgerLink).toBeVisible({ timeout: 20_000 })
    const href = await ledgerLink.getAttribute("href")
    const recipeId = new URL(href!, "http://x").searchParams.get("recipeId")
    expect(recipeId).toBeTruthy()

    // The catalog detail page walks the recipe cost live on the server —
    // a real dollar figure proves invoice → canonical cost → recipe cost
    // works end-to-end in-app.
    await page.goto(`/dashboard/menu/catalog/${recipeId}`)
    await expect(page.locator("body")).toContainText(/food cost/i, {
      timeout: 20_000,
    })
    await expect(page.locator("body")).toContainText(/\$\d+\.\d{2}/, {
      timeout: 20_000,
    })
  })

  test("proposal review sheet opens and closes without writing", async ({
    page,
  }) => {
    await page.goto("/dashboard/recipes")

    const launcher = page.getByRole("button", { name: /ai proposals/i })
    await expect(launcher).toBeVisible({ timeout: 15_000 })
    await launcher.click()

    await expect(page.getByText(/ai mapping proposals/i)).toBeVisible()
    await expect(page.getByText(/nothing is written until you accept/i)).toBeVisible()
    await expect(
      page.getByRole("button", { name: /suggest fixes/i })
    ).toBeVisible()

    // Read-only: close without generating or accepting anything.
    await page.keyboard.press("Escape")
    await expect(page.getByText(/ai mapping proposals/i)).not.toBeVisible()
  })
})

test.describe("menu profit", () => {
  test("@smoke menu-profit renders KPIs, matrix, ledger, and coverage", async ({
    page,
  }) => {
    await page.goto("/dashboard/menu-profit")
    await expect(page).toHaveURL(/\/dashboard\/menu-profit/)

    // KPI strip: real currency figures in the brief.
    await expect(page.locator("body")).toContainText(/revenue/i, {
      timeout: 20_000,
    })
    await expect(page.locator("body")).toContainText(/\$[\d,]+/, {
      timeout: 20_000,
    })

    // Quadrant scatter with its corner labels.
    await expect(page.getByText(/profit matrix/i)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/stars — protect these/i)).toBeVisible()
    // Recharts mounts its <svg> after ResizeObserver reports a size —
    // auto-wait instead of a same-tick count().
    await expect(
      page.locator("section:has-text('Profit matrix') svg").first()
    ).toBeVisible({ timeout: 20_000 })

    // Per-item ledger has rows.
    const table = page.getByTestId("menu-profit-table")
    await expect(table).toBeVisible({ timeout: 20_000 })
    await expect(table.locator("tbody tr").first()).toBeVisible()

    // The honesty strip is always present.
    await expect(page.getByTestId("coverage-strip")).toBeVisible()
  })

  test("lookback presets re-render the window", async ({ page }) => {
    await page.goto("/dashboard/menu-profit?days=90")

    const active = page.locator('a[aria-current="true"]')
    await expect(active).toHaveText(/90d/i, { timeout: 15_000 })
    await expect(page.locator("body")).toContainText(/revenue · 90d/i, {
      timeout: 20_000,
    })

    await page.getByRole("link", { name: /^7d$/i }).click()
    await expect(page).toHaveURL(/days=7/)
    await expect(page.locator("body")).toContainText(/revenue · 7d/i, {
      timeout: 20_000,
    })
  })
})
