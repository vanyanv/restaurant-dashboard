import { defineConfig, devices } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"

const envFile = path.resolve(__dirname, ".env.test.local")
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (!m) continue
    const [, key, raw] = m
    if (process.env[key]) continue
    process.env[key] = raw.replace(/^["']|["']$/g, "")
  }
}

/*
 * The suite gets its own port, and that is not a detail.
 *
 * `reuseExistingServer` below means Playwright will happily adopt whatever is
 * already listening. On 3000 that is normally `npm run dev` — and if the
 * checkout running it is on a different branch, the suite silently tests that
 * branch's pages with this branch's assertions. On 2026-08-28 that produced
 * three confident, reproducible failures on `main` (recipes' "AI proposals",
 * menu-profit's "profit matrix", the mobile date pill) that were really a
 * dashboardv2 dev server answering on 3000. The elements were all present in
 * main's source; the server just wasn't main's.
 *
 * 3100 is the suite's. `npm run dev` never binds it, so a reused server is
 * always one a previous e2e run started from this same checkout.
 */
const E2E_PORT = process.env.E2E_PORT ?? "3100"
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${E2E_PORT}`
const STORAGE_STATE = path.resolve(__dirname, "e2e/.auth/user.json")

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 1,
  reporter: process.env.CI ? "github" : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "desktop",
      testDir: "./e2e/desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: STORAGE_STATE,
      },
      dependencies: ["setup"],
    },
    {
      name: "mobile",
      testDir: "./e2e/mobile",
      use: {
        ...devices["Pixel 7"],
        storageState: STORAGE_STATE,
      },
      dependencies: ["setup"],
    },
  ],

  webServer: {
    command: `npm run dev -- --port ${E2E_PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      // The suite verifies the app itself; a SERVICE_SHUTDOWN_AT left active
      // in .env.local would otherwise blank every page for the e2e user.
      // Real process env beats .env files in Next, and "" is falsy to the gate.
      SERVICE_SHUTDOWN_AT: "",
      PORT: E2E_PORT,
    },
  },
})
