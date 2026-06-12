import { test, expect } from "../fixtures/test"

test.describe("@smoke desktop", () => {
  test("dashboard loads after auth", async ({ page, consoleErrors }) => {
    await page.goto("/dashboard")
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page).not.toHaveURL(/\/login/)

    await page.waitForLoadState("networkidle")
    expect(consoleErrors, "no console errors on /dashboard").toEqual([])
  })

  test("P&L page renders financial layout", async ({ page }) => {
    await page.goto("/dashboard/pnl")
    await expect(page).toHaveURL(/\/dashboard\/pnl/)

    await expect(page.locator("body")).toContainText(/revenue|sales|p&l|net/i, {
      timeout: 15_000,
    })
  })

  test("sidebar nav links reach key dashboard routes", async ({ page }) => {
    await page.goto("/dashboard")

    const routes = [
      { path: "/dashboard/operations", expect: /operations|orders/i },
      { path: "/dashboard/cogs", expect: /cogs|cost/i },
      { path: "/dashboard/invoices", expect: /invoice/i },
    ]

    for (const r of routes) {
      await page.goto(r.path)
      await expect(page).toHaveURL(new RegExp(r.path.replace(/\//g, "\\/")))
      await expect(page.locator("body")).toContainText(r.expect, {
        timeout: 15_000,
      })
    }
  })
})
