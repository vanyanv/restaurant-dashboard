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

    // The trigger is the CUSTOM pill (`CustomPillTrigger`). The previous
    // matcher — today|yesterday|week|month|range|\d{4} — never matched it, and
    // the whole body sat inside `if (await dateTrigger.count())`, so this test
    // passed without opening a sheet or asserting anything. A regression test
    // that cannot fail is worse than no test: it reports the regression as
    // covered. Assert the trigger exists so a rename fails loudly here instead.
    const dateTrigger = page.getByRole("button", { name: /custom/i }).first()
    await expect(dateTrigger, "date sheet trigger is on /m/pnl").toBeVisible()

    await dateTrigger.click()

    const sheet = page.locator(".m-sheet").first()
    await expect(sheet, "the sheet opened").toBeVisible()

    // The regression itself: the sheet has to paint above its own backdrop.
    const stacking = await sheet.evaluate((el) => {
      const backdrop = document.querySelector(
        ".m-sheet-backdrop, [data-sheet-backdrop], [data-slot=sheet-overlay]",
      )
      const z = (n: Element | null) =>
        n ? Number.parseInt(getComputedStyle(n).zIndex || "0", 10) || 0 : null
      return { sheet: z(el), backdrop: z(backdrop) }
    })
    if (stacking.backdrop !== null) {
      expect(
        stacking.sheet,
        "sheet paints above its backdrop",
      ).toBeGreaterThanOrEqual(stacking.backdrop)
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
