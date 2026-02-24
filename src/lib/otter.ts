/** Build UTC midnight ISO strings for a local calendar date (matches Otter's format). */
export function utcDayRange(date: Date): { minDate: string; maxDate: string } {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  return {
    minDate: `${yyyy}-${mm}-${dd}T00:00:00.000Z`,
    maxDate: `${yyyy}-${mm}-${dd}T23:59:59.999Z`,
  }
}

/** Build UTC range spanning multiple local calendar days. */
export function utcMultiDayRange(
  start: Date,
  end: Date
): { minDate: string; maxDate: string } {
  const s = utcDayRange(start)
  const e = utcDayRange(end)
  return { minDate: s.minDate, maxDate: e.maxDate }
}

const OTTER_BASE_URL = "https://api.tryotter.com/analytics/table/metrics_explorer"

const OTTER_HEADERS = {
  "Content-Type": "application/json",
  "application-name": "op-app-analytics",
  "application-version": "fddebf256f27323d4bb2dfe5e021eba83cdb8a41",
}

export const FP_COLUMNS = [
  { type: "metric", key: "fp_sales_financials_gross_sales" },
  { type: "metric", key: "fp_sales_financials_net_sales" },
  { type: "metric", key: "fp_sales_financials_discounts" },
  { type: "metric", key: "fp_sales_financials_fees" },
  { type: "metric", key: "fp_sales_financials_lost_revenue" },
  { type: "metric", key: "fp_sales_financials_tax_collected" },
  { type: "metric", key: "fp_sales_financials_tax_remitted" },
  { type: "metric", key: "fp_sales_financials_tips" },
  { type: "metric", key: "fp_sales_financials_service_charges" },
  { type: "metric", key: "fp_sales_financials_loyalty" },
]

export const THIRD_PARTY_COLUMNS = [
  { type: "metric", key: "third_party_gross_sales" },
  { type: "metric", key: "third_party_net_sales" },
  { type: "metric", key: "third_party_fees" },
  { type: "metric", key: "third_party_tax_collected" },
  { type: "metric", key: "third_party_tax_remitted" },
  { type: "metric", key: "third_party_discounts" },
  { type: "metric", key: "third_party_refunds_adjustments" },
  { type: "metric", key: "third_party_service_charges" },
  { type: "metric", key: "third_party_tip_for_restaurant" },
  { type: "metric", key: "third_party_loyalty_discount" },
]

export const ORDER_COUNT_COLUMN = { type: "metric", key: "order_count" }

export const TILL_COLUMNS = [
  { type: "metric", key: "enriched_till_report_paid_in" },
  { type: "metric", key: "enriched_till_report_paid_out" },
]

export const ORDERS_TIME_COL = {
  colName: "reference_time_local_without_tz",
  type: "instant",
  unit: "EpochMillis",
  supportsLocalTime: true,
  secondaryTimeCol: {
    padding: "P30D",
    offset: "PT0S",
    timeCol: {
      colName: "partition_source_timestamp_seconds",
      type: "instant",
      unit: "EpochSeconds",
      supportsLocalTime: false,
    },
  },
}

export const MENU_ITEM_COLUMNS = [
  { type: "metric", key: "fp_order_items_quantity_sold" },
  { type: "metric", key: "fp_order_items_total_include_modifiers" },
  { type: "metric", key: "fp_order_items_total_sales" },
  { type: "metric", key: "third_party_item_quantity_sold" },
  { type: "metric", key: "third_party_item_total_include_modifiers" },
  { type: "metric", key: "third_party_item_total_sales" },
]

export function buildMenuCategorySyncBody(
  otterStoreIds: string[],
  date: Date
): object {
  const { minDate, maxDate } = utcDayRange(date)

  return {
    columns: MENU_ITEM_COLUMNS,
    groupBy: [
      { key: "menu_parent_entity_name" },
    ],
    sortBy: [{ type: "metric", key: "fp_order_items_quantity_sold", sortOrder: "DESC" }],
    filterSet: [
      { filterType: "dateRangeFilter", minDate, maxDate },
      { filterType: "categoryFilter", dimensionName: "is_parent", op: "IN", values: ["true"] },
    ],
    scopeSet: [{ key: "store", values: otterStoreIds }],
    includeMetricsFilters: true,
    localTime: true,
    includeTotalRowCount: false,
    limit: 10000,
    includeRawQueries: false,
  }
}

export function buildMenuItemSyncBody(
  otterStoreIds: string[],
  date: Date
): object {
  const { minDate, maxDate } = utcDayRange(date)

  return {
    columns: MENU_ITEM_COLUMNS,
    groupBy: [
      { key: "item" },
      { key: "menu_parent_entity_name" },
    ],
    sortBy: [{ type: "metric", key: "fp_order_items_quantity_sold", sortOrder: "DESC" }],
    filterSet: [
      { filterType: "dateRangeFilter", minDate, maxDate },
      { filterType: "categoryFilter", dimensionName: "is_parent", op: "IN", values: ["true"] },
    ],
    scopeSet: [{ key: "store", values: otterStoreIds }],
    includeMetricsFilters: true,
    localTime: true,
    includeTotalRowCount: false,
    limit: 15000,
    includeRawQueries: false,
  }
}

export interface OtterRow {
  [key: string]: string | number | null
}

// --- Auto-login JWT cache ---
const SIGN_IN_URL = "https://api.tryotter.com/users/sign_in"
let cachedJwt: string | null = null
let cachedJwtExp = 0 // unix seconds

function decodeJwtExp(jwt: string): number {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString())
    return payload.exp ?? 0
  } catch {
    return 0
  }
}

async function getOtterJwt(): Promise<string> {
  // 1. Static env var takes priority (backward-compatible for scripts / CI)
  const envJwt = process.env.OTTER_JWT ?? process.env.Bearer
  if (envJwt) return envJwt

  // 2. Return cached JWT if still valid (1-hour buffer)
  const now = Math.floor(Date.now() / 1000)
  if (cachedJwt && cachedJwtExp - now > 3600) return cachedJwt

  // 3. Login with email/password
  const email = process.env.OTTER_EMAIL
  const password = process.env.OTTER_PASSWORD
  if (!email || !password) {
    throw new Error(
      "Otter auth requires either OTTER_JWT or both OTTER_EMAIL + OTTER_PASSWORD env vars"
    )
  }

  const res = await fetch(SIGN_IN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "*/*",
      "Origin": "https://manager.tryotter.com",
      "Referer": "https://manager.tryotter.com/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({ email, password }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Otter sign-in failed (${res.status}): ${text}`)
  }

  const data = await res.json()
  const jwt = data.accessToken as string | undefined
  if (!jwt) {
    throw new Error("Otter sign-in response missing accessToken")
  }

  cachedJwt = jwt
  cachedJwtExp = decodeJwtExp(jwt)
  return jwt
}

export async function queryMetrics(body: object): Promise<OtterRow[]> {
  const jwt = await getOtterJwt()

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)

  let response: Response
  try {
    response = await fetch(OTTER_BASE_URL, {
      method: "POST",
      headers: {
        ...OTTER_HEADERS,
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timeout)
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Otter API request timed out after 30s")
    }
    throw err
  }
  clearTimeout(timeout)

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Otter API error ${response.status}: ${text}`)
  }

  const data = await response.json()

  if (!data.rows || !Array.isArray(data.rows)) {
    throw new Error(`Unexpected Otter API response shape: ${JSON.stringify(data).slice(0, 200)}`)
  }

  // Flatten cell array into key-value object
  return data.rows.map((row: Array<{ key: string; value: string | number | null }>) => {
    const flat: OtterRow = {}
    for (const cell of row) {
      flat[cell.key] = cell.value
    }
    return flat
  })
}

export function getDateRange(startDate: Date, endDate: Date): Date[] {
  const dates: Date[] = []
  const current = new Date(startDate)
  current.setHours(0, 0, 0, 0)
  const end = new Date(endDate)
  end.setHours(0, 0, 0, 0)

  while (current <= end) {
    dates.push(new Date(current))
    current.setDate(current.getDate() + 1)
  }
  return dates
}

export function buildDailySyncBody(
  otterStoreIds: string[],
  startDate: Date,
  endDate: Date
): object {
  const { minDate, maxDate } = utcMultiDayRange(startDate, endDate)

  return {
    columns: [...FP_COLUMNS, ...THIRD_PARTY_COLUMNS, ...TILL_COLUMNS, ORDER_COUNT_COLUMN],
    groupBy: [
      { key: "eod_date_with_timezone" },
      { key: "multi_value_pos_payment_method" },
      { key: "pos_summary_ofo" },
      { key: "store" },
    ],
    sortBy: [{ type: "dimension", key: "eod_date_with_timezone", sortOrder: "DESC" }],
    filterSet: [{ filterType: "dateRangeFilter", minDate, maxDate }],
    scopeSet: [{ key: "store", values: otterStoreIds }],
    includeMetricsFilters: true,
    localTime: true,
    includeTotalRowCount: false,
    limit: 15000,
    includeRawQueries: false,
  }
}
