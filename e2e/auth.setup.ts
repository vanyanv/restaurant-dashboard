import { test as setup, expect } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"

const STORAGE_STATE = path.resolve(__dirname, ".auth/user.json")

setup("authenticate", async ({ page }) => {
  const email = process.env.E2E_USER_EMAIL
  const password = process.env.E2E_USER_PASSWORD

  if (!email || !password) {
    throw new Error(
      "E2E_USER_EMAIL and E2E_USER_PASSWORD must be set in .env.test.local",
    )
  }

  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true })

  await page.goto("/login")
  await page.locator("#email").fill(email)
  await page.locator("#password").fill(password)
  await page.getByRole("button", { name: /sign in/i }).click()

  // 60s, not 15s: on a cold `.next` the first request to the sign-in path
  // pays for a full Turbopack compile, which routinely outruns 15 seconds.
  // That surfaced as an `auth.setup.ts` timeout in three separate tasks and
  // was misread each time as broken credentials — the same misdiagnosis
  // `scripts/shot-page.ts`'s module comment was written to stop. A warm
  // server reaches /dashboard in well under a second, so this ceiling only
  // ever costs time on a run that was going to be slow anyway.
  await page.waitForURL(/\/dashboard(\/|$)/, { timeout: 60_000 })
  await expect(page).toHaveURL(/\/dashboard/)

  await page.context().storageState({ path: STORAGE_STATE })
})
