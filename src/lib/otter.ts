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

export interface OtterRow {
  [key: string]: string | number | null
}

export async function queryMetrics(body: object): Promise<OtterRow[]> {
  const jwt = process.env.OTTER_JWT
  if (!jwt) {
    throw new Error("OTTER_JWT environment variable is required")
  }

  const response = await fetch(OTTER_BASE_URL, {
    method: "POST",
    headers: {
      ...OTTER_HEADERS,
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  })

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

export function buildDailySyncBody(
  otterStoreIds: string[],
  startDate: Date,
  endDate: Date
): object {
  const minDate = startDate.toISOString()
  const maxDate = endDate.toISOString()

  return {
    columns: [...FP_COLUMNS, ...THIRD_PARTY_COLUMNS, ...TILL_COLUMNS],
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
