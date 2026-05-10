// scripts/test-harri.ts
// Smoke test for the Harri (LiveWire) integration. Hits all 5 working
// endpoints for a given brandId+date and prints the parsed payload sizes
// + a one-line summary so we can verify auth + endpoint shape end-to-end.
//
// Usage:
//   pnpm tsx scripts/test-harri.ts                           # uses defaults
//   pnpm tsx scripts/test-harri.ts --brand=5756969 --date=2026-05-08
//   pnpm tsx scripts/test-harri.ts --brand=5756969 --week-start=2026-04-27

import fs from "fs"
import path from "path"

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  const content = fs.readFileSync(envPath, "utf-8")
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[key]) process.env[key] = val
  }
}
loadEnvLocal()

import {
  buildLaborActualUrl,
  buildLaborForecastUrl,
  buildLaborCategoriesUrl,
  buildPositionsPayTypesUrl,
  buildTimekeepingAlertsUrl,
  harriFetch,
  harriCentsToUSD,
  type HarriEnvelope,
  type HarriLaborTotal,
  type HarriLaborCategoriesResponse,
  type HarriPositionsPayTypesResponse,
  type HarriAlertsResponse,
} from "../src/lib/harri"

function parseArg(name: string): string | null {
  const prefix = `--${name}=`
  const arg = process.argv.find((a) => a.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : null
}

async function main() {
  const brandId = Number(parseArg("brand") ?? "5756969")
  const date = new Date(parseArg("date") ?? "2026-05-08T14:00:00.000Z")
  const weekStart = new Date(parseArg("week-start") ?? "2026-04-27")
  const weekEnd = new Date(weekStart)
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)

  console.log(`\n=== Harri smoke test ===`)
  console.log(`brand:      ${brandId}`)
  console.log(`date:       ${date.toISOString()}`)
  console.log(`week range: ${weekStart.toISOString().slice(0, 10)} -> ${weekEnd.toISOString().slice(0, 10)}`)
  console.log()

  // 1. Daily actual
  const actual = await harriFetch<HarriEnvelope<HarriLaborTotal>>(buildLaborActualUrl(brandId, date))
  console.log(
    `[1] /stats/labor (actual)         status=${actual.status} total=$${harriCentsToUSD(actual.data.total_labor_cost)?.toFixed(2)}`
  )

  // 2. Daily forecast
  const forecast = await harriFetch<HarriEnvelope<HarriLaborTotal>>(buildLaborForecastUrl(brandId, date))
  console.log(
    `[2] /stats/labor/forecast         status=${forecast.status} total=$${harriCentsToUSD(forecast.data.total_labor_cost)?.toFixed(2)}`
  )

  // 3. Daily categories
  const cats = await harriFetch<HarriEnvelope<HarriLaborCategoriesResponse>>(buildLaborCategoriesUrl(brandId, date))
  console.log(
    `[3] /stats/labor/categories       status=${cats.status} total=$${harriCentsToUSD(cats.data.total_labor_cost)?.toFixed(2)} categories=${cats.data.categories.length}`
  )
  for (const c of cats.data.categories) {
    console.log(`        - ${c.code} (${c.name}): $${harriCentsToUSD(c.total_labor_cost)?.toFixed(2)}`)
  }

  // 4. Positions x pay_types (week range)
  const positions = await harriFetch<HarriEnvelope<HarriPositionsPayTypesResponse>>(
    buildPositionsPayTypesUrl(brandId, weekStart, weekEnd)
  )
  console.log(
    `[4] /labor/categories/positions/pay_types  status=${positions.status} days=${positions.data.days.length}`
  )
  for (const day of positions.data.days) {
    let dayTotal = 0
    let posCount = 0
    for (const cat of day.categories) {
      for (const pos of cat.positions) {
        const block = pos.hourly ?? pos.salaried
        if (!block) continue
        dayTotal += block.total_labor || 0
        posCount += 1
      }
    }
    console.log(`        ${day.date}: $${harriCentsToUSD(dayTotal)?.toFixed(2)} across ${posCount} positions`)
  }

  // 5. Timekeeping alerts (single day)
  const alertsDay = new Date(date)
  const alerts = await harriFetch<HarriEnvelope<HarriAlertsResponse>>(buildTimekeepingAlertsUrl(brandId, alertsDay))
  console.log(`[5] /timekeeping-alert/.../alerts  alerts=${alerts.data.alerts.length}`)
  const tally: Record<string, number> = {}
  for (const a of alerts.data.alerts) tally[a.alert_type.code] = (tally[a.alert_type.code] || 0) + 1
  for (const [code, n] of Object.entries(tally).sort()) {
    console.log(`        ${code}: ${n}`)
  }

  console.log(`\nAll endpoints returned 2xx with parseable data. Auth + endpoint shape verified.`)
}

main().catch((err) => {
  console.error("test-harri failed:", err)
  process.exit(1)
})
