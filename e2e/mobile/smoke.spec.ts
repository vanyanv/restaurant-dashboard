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

    // "Gross sales" is the Counter statement's first line; "Profit and loss"
    // is its title. Either way this only asserts the page RENDERED — what it
    // renders is `npm run fidelity`'s question, not this one's.
    await expect(page.locator("body")).toContainText(/gross sales|profit and loss/i, {
      timeout: 15_000,
    })
    expect(consoleErrors, "no console errors on /m/pnl").toEqual([])
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
