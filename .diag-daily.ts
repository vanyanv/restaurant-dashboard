import fs from "fs"
import { buildDailySyncBody, FP_COLUMNS, THIRD_PARTY_COLUMNS, TILL_COLUMNS, ORDER_COUNT_COLUMN, utcMultiDayRange } from "./src/lib/otter"

const SP = "/tmp/claude-1000/-home-vardan-restaurant-dashboard/a21d4344-6cd9-4d06-afea-347bbbde43e5/scratchpad"
const jwt = fs.readFileSync(`${SP}/fresh.jwt`, "utf-8").trim()
const HEADERS = {
  "Content-Type": "application/json",
  "application-name": "op-app-analytics",
  "application-version": "fddebf256f27323d4bb2dfe5e021eba83cdb8a41",
  Authorization: `Bearer ${jwt}`,
}
const U = "https://api.tryotter.com/analytics/table/metrics_explorer"
const STORES = ["10b8d83b-db0e-4637-8ce6-ef3b60081f11","2fb629b7-2a22-429c-80cf-de2ae6d4a662"]
const end = new Date(); const start = new Date(Date.now() - 3*86400000)

async function t(label: string, body: object) {
  const r = await fetch(U, { method: "POST", headers: HEADERS, body: JSON.stringify(body) })
  const text = await r.text()
  let n = ""
  try { const j = JSON.parse(text); if (j.rows) n = ` rows=${j.rows.length}` } catch {}
  console.log(`[${label}] ${r.status}${n} :: ${r.ok ? "" : text.slice(0,200)}`)
  return r.status
}

async function main() {
  const { minDate, maxDate } = utcMultiDayRange(start, end)
  const base = {
    sortBy: [{ type: "dimension", key: "eod_date_with_timezone", sortOrder: "DESC" }],
    filterSet: [{ filterType: "dateRangeFilter", minDate, maxDate }],
    scopeSet: [{ key: "store", values: STORES }],
    includeMetricsFilters: true, localTime: true, includeTotalRowCount: false,
    limit: 15000, includeRawQueries: false,
  }
  const GB = [{ key: "eod_date_with_timezone" }, { key: "multi_value_pos_payment_method" }, { key: "pos_summary_ofo" }, { key: "store" }]

  await t("A full prod daily body", buildDailySyncBody(STORES, start, end))
  await t("B FP columns only", { ...base, groupBy: GB, columns: FP_COLUMNS })
  await t("C 3P columns only", { ...base, groupBy: GB, columns: THIRD_PARTY_COLUMNS })
  await t("D TILL columns only", { ...base, groupBy: GB, columns: TILL_COLUMNS })
  await t("E order_count only", { ...base, groupBy: GB, columns: [ORDER_COUNT_COLUMN] })
  await t("F full cols, no store groupBy", { ...base, groupBy: GB.slice(0,3), columns: [...FP_COLUMNS, ...THIRD_PARTY_COLUMNS, ...TILL_COLUMNS, ORDER_COUNT_COLUMN] })
  await t("G full cols, 1 store scope", { ...base, scopeSet: [{ key: "store", values: [STORES[0]] }], groupBy: GB, columns: [...FP_COLUMNS, ...THIRD_PARTY_COLUMNS, ...TILL_COLUMNS, ORDER_COUNT_COLUMN] })
  await t("H FP+3P+count (no till)", { ...base, groupBy: GB, columns: [...FP_COLUMNS, ...THIRD_PARTY_COLUMNS, ORDER_COUNT_COLUMN] })
}
main()
