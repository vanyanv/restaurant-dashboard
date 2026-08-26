import { test as setup, expect } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"

const STORAGE_STATE = path.resolve(__dirname, ".auth/user.json")

setup("authenticate", async ({ page }) => {
  /*
   * The per-test timeout, not the assertion's.
   *
   * This step has failed as "Sign-in failed" on five separate tasks in this
   * project, and each time somebody raised a DIFFERENT ceiling and watched it
   * keep happening. The `waitForURL` below was taken from 15s to 60s and the
   * flake survived, because Playwright caps every assertion at the TEST's
   * timeout — 30s by default — so the 60s never applied. The error even says
   * so, and it was read as a `waitForURL` failure five times running:
   *
   *     Test timeout of 30000ms exceeded.
   *     Error: page.waitForURL: Test timeout of 30000ms exceeded.
   *
   * A cold `.next` compiles the sign-in path on first request and outruns 30s.
   * This ceiling only costs time on a run that was already going to be slow.
   */
  setup.setTimeout(180_000)

  const email = process.env.E2E_USER_EMAIL
  const password = process.env.E2E_USER_PASSWORD

  if (!email || !password) {
    throw new Error(
      "E2E_USER_EMAIL and E2E_USER_PASSWORD must be set in .env.test.local",
    )
  }

  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true })

  /*
   * Warm the routes before any assertion clock starts.
   *
   * On a cold `.next` the first request to a route pays for a full Turbopack
   * compile. Every timeout that cost is spent INSIDE a Playwright assertion,
   * so the failure reads "Sign-in failed" and the next person spends an hour
   * proving the credentials work — which has now happened on five separate
   * tasks in this project, each time with the database, the user rows and the
   * password hash verified by hand before anyone suspected the build.
   *
   * `page.request` bypasses the browser and takes no assertion timeout of its
   * own, so the compile happens here, once, and everything after it runs
   * against a warm server. On an already-warm server this costs a few
   * milliseconds. Failures are swallowed deliberately: this is a warm-up, not
   * a check — if the server is genuinely down, the `goto` below says so with
   * a far better message than a fetch would.
   */
  for (const route of ["/login", "/dashboard"]) {
    await page.request.get(route, { timeout: 180_000 }).catch(() => {})
  }

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
