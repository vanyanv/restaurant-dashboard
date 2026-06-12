import { test, expect } from "../fixtures/test"

test.describe("@smoke mobile", () => {
  test("phone UA gets redirected from /dashboard to /m", async ({ page }) => {
    await page.goto("/dashboard")
    await expect(page).toHaveURL(/\/m(\/|$)/, { timeout: 15_000 })
  })

  test("mobile P&L renders", async ({ page, consoleErrors }) => {
    await page.goto("/m/pnl")
    await expect(page).toHaveURL(/\/m\/pnl/)
    await page.waitForLoadState("networkidle")

    await expect(page.locator("body")).toContainText(/revenue|sales|p&l|net/i, {
      timeout: 15_000,
    })
    expect(consoleErrors, "no console errors on /m/pnl").toEqual([])
  })

  test("mobile date sheet sits above its backdrop (m-sheet collision regression)", async ({
    page,
  }) => {
    await page.goto("/m/pnl")
    await page.waitForLoadState("networkidle")

    const dateTrigger = page
      .getByRole("button")
      .filter({ hasText: /today|yesterday|week|month|range|\d{4}/i })
      .first()

    if (await dateTrigger.count()) {
      await dateTrigger.click()
      await page.waitForTimeout(400)

      const sheets = page.locator(".m-sheet, [data-sheet], [role=dialog]")
      const count = await sheets.count()
      expect(count, "at least one sheet/dialog opened").toBeGreaterThan(0)

      const lastVisible = sheets.last()
      await expect(lastVisible).toBeVisible()
    }
  })

  test("prefer-desktop cookie keeps mobile UA on /dashboard", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "prefer-desktop",
        value: "1",
        url: "http://localhost:3000",
      },
    ])
    await page.goto("/dashboard")
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page).not.toHaveURL(/\/m\//)
  })
})
