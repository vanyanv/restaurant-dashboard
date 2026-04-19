/** Build UTC midnight ISO strings for a local calendar date (matches Otter's format). */
export function utcDayRange(date: Date): { minDate: string; maxDate: string } {
  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(date.getUTCDate()).padStart(2, "0")
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
const OTTER_RATINGS_URL = "https://api.tryotter.com/analytics/table/order_performance_cullinan"

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

export const RATING_COLUMNS = [
  { type: "field", key: "external_review_id" },
  { type: "field", key: "brand_name" },
  { type: "field", key: "facility_name" },
  { type: "field", key: "store_name" },
  { type: "field", key: "order_reviewed_at" },
  { type: "field", key: "ofo_slug" },
  { type: "field", key: "order_review_full_text" },
  { type: "field", key: "order_rating" },
  { type: "field", key: "external_order_id" },
  { type: "field", key: "order_items_names" },
]

export function buildRatingsBody(
  otterStoreIds: string[],
  startDate: Date,
  endDate: Date
): object {
  const { minDate, maxDate } = utcMultiDayRange(startDate, endDate)

  return {
    scopeSet: [{ key: "store", values: otterStoreIds }],
    columns: RATING_COLUMNS,
    dataset: "ratings_with_customer_orders",
    filterSet: [
      { filterType: "dateRangeFilter", maxDate, minDate },
      { filterType: "namedFilter", name: "excludeFacilitiesWithDataIssues" },
      { filterType: "namedFilter", name: "invalidCurrency" },
    ],
    sortBy: [
      { type: "field", key: "order_reviewed_at", sortOrder: "DESC" },
      { type: "field", key: "external_order_id", sortOrder: "DESC" },
    ],
    limit: 5000,
    paginate: true,
  }
}

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

export function buildModifierSyncBody(
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
      { filterType: "categoryFilter", dimensionName: "is_parent", op: "IN", values: ["false"] },
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
const SIGN_IN_URL = "https://manager.tryotter.com/api/users/sign_in"
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

const MAX_RETRIES = 3
const RETRY_BASE_MS = 2000

async function queryOtterEndpoint(url: string, body: object): Promise<OtterRow[]> {
  const jwt = await getOtterJwt()

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)

    let response: Response
    try {
      response = await fetch(url, {
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

    if (response.status === 403 && attempt < MAX_RETRIES) {
      const backoff = RETRY_BASE_MS * attempt
      console.log(`Otter API 403 — retrying in ${backoff / 1000}s (attempt ${attempt}/${MAX_RETRIES})`)
      await new Promise((r) => setTimeout(r, backoff))
      continue
    }

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

  throw new Error("Otter API: max retries exceeded")
}

export async function queryMetrics(body: object): Promise<OtterRow[]> {
  return queryOtterEndpoint(OTTER_BASE_URL, body)
}

export async function queryRatings(body: object): Promise<OtterRow[]> {
  return queryOtterEndpoint(OTTER_RATINGS_URL, body)
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

export const CUSTOMER_ORDER_COLUMNS = [
  { type: "field", key: "reference_time_local_without_tz" },
  { type: "field", key: "order_id" },
  { type: "field", key: "external_order_display_id" },
  { type: "field", key: "store_id" },
  { type: "field", key: "ofo_slug" },
  { type: "field", key: "facility_name" },
  { type: "field", key: "order_status" },
  { type: "field", key: "acceptance_status" },
  { type: "field", key: "fulfillment_mode" },
  { type: "field", key: "subtotal" },
  { type: "field", key: "tax" },
  { type: "field", key: "tip" },
  { type: "field", key: "restaurant_funded_discount" },
  { type: "field", key: "ofo_funded_discount" },
  { type: "dimension", key: "total_with_tip" },
  { type: "dimension", key: "adjusted_commission" },
]

export function buildCustomerOrdersBody(
  otterStoreIds: string[],
  startDate: Date,
  endDate: Date
): object {
  const { minDate, maxDate } = utcMultiDayRange(startDate, endDate)

  return {
    columns: CUSTOMER_ORDER_COLUMNS,
    sortBy: [
      { type: "field", key: "reference_time_local_without_tz", sortOrder: "DESC" },
      { type: "field", key: "order_id", sortOrder: "DESC" },
    ],
    filterSet: [
      { filterType: "dateRangeFilter", minDate, maxDate },
      { filterType: "namedFilter", name: "excludeD2cPreorders" },
      { filterType: "namedFilter", name: "excludeFacilitiesWithDataIssues" },
      { filterType: "namedFilter", name: "invalidCurrency" },
    ],
    scopeSet: [{ key: "store", values: otterStoreIds }],
    dataset: "customer_orders",
    localTime: true,
    includeTotalRowCount: true,
    paginate: true,
    timeCol: ORDERS_TIME_COL,
    useRealTimeDataset: false,
    limit: 5000,
  }
}

// ─── GraphQL client for per-order details ───

const OTTER_GRAPHQL_URL = "https://api.tryotter.com/graphql"

const ORDER_DETAILS_QUERY = `query OrderDetails($input: OrderDetailsInput!) {
  orderDetails(input: $input) {
    ... on OrderDetailsResponse {
      metadata {
        internalId
        externalId
        displayId
        ofo { slug }
        store {
          id
          facilityV2 { id name }
          restrictedBrand { id name }
        }
        isTest
      }
      details {
        referenceTime
        referenceTimeLocalWithoutTz
        orderState
        subtotal { units nanos }
        tax { units nanos }
        tip { units nanos }
        commission { units nanos }
        discount { units nanos }
        ofoFundedDiscount { units nanos }
        total { units nanos }
        fulfillmentInfo { fulfillmentMode }
        customerName
      }
      items {
        skuId
        name
        quantity
        price { units nanos }
        subItems {
          skuId
          name
          quantity
          subHeader
          price { units nanos }
        }
      }
    }
  }
}`

function moneyToFloat(m: { units?: number | null; nanos?: number | null } | null | undefined): number {
  if (!m) return 0
  const u = m.units ?? 0
  const n = m.nanos ?? 0
  return u + n / 1_000_000_000
}

export type OrderDetailsPayload = {
  metadata: {
    internalId: string
    externalId: string | null
    displayId: string | null
    ofo: { slug: string } | null
    store: {
      id: string
      facilityV2: { id: string; name: string } | null
      restrictedBrand: { id: string; name: string } | null
    }
    isTest: boolean
  }
  details: {
    referenceTime: string
    referenceTimeLocalWithoutTz: string
    orderState: string | null
    subtotal: number
    tax: number
    tip: number
    commission: number
    discount: number
    ofoFundedDiscount: number
    total: number
    fulfillmentMode: string | null
    customerName: string | null
  }
  items: Array<{
    skuId: string
    name: string
    quantity: number
    price: number
    subItems: Array<{
      skuId: string
      name: string
      quantity: number
      subHeader: string | null
      price: number
    }>
  }>
}

/** POST a GraphQL operation to Otter. Shares the retry + timeout pattern of queryOtterEndpoint. */
async function queryOtterGraphQL<T>(
  operationName: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const jwt = await getOtterJwt()

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)

    let response: Response
    try {
      response = await fetch(OTTER_GRAPHQL_URL, {
        method: "POST",
        headers: {
          ...OTTER_HEADERS,
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ operationName, query, variables }),
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timeout)
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(`Otter GraphQL ${operationName} timed out after 30s`)
      }
      throw err
    }
    clearTimeout(timeout)

    if (response.status === 403 && attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_BASE_MS * attempt))
      continue
    }

    if (!response.ok) {
      const text = await response.text()
      throw new Error(
        `Otter GraphQL ${operationName} error ${response.status}: ${text.slice(0, 300)}`
      )
    }

    const data = await response.json()
    if (data.errors && data.errors.length > 0) {
      throw new Error(
        `Otter GraphQL ${operationName} returned errors: ${JSON.stringify(data.errors).slice(0, 300)}`
      )
    }
    return data.data as T
  }

  throw new Error(`Otter GraphQL ${operationName}: max retries exceeded`)
}

/** Fetch enriched per-order details (items + subItems) for a single Otter orderId. */
export async function fetchOrderDetails(
  orderId: string
): Promise<OrderDetailsPayload | null> {
  type Response = {
    orderDetails: {
      metadata: OrderDetailsPayload["metadata"]
      details: {
        referenceTime: string
        referenceTimeLocalWithoutTz: string
        orderState: string | null
        subtotal: { units: number; nanos: number } | null
        tax: { units: number; nanos: number } | null
        tip: { units: number; nanos: number } | null
        commission: { units: number; nanos: number } | null
        discount: { units: number; nanos: number } | null
        ofoFundedDiscount: { units: number; nanos: number } | null
        total: { units: number; nanos: number } | null
        fulfillmentInfo: { fulfillmentMode: string | null } | null
        customerName: string | null
      }
      items: Array<{
        skuId: string
        name: string
        quantity: number
        price: { units: number; nanos: number } | null
        subItems: Array<{
          skuId: string
          name: string
          quantity: number
          subHeader: string | null
          price: { units: number; nanos: number } | null
        }> | null
      }>
    } | null
  }

  const data = await queryOtterGraphQL<Response>(
    "OrderDetails",
    ORDER_DETAILS_QUERY,
    { input: { enrichData: true, orderId } }
  )
  if (!data?.orderDetails) return null

  const od = data.orderDetails
  return {
    metadata: od.metadata,
    details: {
      referenceTime: od.details.referenceTime,
      referenceTimeLocalWithoutTz: od.details.referenceTimeLocalWithoutTz,
      orderState: od.details.orderState,
      subtotal: moneyToFloat(od.details.subtotal),
      tax: moneyToFloat(od.details.tax),
      tip: moneyToFloat(od.details.tip),
      commission: moneyToFloat(od.details.commission),
      discount: moneyToFloat(od.details.discount),
      ofoFundedDiscount: moneyToFloat(od.details.ofoFundedDiscount),
      total: moneyToFloat(od.details.total),
      fulfillmentMode: od.details.fulfillmentInfo?.fulfillmentMode ?? null,
      customerName: od.details.customerName,
    },
    items: od.items.map((it) => ({
      skuId: it.skuId,
      name: it.name,
      quantity: it.quantity,
      price: moneyToFloat(it.price),
      subItems: (it.subItems ?? []).map((si) => ({
        skuId: si.skuId,
        name: si.name,
        quantity: si.quantity,
        subHeader: si.subHeader,
        price: moneyToFloat(si.price),
      })),
    })),
  }
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

// ─── Batched category builder (all stores in one call via store groupBy) ───
// Note: eod_date_with_timezone is NOT available in the order_items dataset,
// so categories still need per-day date filters. Items/modifiers also can't
// use store groupBy (500 error), so they stay per-store-per-day.

export function buildMenuCategoryBatchBody(
  otterStoreIds: string[],
  date: Date
): object {
  const { minDate, maxDate } = utcDayRange(date)

  return {
    columns: MENU_ITEM_COLUMNS,
    groupBy: [
      { key: "menu_parent_entity_name" },
      { key: "store" },
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

// ─── Shared utilities ───

/** Run async tasks with a concurrency limit (worker-pool pattern). */
export async function withConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
  onProgress?: (completed: number, total: number) => void
): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let nextIndex = 0
  let completed = 0

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++
      results[index] = await tasks[index]()
      completed++
      onProgress?.(completed, tasks.length)
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    () => worker()
  )
  await Promise.all(workers)
  return results
}

/** Split a date range into sub-ranges of at most maxDays each. */
export function splitDateRange(
  start: Date,
  end: Date,
  maxDays: number
): Array<{ start: Date; end: Date }> {
  const ranges: Array<{ start: Date; end: Date }> = []
  const current = new Date(start)
  current.setHours(0, 0, 0, 0)
  const endNorm = new Date(end)
  endNorm.setHours(23, 59, 59, 999)

  while (current <= endNorm) {
    const chunkEnd = new Date(current)
    chunkEnd.setDate(chunkEnd.getDate() + maxDays - 1)
    chunkEnd.setHours(23, 59, 59, 999)

    ranges.push({
      start: new Date(current),
      end: chunkEnd > endNorm ? new Date(endNorm) : chunkEnd,
    })

    current.setDate(current.getDate() + maxDays)
  }

  return ranges
}
