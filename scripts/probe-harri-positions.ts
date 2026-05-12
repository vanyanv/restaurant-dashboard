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

import { buildPositionsPayTypesUrl, getHarriJwt } from "../src/lib/harri"

const HARRI_HEADERS: Record<string, string> = {
  accept: "*/*",
  origin: "https://harri.com",
  referer: "https://harri.com/",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
}

async function hit(label: string, url: string, jwt: string) {
  console.log(`\n--- ${label} ---`)
  console.log("URL:", url)
  const res = await fetch(url, {
    method: "GET",
    headers: { ...HARRI_HEADERS, authorization: `Bearer ${jwt}` },
  })
  const body = await res.text()
  console.log("HTTP:", res.status, res.statusText)
  console.log("Body:", body.length > 1500 ? body.slice(0, 1500) + "…[truncated]" : body)
}

async function main() {
  const jwt = await getHarriJwt()
  console.log("JWT obtained, length:", jwt.length)

  const brandId = 5756969

  // 1. Single-day call as the cron currently does (range start==end)
  await hit(
    "1-day window 2026-05-09",
    buildPositionsPayTypesUrl(brandId, new Date("2026-05-09T00:00:00Z"), new Date("2026-05-09T00:00:00Z")),
    jwt,
  )

  // 2. Multi-day call as the cron actually uses
  await hit(
    "7-day window 2026-05-03..2026-05-09",
    buildPositionsPayTypesUrl(brandId, new Date("2026-05-03T00:00:00Z"), new Date("2026-05-09T00:00:00Z")),
    jwt,
  )

  const base = `https://gateway.harri.com/lpm-api/api/v1/brands/${brandId}/stats/labor/categories/positions/pay_types`

  // 3. Try with `start_date`/`end_date` (alt param naming)
  await hit("alt: start_date/end_date", `${base}?start_date=2026-05-09&end_date=2026-05-09`, jwt)

  // 4. Try with `date` singular (matches the sibling labor endpoints)
  await hit("alt: date= ISO", `${base}?date=2026-05-09T14:00:00.000Z`, jwt)

  // 5. Try with no query params (some endpoints default to "today")
  await hit("alt: no params", base, jwt)

  // 6. Sanity: does the sibling /categories endpoint still work for the same brand/day?
  await hit(
    "sanity: categories (known-working)",
    `https://gateway.harri.com/lpm-api/api/v1/brands/${brandId}/stats/labor/categories?date=2026-05-09T14:00:00.000Z`,
    jwt,
  )

  // 7. Try the parent endpoint /categories/positions (without /pay_types)
  await hit(
    "alt: /categories/positions (no pay_types)",
    `https://gateway.harri.com/lpm-api/api/v1/brands/${brandId}/stats/labor/categories/positions?from_date=2026-05-09&to_date=2026-05-09`,
    jwt,
  )

  // 8. Try a single-day yesterday window
  await hit(
    "narrow 1-day 2026-05-11",
    buildPositionsPayTypesUrl(brandId, new Date("2026-05-11T00:00:00Z"), new Date("2026-05-11T00:00:00Z")),
    jwt,
  )

  // 9. Try with category_code filter
  await hit(
    "alt: with category_code=QS",
    `https://gateway.harri.com/lpm-api/api/v1/brands/${brandId}/stats/labor/categories/positions/pay_types?from_date=2026-05-09&to_date=2026-05-09&category_code=QS`,
    jwt,
  )

  // 10. Try a much older date (data might be available historically)
  await hit(
    "alt: older window 2026-04-01..2026-04-02",
    buildPositionsPayTypesUrl(brandId, new Date("2026-04-01T00:00:00Z"), new Date("2026-04-02T00:00:00Z")),
    jwt,
  )

  // 11. Sweep recent single days to see which dates the endpoint accepts
  const sweep = [
    "2026-05-05","2026-05-06","2026-05-07","2026-05-08","2026-05-09","2026-05-10","2026-05-11","2026-05-12",
  ]
  for (const ds of sweep) {
    const d = new Date(`${ds}T00:00:00Z`)
    await hit(`sweep ${ds}`, buildPositionsPayTypesUrl(brandId, d, d), jwt)
  }
}

main().catch((e) => {
  console.error("FATAL:", e)
  process.exit(1)
})
