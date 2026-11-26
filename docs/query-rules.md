# Query rules

Read this before adding or changing any database query, loader, adapter,
server action that writes rows, or background call a page makes. The owner
asked for these on 2026-11-20 after two audits (2026-11-17 and 2026-11-20)
kept finding the same mistakes. They come from the Prisma query-optimization
guide, Neon's and Vercel's connection guides, the Next.js data-fetching docs
and the Postgres manual, kept only where they apply to this stack: Prisma 7
with `@prisma/adapter-pg`, Neon Postgres (free compute sleeps; cache is cold
and `pg_stat_statements` resets on every wake), Next 16 on Vercel.

A PR that breaks a rule on purpose says which one and why in its body.

## Reads

1. **Load once, slice in JS.** A page loads a figure set once, over the
   widest span it shows (say 8 weeks), and derives yesterday, last week and
   week-to-date from that result. Never call the same rollup once per period.
   The 2026-11-20 audit found the whole P&L rollup running 4x on Overview.
2. **All stores first, never per-store repeats.** A per-store view filters
   the all-stores result. No `for (const store of stores) await load(store)`
   after an all-stores load already ran. A query that really is per store
   is one query with `storeId: { in: ids }` and a `groupBy`, not a loop.
3. **No N+1.** No query inside a loop or `.map`. Use `include`/`select`, or
   one `findMany` with an `in` filter on the parent ids.
4. **Independent loads run together.** `Promise.all`, or start the promise
   early and await it late (the `get*SectionPromises` shape). A chain of
   awaits costs round trips times latency.
5. **Dedupe per request.** Prisma calls are not `fetch`, so Next does not
   dedupe them. Wrap a loader that several components call in React
   `cache()`. `cache()` does nothing in route handlers and server actions:
   there, pass data down instead of reading it twice.
6. **Only what the page shows.** `select` the columns used, and bound every
   list by a date range or `take`.
7. **Summary tables before raw orders.** Read `OtterDailySummary`, daily COGS
   and other rollup tables whenever they hold the figure. Raw `OtterOrder`
   and its lines are the slowest read after Neon wakes (585 ms cold for 30
   days of all-store totals, against 21 ms from the summary table).

## Writes

8. **Bulk, not row by row.** `createMany`, `updateMany`, or one raw
   `UPDATE ... FROM (VALUES ...)`. A `$transaction` makes writes atomic but
   still runs one statement per row; when the writes must be atomic, put the
   bulk operation inside it. A user action that saves N rows
   is one server action call with one `revalidatePath`, and no extra
   `router.refresh()` after it.
9. **Sync jobs skip unchanged rows.** Rewriting every row each run bloats the
   table and stops index-only scans (OtterOrder had 934k updates on 117k rows
   before this was fixed).

## Per page view

10. **One background call per page view.** A beacon or telemetry call fires
    once, reads the user once, and does its database work after the
    response (`after()`).

## Indexes

11. **Match the WHERE.** Index leading columns follow the filter (`storeId`,
    then the date). Add `INCLUDE` columns only for a hot aggregate that should
    be an index-only scan, and drop an index that becomes a redundant prefix.
    Prove it with `EXPLAIN (ANALYZE, BUFFERS)` in the PR. A production index
    is built `CONCURRENTLY` with the owner's go, before `db push`, with its
    `prisma/manual-migrations/` file.

## Connections

12. **One pool per instance.** The app connects through Neon's pooled
    (`-pooler`) host with one `pg` pool in `src/lib/prisma.ts`, handed to
    Vercel's `attachDatabasePool` so idle clients close before the function
    suspends. A second client (the chat layer's) is built on the same pool
    via `getPgPool()`. Don't create another `pg.Pool`. The pool
    stays at 10: on 2026-11-20 a pool of 5 made Decisions 13% slower, since
    pages run 20-47 queries at once. Lower it only after re-measuring.
    Idle clients close after 2 s (`src/lib/pg-pool-idle.ts`), because
    `attachDatabasePool` keeps the function instance alive for that long
    after every query and Vercel bills the memory; at node-postgres's 10 s
    default it was most of the account's function GB-hours.

## Proof

13. **Measure before and after.** For every page a change touches, record
    the query count (`PRISMA_TRACE=1` + `npm run perf:queries`) and server
    time (median of several runs on the same data) before and after, and
    check every figure on the page is identical. The table goes in the PR
    body.
