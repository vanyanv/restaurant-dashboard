// scripts/test-otter-menu.ts
// Run with: npx tsx scripts/test-otter-menu.ts
// Tests menu category & item queries across date ranges and groupBy variations

import fs from "fs"
import path from "path"

function loadEnvLocal(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return {}
  const content = fs.readFileSync(envPath, "utf-8")
  const result: Record<string, string> = {}
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
    result[key] = val
  }
  return result
}

const env = loadEnvLocal()
const JWT = process.env.OTTER_JWT ?? env["OTTER_JWT"] ?? env["Bearer"]

if (!JWT) {
  console.error("Error: JWT not found. Add OTTER_JWT or Bearer to .env.local")
  process.exit(1)
}

const STORE_IDS = [
  "10b8d83b-db0e-4637-8ce6-ef3b60081f11",
  "2fb629b7-2a22-429c-80cf-de2ae6d4a662",
  "f8f941a6-9c18-49ed-896a-5b2213ba09a4",
  "3dff7900-1388-4332-8079-091c3bb96eb4",
  "701340d6-eeac-4a61-92ef-3bec103654ea",
  "8c836303-8d5d-4c32-b9d1-a1ca5325b191",
]

const HEADERS = {
  Authorization: `Bearer ${JWT}`,
  "Content-Type": "application/json",
  "application-name": "op-app-analytics",
  "application-version": "fddebf256f27323d4bb2dfe5e021eba83cdb8a41",
}

const MENU_ITEM_COLUMNS = [
  { type: "metric", key: "fp_order_items_quantity_sold" },
  { type: "metric", key: "fp_order_items_total_include_modifiers" },
  { type: "metric", key: "fp_order_items_total_sales" },
  { type: "metric", key: "third_party_item_quantity_sold" },
  { type: "metric", key: "third_party_item_total_include_modifiers" },
  { type: "metric", key: "third_party_item_total_sales" },
]

const SCOPE = [{ key: "store", values: STORE_IDS }]

function formatDate(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function buildBody(groupBy: Array<{ key: string }>, minDate: string, maxDate: string) {
  return {
    columns: MENU_ITEM_COLUMNS,
    groupBy,
    sortBy: [{ type: "metric", key: "fp_order_items_quantity_sold", sortOrder: "DESC" }],
    filterSet: [
      { filterType: "dateRangeFilter", minDate: `${minDate}T00:00:00.000Z`, maxDate: `${maxDate}T23:59:59.999Z` },
      { filterType: "categoryFilter", dimensionName: "is_parent", op: "IN", values: ["true"] },
    ],
    scopeSet: SCOPE,
    includeMetricsFilters: true,
    localTime: true,
    includeTotalRowCount: true,
    limit: 10000,
    includeRawQueries: false,
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface Test {
  label: string
  groupBy: Array<{ key: string }>
  startDate: string
  endDate: string
}

async function main() {
  const now = new Date()
  const today = formatDate(now)
  const sevenDaysAgo = formatDate(new Date(now.getTime() - 6 * 86400000))
  const thirtyDaysAgo = formatDate(new Date(now.getTime() - 29 * 86400000))

  console.log("Menu Category & Item Query Diagnostic")
  console.log(`Date: ${now.toDateString()}  |  Stores: ${STORE_IDS.length}`)
  console.log()

  // Test different groupBy combinations to find what works
  const tests: Test[] = [
    // 1. Exact match of working DevTools query (category only, no date/store)
    {
      label: "Categories only (no date/store groupBy) — 1 day",
      groupBy: [{ key: "menu_parent_entity_name" }],
      startDate: today,
      endDate: today,
    },
    // 2. Category + store (no date)
    {
      label: "Categories + store — 1 day",
      groupBy: [{ key: "menu_parent_entity_name" }, { key: "store" }],
      startDate: today,
      endDate: today,
    },
    // 3. Category + date (eod_date_with_timezone) — this 404'd before
    {
      label: "Categories + eod_date — 1 day",
      groupBy: [{ key: "menu_parent_entity_name" }, { key: "eod_date_with_timezone" }],
      startDate: today,
      endDate: today,
    },
    // 4. Category + date + store (full sync shape)
    {
      label: "Categories + eod_date + store — 1 day",
      groupBy: [{ key: "menu_parent_entity_name" }, { key: "eod_date_with_timezone" }, { key: "store" }],
      startDate: today,
      endDate: today,
    },
    // 5. Items only (no date/store)
    {
      label: "Items only (no date/store groupBy) — 1 day",
      groupBy: [{ key: "item" }, { key: "menu_parent_entity_name" }],
      startDate: today,
      endDate: today,
    },
    // 6. Items + store
    {
      label: "Items + store — 1 day",
      groupBy: [{ key: "item" }, { key: "menu_parent_entity_name" }, { key: "store" }],
      startDate: today,
      endDate: today,
    },
    // 7. Items + date
    {
      label: "Items + eod_date — 1 day",
      groupBy: [{ key: "item" }, { key: "menu_parent_entity_name" }, { key: "eod_date_with_timezone" }],
      startDate: today,
      endDate: today,
    },
    // 8. Items + date + store (full sync shape)
    {
      label: "Items + eod_date + store — 1 day",
      groupBy: [{ key: "item" }, { key: "menu_parent_entity_name" }, { key: "eod_date_with_timezone" }, { key: "store" }],
      startDate: today,
      endDate: today,
    },
    // 9. Categories only — 7 days
    {
      label: "Categories only — 7 days",
      groupBy: [{ key: "menu_parent_entity_name" }],
      startDate: sevenDaysAgo,
      endDate: today,
    },
    // 10. Categories only — 30 days
    {
      label: "Categories only — 30 days",
      groupBy: [{ key: "menu_parent_entity_name" }],
      startDate: thirtyDaysAgo,
      endDate: today,
    },
  ]

  for (let i = 0; i < tests.length; i++) {
    const test = tests[i]
    const body = buildBody(test.groupBy, test.startDate, test.endDate)
    const groupByKeys = test.groupBy.map((g) => g.key).join(", ")

    console.log(`[${i + 1}/${tests.length}] ${test.label}`)
    console.log(`  Range: ${test.startDate} to ${test.endDate}  |  GroupBy: ${groupByKeys}`)

    try {
      const res = await fetch("https://api.tryotter.com/analytics/table/metrics_explorer", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const text = await res.text()
        console.log(`  => ${res.status} ${res.statusText}  |  ${text.slice(0, 200)}`)
      } else {
        const data = await res.json()
        const rowCount = Array.isArray(data.rows) ? data.rows.length : "???"
        const total = data.totalRowCount != null ? ` / ${data.totalRowCount} total` : ""
        console.log(`  => 200 OK  |  Rows: ${rowCount}${total}`)
        // Print first 3 rows as sample
        if (Array.isArray(data.rows)) {
          for (const row of data.rows.slice(0, 3)) {
            const flat: Record<string, unknown> = {}
            for (const cell of row) {
              if (cell.value !== null) flat[cell.key] = cell.value
            }
            console.log(`     `, flat)
          }
          if (data.rows.length > 3) console.log(`     ... and ${data.rows.length - 3} more rows`)
        }
      }
    } catch (err) {
      console.log(`  => Network error: ${err}`)
    }

    console.log()
    if (i < tests.length - 1) await sleep(2000)
  }

  console.log("Done.")
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
