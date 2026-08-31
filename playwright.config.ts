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

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000"
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

    /*
     * The fidelity gate — e2e/fidelity/. Same authentication and the same two
     * device profiles as the suite above, deliberately: a fidelity script
     * would have had to reimplement sign-in, which is the mistake
     * scripts/shot-page.ts's module comment records getting made repeatedly
     * and written off as "the credentials don't work."
     *
     * reducedMotion is set on both. The prototype animates its figures from
     * 86% of their value on every render (tickNumbers) and skips that entirely
     * under prefers-reduced-motion, so the text it renders is final rather
     * than mid-tween. Our own motion is stilled for the same reason.
     */
    {
      name: "fidelity",
      testDir: "./e2e/fidelity",
      // One fidelity test drives two pages (the prototype and ours), extracts
      // from both and attaches two screenshots. The 30s default is not enough
      // against a cold production build.
      timeout: 90_000,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: STORAGE_STATE,
        contextOptions: { reducedMotion: "reduce" },
      },
      dependencies: ["setup"],
    },
    {
      name: "fidelity-mobile",
      testDir: "./e2e/fidelity",
      timeout: 90_000,
      use: {
        ...devices["Pixel 7"],
        storageState: STORAGE_STATE,
        contextOptions: { reducedMotion: "reduce" },
      },
      dependencies: ["setup"],
    },
  ],

  webServer: {
    command: "npm run dev",
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
      // The clock the fidelity suite compares against, pinned for the same
      // reason the manifest pins `query: "?range=d7&cmp=weekday"` — so both
      // sides answer the same question. Unpinned, `trailingWeeks` includes the
      // running week clipped to today, and on a Monday that week is a day old
      // with nothing synced: no prime cost, so no `.mtr`, so a red gate one day
      // in seven. See `src/lib/counter/today.ts`; the override is ignored
      // wherever VERCEL_ENV is set, so it cannot move a deployment's clock.
      //
      // 2026-08-28 is a FRIDAY, chosen so the running week is partial and still
      // carries data. A Monday would reproduce the very gap this pin closes.
      COUNTER_TODAY: "2026-08-28",
    },
  },
})
