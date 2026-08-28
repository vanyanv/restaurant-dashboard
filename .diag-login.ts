import fs from "fs"
import { chromium } from "playwright"

const env: Record<string,string> = {}
for (const line of fs.readFileSync("/home/vardan/restaurant-dashboard/.env.local","utf-8").split("\n")) {
  const t = line.trim(); if (!t || t.startsWith("#")) continue
  const i = t.indexOf("="); if (i === -1) continue
  env[t.slice(0,i).trim()] = t.slice(i+1).trim().replace(/^["']|["']$/g,"")
}
const SIGN_IN_URL = "https://manager.tryotter.com/api/users/sign_in"

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled"] })
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
  })
  const page = await context.newPage()
  await page.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => false }) })

  // TEST 1: networkidle (what prod does)
  const t0 = Date.now()
  try {
    await page.goto("https://manager.tryotter.com", { waitUntil: "networkidle", timeout: 30000 })
    console.log(`TEST1 networkidle: OK in ${Date.now()-t0}ms`)
  } catch (e) {
    console.log(`TEST1 networkidle: FAILED after ${Date.now()-t0}ms — ${(e as Error).message.split("\n")[0]}`)
  }

  // TEST 2: domcontentloaded + wait for the email field
  const t1 = Date.now()
  let jwt: string | undefined
  page.on("response", async (r) => {
    if (r.url() === SIGN_IN_URL && r.status() === 200) {
      const a = r.headers()["authorization"]; if (a) jwt = a.replace("Bearer ", "")
    }
  })
  try {
    await page.goto("https://manager.tryotter.com", { waitUntil: "domcontentloaded", timeout: 30000 })
    await page.waitForSelector('[data-testid="op-auth_email-field"]', { timeout: 30000 })
    console.log(`TEST2 domcontentloaded+selector: OK in ${Date.now()-t1}ms; url=${page.url()}`)
    await page.fill('[data-testid="op-auth_email-field"]', env.OTTER_EMAIL)
    await page.fill('[data-testid="op-auth_password-field"]', env.OTTER_PASSWORD)
    await page.click('[data-testid="op-auth_login-button"]')
    await page.waitForResponse((r) => r.url() === SIGN_IN_URL && r.status() === 200, { timeout: 30000 })
    console.log(`TEST2 sign-in: OK, jwt len=${jwt?.length}`)
    if (jwt) fs.writeFileSync("/tmp/claude-1000/-home-vardan-restaurant-dashboard/a21d4344-6cd9-4d06-afea-347bbbde43e5/scratchpad/fresh.jwt", jwt)
  } catch (e) {
    console.log(`TEST2: FAILED after ${Date.now()-t1}ms — ${(e as Error).message.split("\n")[0]}; url=${page.url()}`)
    await page.screenshot({ path: "/tmp/claude-1000/-home-vardan-restaurant-dashboard/a21d4344-6cd9-4d06-afea-347bbbde43e5/scratchpad/login-fail.png", fullPage: true })
  }
  await browser.close()
}
main()
