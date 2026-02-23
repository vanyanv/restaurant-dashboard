// scripts/test-otter.ts
// Run with: npx tsx scripts/test-otter.ts
// Reads OTTER_JWT or Bearer from .env.local

import fs from 'fs';
import path from 'path';

function loadEnvLocal(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf-8');
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    result[key] = val;
  }
  return result;
}

const env = loadEnvLocal();
const JWT = process.env.OTTER_JWT ?? env['OTTER_JWT'] ?? env['Bearer'];

if (!JWT) {
  console.error('Error: JWT not found. Add OTTER_JWT or Bearer to .env.local');
  process.exit(1);
}

const STORE_IDS = [
  '10b8d83b-db0e-4637-8ce6-ef3b60081f11',
  '2fb629b7-2a22-429c-80cf-de2ae6d4a662',
  'f8f941a6-9c18-49ed-896a-5b2213ba09a4',
  '3dff7900-1388-4332-8079-091c3bb96eb4',
  '701340d6-eeac-4a61-92ef-3bec103654ea',
  '8c836303-8d5d-4c32-b9d1-a1ca5325b191',
];

const now = new Date();
const yyyy = now.getFullYear();
const mm = String(now.getMonth() + 1).padStart(2, '0');
const dd = String(now.getDate()).padStart(2, '0');
const minDate = `${yyyy}-${mm}-${dd}T00:00:00.000Z`;
const maxDate = `${yyyy}-${mm}-${dd}T23:59:59.999Z`;

const HEADERS = {
  Authorization: `Bearer ${JWT}`,
  'Content-Type': 'application/json',
  'application-name': 'op-app-analytics',
  'application-version': 'fddebf256f27323d4bb2dfe5e021eba83cdb8a41',
};

const BASE_FILTER = [{ filterType: 'dateRangeFilter', minDate, maxDate }];
const SCOPE = [{ key: 'store', values: STORE_IDS }];

const FP_COLUMNS = [
  { type: 'metric', key: 'fp_sales_financials_gross_sales' },
  { type: 'metric', key: 'fp_sales_financials_net_sales' },
  { type: 'metric', key: 'fp_sales_financials_discounts' },
  { type: 'metric', key: 'fp_sales_financials_fees' },
  { type: 'metric', key: 'fp_sales_financials_lost_revenue' },
  { type: 'metric', key: 'fp_sales_financials_tax_collected' },
  { type: 'metric', key: 'fp_sales_financials_tax_remitted' },
  { type: 'metric', key: 'fp_sales_financials_tips' },
  { type: 'metric', key: 'fp_sales_financials_service_charges' },
  { type: 'metric', key: 'fp_sales_financials_loyalty' },
];

const THIRD_PARTY_COLUMNS = [
  { type: 'metric', key: 'third_party_gross_sales' },
  { type: 'metric', key: 'third_party_net_sales' },
  { type: 'metric', key: 'third_party_fees' },
  { type: 'metric', key: 'third_party_tax_collected' },
  { type: 'metric', key: 'third_party_tax_remitted' },
  { type: 'metric', key: 'third_party_discounts' },
  { type: 'metric', key: 'third_party_refunds_adjustments' },
  { type: 'metric', key: 'third_party_service_charges' },
  { type: 'metric', key: 'third_party_tip_for_restaurant' },
  { type: 'metric', key: 'third_party_loyalty_discount' },
];

const TILL_COLUMNS = [
  { type: 'metric', key: 'enriched_till_report_paid_in' },
  { type: 'metric', key: 'enriched_till_report_paid_out' },
  { type: 'metric', key: 'enriched_till_report_drawer_reconciliation' },
];

const ORDER_FIELDS = [
  { type: 'field', key: 'external_order_display_id' },
  { type: 'field', key: 'facility_name' },
  { type: 'field', key: 'consolidated_channel_slug' },
  { type: 'field', key: 'fulfillment_mode' },
  { type: 'field', key: 'reference_time_local_without_tz' },
  { type: 'field', key: 'subtotal' },
  { type: 'field', key: 'net_sales' },
  { type: 'field', key: 'tax' },
  { type: 'field', key: 'tax_remitted_signed' },
  { type: 'field', key: 'tip_for_restaurant' },
  { type: 'field', key: 'restaurant_total_fees' },
  { type: 'field', key: 'ofo_charges_incl_tax_minus_withheld' },
  { type: 'field', key: 'payout' },
  { type: 'field', key: 'payout_date' },
  { type: 'field', key: 'payout_id' },
  { type: 'field', key: 'payment_methods_csv' },
  { type: 'field', key: 'loyalty_discount' },
  { type: 'field', key: 'net_discount_signed' },
  { type: 'field', key: 'adjustment' },
  { type: 'field', key: 'staff_name' },
];

async function query(label: string, body: object) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`QUERY: ${label}`);
  console.log('='.repeat(60));

  const res = await fetch(
    'https://api.tryotter.com/analytics/table/metrics_explorer',
    {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(body),
    },
  );

  console.log(`Status: ${res.status} ${res.statusText}`);

  if (!res.ok) {
    const text = await res.text();
    console.error('Error:', text);
    return;
  }

  const data = await res.json();

  if (!data.rows || !Array.isArray(data.rows)) {
    console.log('Unexpected shape:', JSON.stringify(data, null, 2));
    return;
  }

  console.log(
    `Rows: ${data.rows.length}${data.totalRowCount != null ? ` / ${data.totalRowCount} total` : ''}`,
  );

  for (const row of data.rows) {
    const flat: Record<string, unknown> = {};
    for (const cell of row) {
      if (cell.value !== null) flat[cell.key] = cell.value;
    }
    console.log(flat);
  }
}

const ORDERS_TIME_COL = {
  colName: 'reference_time_local_without_tz',
  type: 'instant',
  unit: 'EpochMillis',
  supportsLocalTime: true,
  secondaryTimeCol: {
    padding: 'P30D',
    offset: 'PT0S',
    timeCol: {
      colName: 'partition_source_timestamp_seconds',
      type: 'instant',
      unit: 'EpochSeconds',
      supportsLocalTime: false,
    },
  },
};

async function main() {
  console.log(`Date: ${now.toDateString()}  |  Stores: ${STORE_IDS.length}`);

  // Query 1: Per-store + platform breakdown
  await query('Per-store + platform breakdown', {
    columns: [...FP_COLUMNS, ...THIRD_PARTY_COLUMNS],
    groupBy: [{ key: 'store' }, { key: 'pos_summary_ofo' }],
    sortBy: [
      {
        type: 'metric',
        key: 'fp_sales_financials_gross_sales',
        sortOrder: 'DESC',
      },
    ],
    filterSet: BASE_FILTER,
    scopeSet: SCOPE,
    includeMetricsFilters: true,
    localTime: true,
    includeTotalRowCount: false,
    limit: 1500,
    includeRawQueries: false,
  });

  // Query 2: Payment method breakdown
  await query('Payment method breakdown', {
    columns: [...FP_COLUMNS, ...THIRD_PARTY_COLUMNS],
    groupBy: [
      { key: 'multi_value_pos_payment_method' },
      { key: 'pos_summary_ofo' },
    ],
    sortBy: [
      {
        type: 'metric',
        key: 'fp_sales_financials_gross_sales',
        sortOrder: 'DESC',
      },
    ],
    filterSet: BASE_FILTER,
    scopeSet: SCOPE,
    includeMetricsFilters: true,
    localTime: true,
    includeTotalRowCount: false,
    limit: 1500,
    includeRawQueries: false,
  });

  // Query 3: Full financial columns including till/reconciliation
  await query('Full financial columns (platform only)', {
    columns: [...FP_COLUMNS, ...THIRD_PARTY_COLUMNS, ...TILL_COLUMNS],
    groupBy: [{ key: 'pos_summary_ofo' }],
    sortBy: [
      {
        type: 'metric',
        key: 'fp_sales_financials_gross_sales',
        sortOrder: 'DESC',
      },
    ],
    filterSet: BASE_FILTER,
    scopeSet: SCOPE,
    includeMetricsFilters: true,
    localTime: true,
    includeTotalRowCount: false,
    limit: 1500,
    includeRawQueries: false,
  });

  // Query 4: Summary by Day — the exact shape Otter exports for daily CSV
  // Groups by date + payment method + platform — this is the sync query shape
  await query('Summary by Day (confirmed from DevTools CSV export)', {
    columns: [...FP_COLUMNS, ...THIRD_PARTY_COLUMNS, ...TILL_COLUMNS],
    groupBy: [
      { key: 'eod_date_with_timezone' },
      { key: 'multi_value_pos_payment_method' },
      { key: 'pos_summary_ofo' },
    ],
    sortBy: [
      { type: 'dimension', key: 'eod_date_with_timezone', sortOrder: 'DESC' },
    ],
    filterSet: BASE_FILTER,
    scopeSet: SCOPE,
    includeMetricsFilters: true,
    localTime: true,
    includeTotalRowCount: false,
    limit: 15000,
    includeRawQueries: false,
  });

  // Query 5: Order-level detail — customer_orders dataset
  // One row per order; uses type:"field" instead of type:"metric"
  // Named filters from DevTools: all_valid_orders, paid_order_filter
  // await query("Order-level detail (customer_orders dataset)", {
  //   columns: ORDER_FIELDS,
  //   sortBy: [{ type: "field", key: "reference_time_local_without_tz", sortOrder: "DESC" }],
  //   filterSet: [
  //     ...BASE_FILTER,
  //     { filterType: "namedFilter", name: "all_valid_orders" },
  //     { filterType: "namedFilter", name: "paid_order_filter" },
  //   ],
  //   scopeSet: SCOPE,
  //   dataset: "customer_orders",
  //   includeMetricsFilters: true,
  //   localTime: true,
  //   includeTotalRowCount: true,
  //   paginate: true,
  //   timeCol: ORDERS_TIME_COL,
  //   includeRawQueries: false,
  //   limit: 50,
  // })

  // Query 6: Order count with full daily sync shape
  await query('Order count - daily sync shape', {
    columns: [
      { type: 'metric', key: 'order_count' },
      ...FP_COLUMNS,
      ...THIRD_PARTY_COLUMNS,
    ],
    groupBy: [{ key: 'pos_summary_ofo' }],
    sortBy: [
      {
        type: 'metric',
        key: 'fp_sales_financials_gross_sales',
        sortOrder: 'DESC',
      },
    ],
    filterSet: BASE_FILTER,
    scopeSet: SCOPE,
    includeMetricsFilters: true,
    localTime: true,
    includeTotalRowCount: false,
    limit: 100,
    includeRawQueries: false,
  });
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
