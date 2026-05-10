import fs from "fs"
import path from "path"
function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  const c = fs.readFileSync(envPath, "utf-8")
  for (const line of c.split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const i = t.indexOf("=")
    if (i < 0) continue
    const k = t.slice(0, i).trim()
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvLocal()

import { buildLaborActualUrl, buildLaborForecastUrl, buildLaborCategoriesUrl, buildPositionsPayTypesUrl, buildTimekeepingAlertsUrl, harriFetch } from "../src/lib/harri"

async function probe(label: string, fn: () => Promise<unknown>) {
  try { await fn(); console.log("  " + label + ": OK") }
  catch (e) { const m = e instanceof Error ? e.message : String(e); console.log("  " + label + ": FAIL — " + m.slice(0,150)) }
}
async function main() {
  const brandId = 5756969
  const dates = ["2026-05-03","2026-05-04","2026-05-05","2026-05-06","2026-05-07","2026-05-08","2026-05-09"]
  for (const ds of dates) {
    const d = new Date(ds + "T00:00:00.000Z")
    console.log("\n=== " + ds + " ===")
    await probe("actual    ", () => harriFetch(buildLaborActualUrl(brandId, d)))
    await probe("forecast  ", () => harriFetch(buildLaborForecastUrl(brandId, d)))
    await probe("categories", () => harriFetch(buildLaborCategoriesUrl(brandId, d)))
    await probe("alerts    ", () => harriFetch(buildTimekeepingAlertsUrl(brandId, d)))
  }
  console.log("\n=== positions/pay_types weekly ===")
  await probe("05-03..05-09", () => harriFetch(buildPositionsPayTypesUrl(brandId, new Date("2026-05-03T00:00:00Z"), new Date("2026-05-09T00:00:00Z"))))
}
main().catch((e) => { console.error(e); process.exit(1) })
