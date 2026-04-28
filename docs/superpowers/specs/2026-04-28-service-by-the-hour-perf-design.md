# Service-by-the-hour performance — design

**Date:** 2026-04-28
**Surface:** dashboard front page, "Service by the hour" card
**Components:** [hourly-orders-dashboard-card.tsx](../../../src/components/analytics/hourly-orders-dashboard-card.tsx), [getOrderPatterns](../../../src/app/actions/store-actions.ts#L1916)
**Scope:** this card only — not the broader analytics page or other Otter-backed surfaces

## Problem

The "Service by the hour" card feels slow on initial load and on every change (period toggle, store filter). Each interaction triggers a server action that:

1. Pulls 35 days of per-order rows from Otter's `customer_orders` API live, with a 50 000-row limit, to compute the 4-week same-weekday baseline.
2. Runs a `prisma.otterDailySummary.findMany` to populate `byDayOfWeek` / `byMonth` outputs that this card never displays.
3. Has no client-side caching — uses bare `useState` + `useEffect`, not TanStack Query like the rest of the app.

Tab switches and store-filter changes therefore re-pay the full Otter round trip every time.

## Decision

Precompute hourly aggregates into Postgres on a focused hourly cron, and read from there. Mirror the precedent set by `OtterDailySummary`. The dashboard card never calls Otter again.

Freshness contract: data is fresh through the previous completed LA hour. The user signed off on this contract during brainstorming.

## Non-goals

- No changes to the analytics page at [analytics/[storeId]](../../../src/app/dashboard/analytics/[storeId]/components/sections/data.ts), which also consumes `getOrderPatterns`. That function is preserved unchanged.
- No changes to the existing `/api/otter/sync` route, the `OtterDailySummary` table, or the existing `otter-sync.yml` GH Actions workflow.
- No platform / payment-method splits in the new precompute table — the card doesn't display them.
- No live "current hour" data path. The hourly cron handles freshness.

## Schema

```prisma
model OtterHourlySummary {
  id         String   @id @default(cuid())
  storeId    String
  date       DateTime @db.Date   // LA calendar date this hour belongs to
  hour       Int                 // 0–23, LA local hour
  orderCount Int      @default(0)
  netSales   Float    @default(0)
  updatedAt  DateTime @updatedAt

  store      Store    @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@unique([storeId, date, hour])
  @@index([date])
  @@index([storeId, date])
}
```

**Sparse rows.** Only hours with at least one order get inserted. A 35-day baseline across 5 stores is at most a few thousand rows.

**`date` + `hour` (Int) instead of a timestamp.** Mirrors `OtterDailySummary`, which already stores LA-local dates as `@db.Date`. The hour comes from Otter's `reference_time_local_without_tz`, which is a local-encoded epoch — `getUTCHours()` on the parsed `Date` yields the LA hour directly without any timezone conversion. Storing `hour` as a small int avoids every conversion bug we'd otherwise hit when bucketing.

**Index choice.** `(storeId, date)` covers the per-store reads. `(date)` supports the "all stores" path that aggregates across all stores for a date range.

**Schema deploy.** The project uses `prisma db push` (no `migrations/` directory; `buildCommand` is `prisma generate && next build`). Land the new model via `prisma db push` against prod off-hours.

## Aggregation flow — new cron endpoint

New focused endpoint at `src/app/api/cron/otter/hourly/route.ts`. Not folded into the existing daily sync, which does substantially more work (daily + categories + items + modifiers + ratings + cogs) and has no business running every hour.

**Per run:**

1. Pull `otterStore` mappings (`otterStoreId → storeId`).
2. Build a `customer_orders` Otter query for a **rolling 2-day window** (today + yesterday in LA). Use the existing `buildCustomerOrdersBody` helper. Limit `10000` — typical 2-day volume across all stores is well under that.
3. For each returned row:
   - Map `facility_name` → `otterStoreId` → `storeId`.
   - Read `getUTCFullYear/Month/Date/Hours` on `new Date(reference_time_local_without_tz)` to derive `(date, hour)` in LA without timezone conversion (per the rule documented in `src/lib/otter.ts`).
   - Bucket by `(storeId, date, hour)`, summing `orderCount += 1` and `netSales += row.net_sales`.
4. For each `(storeId, date)` covered by the window, run a transactional **delete + insert**: delete all rows for that pair, then insert the freshly bucketed non-zero hours. Idempotent and self-healing for late-arriving orders, refunds, and Otter retroactive edits.

**Why a 2-day rolling window** (not just "today"): orders settle late in Otter; yesterday's late additions need to land somewhere. 2 days is the smallest window that covers this without a separate reconciliation job.

**Why delete+insert per (storeId, date)** instead of per-row upsert: simpler, single transactional unit, and cleanly handles the case where an hour goes from 5 orders → 3 orders. Per-row upsert would leave stale higher counts behind unless we tracked what to delete.

**Cron.** New GH Actions workflow `otter-hourly-sync.yml` on `0 * * * *`. Mirrors the auth + concurrency-lock pattern of `otter-sync.yml`. Reuses the existing `OTTER_JWT` env var and `isCronRequest` guard.

**Failure mode.** If a run errors, the table stays at the previous hour's data — the card shows slightly older numbers but nothing breaks. Subsequent runs auto-recover.

## Read path — server action

New server action `src/app/actions/hourly-orders-actions.ts`:

```ts
export async function getHourlyOrderPatterns(
  storeId: string | undefined,
  period: HourlyComparisonPeriod
): Promise<{
  hourly: HourlyOrderPoint[]
  hourlyComparison: OrderPatternsHourlyComparison | null
} | null>
```

**Implementation:**

1. `derivePeriodSpec(period, now)` (extracted, see below) → `{ currentDates, comparisonGroups, hourCutoff, weekdayLabel }`.
2. Compute `earliestComparison` and `latestCurrent` from the spec.
3. **One** Prisma query:

   ```ts
   prisma.otterHourlySummary.findMany({
     where: {
       storeId: storeId ? { equals: storeId } : { in: allStoreIds },
       date: { gte: earliestComparison, lte: latestCurrent },
     },
     select: { storeId: true, date: true, hour: true, orderCount: true, netSales: true },
   })
   ```

4. Pass rows into `bucketHourlyRows({ rows, spec })` (extracted, see below) which runs the same logic currently inside `getHourlyOrderDistributionWithComparison` — current vs comparison sets, 4-week baseline, pace-pct, hour-cutoff truncation — but operating on aggregate rows (`orderCount`, `netSales`) rather than per-order increments.

**Output shape is identical** to `getOrderPatterns`'s `hourly` + `hourlyComparison` fields, so [hourly-orders-chart-inner.tsx](../../../src/components/analytics/hourly-orders-chart-inner.tsx) requires no changes.

### Shared helpers — `src/lib/hourly-orders.ts`

Extract from `store-actions.ts`:

- `derivePeriodSpec(period, now: Date): PeriodSpec` — pure function, takes `now` as an argument so it's deterministic and testable.
- `bucketHourlyRows({ rows, spec }) → { hourly, hourlyComparison }` — the bucketing + averaging + pace logic.

Both the new action and the existing `getHourlyOrderDistributionWithComparison` import from this module. That guarantees by code (not by hope) that the pace KPI is computed the same way on both paths during the cutover.

## Read path — client

In [hourly-orders-dashboard-card.tsx](../../../src/components/analytics/hourly-orders-dashboard-card.tsx), replace the `useState` / `useEffect` / `setLoading` block with TanStack Query:

```ts
const { data, isLoading, isFetching } = useQuery({
  queryKey: ["hourly-orders", selectedStore, period],
  queryFn: () => getHourlyOrderPatterns(
    selectedStore === "all" ? undefined : selectedStore,
    period,
  ),
  staleTime: 5 * 60_000,
  gcTime: 30 * 60_000,
  refetchOnWindowFocus: false,
})
```

Use `isFetching` (not `isLoading`) to drive a "background refresh" dim — clicking a tab you've already loaded shows cached data instantly with at most a tiny indicator. No skeleton flash.

**Prefetch.** On first mount, fire `queryClient.prefetchQuery` for the other three periods at low priority. The four queries finish in well under a second total against the precompute table, so by the time the user clicks a tab, it's a cache hit.

No prop or shape changes to `HourlyOrdersChart` / `HourlyOrdersChart` inner.

## Backfill

One-shot script `scripts/backfill-otter-hourly.ts`:

- Reads `--days` flag (default `60`).
- Pulls `customer_orders` for that window across all stores in a single Otter call (`limit: 50000`, same shape used today).
- Buckets to `(storeId, date, hour)`, then for each `(storeId, date)` runs the same transactional **delete + insert** the cron uses.
- Idempotent — safe to re-run if it dies partway.
- Run once locally against the prod `DATABASE_URL` after the schema is pushed.

## Rollout sequence

Each step is independently reversible.

1. **Push schema.** Add `OtterHourlySummary` to `prisma/schema.prisma`, run `prisma db push` against prod off-hours. No code shipped yet.
2. **Ship the read+write code, but leave the card on the old path.** New endpoint, new action, new helpers, extracted shared module. Deploy is a no-op for users.
3. **Backfill.** Run `scripts/backfill-otter-hourly.ts --days=60` locally with prod credentials. Spot-check row counts per store.
4. **Add `otter-hourly-sync.yml` cron.** Verify the next-hour run lands new rows for the 2-day window.
5. **Verification gate.** Run the new path and the old `getOrderPatterns` path side-by-side for `today` / `yesterday` / `this-week` / `last-week` for one store. Numbers must match within rounding (shared helpers guarantee logic parity; the only legit drift is `Math.round` artifacts on `netSales`).
6. **Switch the card.** Single import + state-management swap in `hourly-orders-dashboard-card.tsx`.
7. **Monitor for 24 hours.** Console / Sentry, hourly cron run logs, manual spot-check of card numbers vs Otter dashboard for one store.

**Rollback.** Revert step 6 (one file). The old path is fully intact. Cron and table can stay running with no consumer.

## Testing

### Unit — `src/lib/hourly-orders.ts`

- `derivePeriodSpec` — snapshot the four outputs against a frozen `now`. Pure function: pass `now` as an argument (small but worthwhile fix during extraction; current code reads the clock implicitly).
- `bucketHourlyRows` — given a fixture of `(storeId, date, hour, orderCount, netSales)` rows, assert the produced `HourlyOrderPoint[]` and `OrderPatternsHourlyComparison`. Test the truncation rule explicitly: a row past `hourCutoff` on the last current day must NOT contribute to `currentTotal`, and the matching last-day-of-each-comparison-group rows must be truncated symmetrically.
- "All stores" sum vs single-store sum — summing per-store outputs equals the all-stores output within rounding.

### Integration — `/api/cron/otter/hourly`

- Mock `queryMetrics` with a fixture of `customer_orders` rows; assert `OtterHourlySummary` rows after the run.
- Run twice with the same fixture; assert idempotence (delete+insert results in same row set, not duplicates).
- Run with a fixture where row counts shrink between runs (simulating refunds); assert the second run *removes* the inflated counts. This is what proves delete+insert beats per-row upsert.

### Manual / smoke

- Backfill a dev DB, load the dashboard, click each of the four tabs, confirm numbers sit within ±1 order of the current production card for the same window.
- DevTools Network tab: first card load fires one server action; subsequent tab switches fire none. Store-filter changes for stores already in cache fire none.

## Isolation guarantees

**Untouched:**

- `getOrderPatterns` in [store-actions.ts:1916](../../../src/app/actions/store-actions.ts#L1916) and the analytics page consumer in [analytics/[storeId]/components/sections/data.ts](../../../src/app/dashboard/analytics/[storeId]/components/sections/data.ts).
- `getHourlyOrderDistribution` and `getHourlyOrderDistributionWithComparison` — they import from the new shared module after extraction, but their signatures and behavior are unchanged.
- `/api/otter/sync` route, `OtterDailySummary`, `otter-sync.yml`.
- `HourlyOrdersChart` / inner — same `HourlyOrderPoint[]` shape.
- `buildCustomerOrdersBody`, `queryMetrics` in `src/lib/otter.ts`.

**New, additive only:**

- `OtterHourlySummary` Prisma model.
- `src/app/api/cron/otter/hourly/route.ts`.
- `src/app/actions/hourly-orders-actions.ts`.
- `src/lib/hourly-orders.ts` (extracted helpers).
- `.github/workflows/otter-hourly-sync.yml`.
- `scripts/backfill-otter-hourly.ts`.

**Modified:**

- `prisma/schema.prisma` (new model + back-reference on `Store`).
- `src/app/actions/store-actions.ts` — `getHourlyOrderDistributionWithComparison` and `getHourlyOrderDistribution` import their helpers from `src/lib/hourly-orders.ts` instead of inlining them. No call-site or behavior changes.
- `src/components/analytics/hourly-orders-dashboard-card.tsx` — TanStack Query swap, new action import.

**Otter API load delta.** Adds one small `customer_orders` request per hour (2-day window, hundreds of rows). The dashboard card's existing 35-day call goes away. Net effect on Otter is roughly neutral or lower.

## Acceptance criteria

- Initial card data load p95 under 200 ms (currently dominated by the Otter round trip — typically 1–3 s).
- Tab switches feel instant: no skeleton, no full blanking. At most a barely-visible "fetching" indicator on first switch.
- Store-filter changes feel instant for stores already in cache.
- Numbers per `(store, period)` match the existing Otter-live path within rounding on the day of cutover.
- New hourly cron runs cleanly for 24 hours without errors.
