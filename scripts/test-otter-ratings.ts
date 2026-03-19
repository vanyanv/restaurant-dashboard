// scripts/test-otter-ratings.ts
// Run with: npx tsx scripts/test-otter-ratings.ts

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

const RATINGS_URL = 'https://api.tryotter.com/analytics/table/order_performance_cullinan';

const body = {
  scopeSet: [{ key: 'store', values: STORE_IDS }],
  columns: [
    { type: 'field', key: 'external_review_id' },
    { type: 'field', key: 'brand_name' },
    { type: 'field', key: 'facility_name' },
    { type: 'field', key: 'store_name' },
    { type: 'field', key: 'order_reviewed_at' },
    { type: 'field', key: 'ofo_slug' },
    { type: 'field', key: 'order_review_full_text' },
    { type: 'field', key: 'order_rating' },
    { type: 'field', key: 'external_order_id' },
    { type: 'field', key: 'order_items_names' },
  ],
  dataset: 'ratings_with_customer_orders',
  filterSet: [
    {
      filterType: 'dateRangeFilter',
      maxDate: '2026-02-27T07:59:59.999Z',
      minDate: '2026-02-06T08:00:00.000Z',
    },
    { filterType: 'namedFilter', name: 'excludeFacilitiesWithDataIssues' },
    { filterType: 'namedFilter', name: 'invalidCurrency' },
  ],
  sortBy: [
    { type: 'field', key: 'order_reviewed_at', sortOrder: 'DESC' },
    { type: 'field', key: 'external_order_id', sortOrder: 'DESC' },
  ],
  limit: 5000,
  paginate: true,
};

async function main() {
  console.log('=== Testing Otter Ratings API ===');
  console.log('URL:', RATINGS_URL);
  console.log('Body:', JSON.stringify(body, null, 2));
  console.log('');

  const res = await fetch(RATINGS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'application-name': 'op-app-analytics',
      'application-version': 'fddebf256f27323d4bb2dfe5e021eba83cdb8a41',
      Authorization: `Bearer ${JWT}`,
    },
    body: JSON.stringify(body),
  });

  console.log('Status:', res.status, res.statusText);

  if (!res.ok) {
    const text = await res.text();
    console.error('Error response:', text.slice(0, 500));
    return;
  }

  const data = await res.json();

  console.log('Response keys:', Object.keys(data));
  console.log('Has rows?', 'rows' in data, Array.isArray(data.rows));

  if (data.rows && data.rows.length > 0) {
    console.log('Total rows:', data.rows.length);
    console.log('');
    console.log('=== First row (raw) ===');
    console.log(JSON.stringify(data.rows[0], null, 2));
    console.log('');

    // Check if rows are [{key, value}] arrays or objects
    const firstRow = data.rows[0];
    if (Array.isArray(firstRow)) {
      console.log('Row format: Array of {key, value}');
      console.log('Keys:', firstRow.map((c: any) => c.key));
    } else {
      console.log('Row format: Object');
      console.log('Keys:', Object.keys(firstRow));
    }

    // Show a few sample rows flattened
    console.log('');
    console.log('=== First 3 rows (flattened) ===');
    for (let i = 0; i < Math.min(3, data.rows.length); i++) {
      const row = data.rows[i];
      let flat: any;
      if (Array.isArray(row)) {
        flat = {};
        for (const cell of row) flat[cell.key] = cell.value;
      } else {
        flat = row;
      }
      console.log(`Row ${i}:`, JSON.stringify(flat, null, 2));
    }
  } else {
    console.log('No rows returned!');
    console.log('Full response:', JSON.stringify(data, null, 2).slice(0, 1000));
  }
}

main().catch(console.error);
