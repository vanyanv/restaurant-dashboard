// scripts/test-otter-menu-verify.ts
// Run with: npx tsx scripts/test-otter-menu-verify.ts
// Sends the EXACT queries from the Otter dashboard to verify data matches

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

const HEADERS = {
  Authorization: `Bearer ${JWT}`,
  "Content-Type": "application/json",
  "application-name": "op-app-analytics",
  "application-version": "fddebf256f27323d4bb2dfe5e021eba83cdb8a41",
}

const URL = "https://api.tryotter.com/analytics/table/metrics_explorer"

// Exact payload from Otter dashboard — Menu Category Report
const CATEGORY_REPORT_BODY = {
  columns: [
    { type: "metric", key: "fp_order_items_quantity_sold" },
    { type: "metric", key: "fp_order_items_total_include_modifiers" },
    { type: "metric", key: "fp_order_items_total_sales" },
    { type: "metric", key: "third_party_item_quantity_sold" },
    { type: "metric", key: "third_party_item_total_include_modifiers" },
    { type: "metric", key: "third_party_item_total_sales" },
  ],
  groupBy: [{ key: "menu_parent_entity_name" }],
  sortBy: [{ type: "metric", key: "fp_order_items_quantity_sold", sortOrder: "DESC" }],
  filterSet: [
    { filterType: "dateRangeFilter", minDate: "2026-02-23T00:00:00.000Z", maxDate: "2026-02-23T23:59:59.999Z" },
    { filterType: "categoryFilter", dimensionName: "is_parent", op: "IN", values: ["true"] },
  ],
  scopeSet: [
    {
      key: "store",
      values: [
        "10b8d83b-db0e-4637-8ce6-ef3b60081f11",
        "2fb629b7-2a22-429c-80cf-de2ae6d4a662",
        "f8f941a6-9c18-49ed-896a-5b2213ba09a4",
        "3dff7900-1388-4332-8079-091c3bb96eb4",
        "701340d6-eeac-4a61-92ef-3bec103654ea",
        "8c836303-8d5d-4c32-b9d1-a1ca5325b191",
      ],
    },
  ],
  includeMetricsFilters: true,
  localTime: true,
  includeTotalRowCount: true,
  includeRawQueries: false,
  limit: 10000,
}

// Exact payload from Otter dashboard — Menu Category Item Details
const ITEM_DETAILS_BODY = {
  columns: [
    { type: "metric", key: "fp_order_items_quantity_sold" },
    { type: "metric", key: "fp_order_items_total_include_modifiers" },
    { type: "metric", key: "fp_order_items_total_sales" },
    { type: "metric", key: "third_party_item_quantity_sold" },
    { type: "metric", key: "third_party_item_total_include_modifiers" },
    { type: "metric", key: "third_party_item_total_sales" },
  ],
  groupBy: [{ key: "item" }, { key: "menu_parent_entity_name" }],
  sortBy: [{ type: "metric", key: "fp_order_items_quantity_sold", sortOrder: "DESC" }],
  filterSet: [
    { filterType: "dateRangeFilter", minDate: "2026-02-23T00:00:00.000Z", maxDate: "2026-02-23T23:59:59.999Z" },
    { filterType: "categoryFilter", dimensionName: "is_parent", op: "IN", values: ["true"] },
  ],
  scopeSet: [
    {
      key: "store",
      values: [
        "10b8d83b-db0e-4637-8ce6-ef3b60081f11",
        "2fb629b7-2a22-429c-80cf-de2ae6d4a662",
        "f8f941a6-9c18-49ed-896a-5b2213ba09a4",
        "3dff7900-1388-4332-8079-091c3bb96eb4",
        "701340d6-eeac-4a61-92ef-3bec103654ea",
        "8c836303-8d5d-4c32-b9d1-a1ca5325b191",
      ],
    },
  ],
  includeMetricsFilters: true,
  localTime: true,
  includeTotalRowCount: false,
  limit: 500,
  includeRawQueries: false,
}

function fmt(val: number | null): string {
  if (val === null || val === undefined) return "-"
  if (Number.isInteger(val)) return val.toString()
  return `$${val.toFixed(2)}`
}

async function query(label: string, body: object) {
  console.log(`\n${"=".repeat(80)}`)
  console.log(`  ${label}`)
  console.log("=".repeat(80))

  const res = await fetch(URL, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`  ERROR: ${res.status} ${res.statusText}`)
    console.error(`  ${text.slice(0, 300)}`)
    return
  }

  const data = await res.json()
  const rows: Array<Array<{ key: string; value: string | number | null }>> = data.rows ?? []

  if (data.totalRowCount != null) {
    console.log(`  Total row count: ${data.totalRowCount}`)
  }
  console.log(`  Rows returned: ${rows.length}\n`)

  return rows
}

async function main() {
  console.log("Otter Menu Data Verification — 2026-02-23")
  console.log(`Stores: 6  |  Date: 2026-02-23`)

  // --- Query 1: Menu Category Report ---
  const catRows = await query("MENU CATEGORY REPORT", CATEGORY_REPORT_BODY)

  if (catRows) {
    // Print header
    console.log(
      "  " +
        "Category".padEnd(35) +
        "FP Qty".padStart(8) +
        "FP w/Mod".padStart(10) +
        "FP Sales".padStart(10) +
        "3P Qty".padStart(8) +
        "3P w/Mod".padStart(10) +
        "3P Sales".padStart(10)
    )
    console.log("  " + "-".repeat(91))

    for (const row of catRows) {
      const flat: Record<string, string | number | null> = {}
      for (const cell of row) flat[cell.key] = cell.value

      const cat = String(flat.menu_parent_entity_name ?? "???").slice(0, 34)
      console.log(
        "  " +
          cat.padEnd(35) +
          fmt(flat.fp_order_items_quantity_sold as number).padStart(8) +
          fmt(flat.fp_order_items_total_include_modifiers as number).padStart(10) +
          fmt(flat.fp_order_items_total_sales as number).padStart(10) +
          fmt(flat.third_party_item_quantity_sold as number).padStart(8) +
          fmt(flat.third_party_item_total_include_modifiers as number).padStart(10) +
          fmt(flat.third_party_item_total_sales as number).padStart(10)
      )
    }
  }

  await new Promise((r) => setTimeout(r, 1000))

  // --- Query 2: Menu Category Item Details ---
  const itemRows = await query("MENU CATEGORY ITEM DETAILS", ITEM_DETAILS_BODY)

  if (itemRows) {
    // Group items by category for readability
    const byCategory = new Map<string, Array<Record<string, string | number | null>>>()

    for (const row of itemRows) {
      const flat: Record<string, string | number | null> = {}
      for (const cell of row) flat[cell.key] = cell.value

      const cat = String(flat.menu_parent_entity_name ?? "Uncategorized")
      if (!byCategory.has(cat)) byCategory.set(cat, [])
      byCategory.get(cat)!.push(flat)
    }

    for (const [cat, items] of byCategory) {
      console.log(`\n  [${cat}]`)
      console.log(
        "    " +
          "Item".padEnd(40) +
          "FP Qty".padStart(8) +
          "FP w/Mod".padStart(10) +
          "FP Sales".padStart(10) +
          "3P Qty".padStart(8) +
          "3P w/Mod".padStart(10) +
          "3P Sales".padStart(10)
      )
      console.log("    " + "-".repeat(96))

      for (const item of items) {
        const name = String(item.item ?? "???").slice(0, 39)
        console.log(
          "    " +
            name.padEnd(40) +
            fmt(item.fp_order_items_quantity_sold as number).padStart(8) +
            fmt(item.fp_order_items_total_include_modifiers as number).padStart(10) +
            fmt(item.fp_order_items_total_sales as number).padStart(10) +
            fmt(item.third_party_item_quantity_sold as number).padStart(8) +
            fmt(item.third_party_item_total_include_modifiers as number).padStart(10) +
            fmt(item.third_party_item_total_sales as number).padStart(10)
        )
      }
    }
  }

  console.log("\n\nDone. Compare the above with your Otter dashboard.")
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
