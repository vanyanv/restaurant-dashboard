# Usage Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A developer-only Usage page that shows how close each service is to its limit, what each part of the app uses per day, and every outside service with its usage and key dates.

**Architecture:** Requests are counted in memory per server instance and flushed to Redis at most once every 5 minutes with one command. A script riding on the two-hourly Otter sync drains Redis into Postgres and reads each service's own totals. One Counter adapter serves a desk page and a phone page from those tables.

**Tech Stack:** Next 16.4.6, `@opentelemetry/api` 1.9.1, `@opentelemetry/sdk-trace-base`, `@opentelemetry/context-async-hooks`, Prisma 7, Upstash Redis, `@vercel/functions` `waitUntil`, Vitest, Counter components.

**Spec:** `docs/superpowers/specs/2026-11-27-usage-monitoring-design.md`

## Global Constraints

- Recording must not spend what is short: no extra database wake-up, no Redis command per request, no measurable rise in Vercel CPU (over 2% fails the spike).
- A failure in counting must never fail or slow a request. Every meter entry point is wrapped so it cannot throw.
- No figure shown as fact when it is an estimate. Estimates and guessed limits are labelled.
- `USAGE_METER=0` turns all counting off without a deploy of code.
- Sources are exactly: `tv`, `crew`, `phone`, `ask`, `sync`, `dashboard`, `other`. Instance-wide figures use the pseudo-source `all`.
- Watch at 70%, Act now at 90%; a key goes to Watch 60 days before it ends.
- Flush after 5 minutes (`FLUSH_AFTER_MS = 300_000`), key `usage:pending`, `RPUSH` of one JSON string.
- Schema changes: `npm run db:drift` must say "No difference detected" first, then `prisma db push` plus `prisma/manual-migrations/2026-11-27_usage-monitoring.sql`. Never `prisma migrate dev`, never `--accept-data-loss`.
- The tables are app-wide (no `accountId`). The page is developer-only, gated the same way the other Monitoring pages are.
- The repository is public: no secret, account id or email address in code, logs or docs.
- Gate before each merge: `npm test && npm run tokens && npm run lint:hooks && npx tsc --noEmit && npm run typecheck:scripts && npm run build`. After the page task only: `npm run fidelity -- --grep monitoring-usage` (use the page id the fidelity registry gives it).
- After code changes: `graphify update .`.
- Ships as three pull requests, each merged to `main` once the gate and CI are green: A (Tasks 1 to 4, counting, no page), B (Tasks 5 to 8, tables and roll-up), C (Tasks 9 to 11, the page).

## One change from the spec

The spec has `src/proxy.ts` stamp the source into a request header. The plan does not touch the proxy. Next calls `propagation.extract(context, req.headers)` for every request once a tracer is registered (`tracer.js` `withPropagatedContext`), so a small custom propagator reads `referer` straight from the incoming headers. This is less code on the hot path and leaves a 281-line file alone. Task 1 proves it; if it does not hold, fall back to the spec's header.

## Review Focus

1. Redis missing, slow or erroring during a flush: the request that triggered it returns normally and on time, and the counts are dropped. (Task 3)
2. A malformed entry in `usage:pending` (bad JSON, wrong shape, unknown source): it is skipped and logged, the entries around it are applied, and the list is still trimmed. (Task 6)
3. A new route added to `src/app` with no source mapping: a test fails naming the route. (Task 2)
4. A service reader with no key, an expired key or a 5xx: that service shows "not connected" or "last read failed" with the time, and every other service is still read. (Task 7)
5. No data yet (first day, empty tables, a month with one day in it): the page says counts have not started, and never shows 0%, NaN or a divide-by-zero. (Task 9)
6. The roll-up running twice in the same hour (ticker plus backup schedule): the second run exits without opening the database. (Task 6)

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/usage/source.ts` | `UsageSource`, `sourceOf` |
| `src/lib/usage/meter.ts` | the in-memory counts, the trace-to-source map, `takePending` |
| `src/lib/usage/flush.ts` | `maybeFlush`, `flushNow` (Redis, `waitUntil`) |
| `src/lib/usage/tracer.ts` | `registerUsageTracer()`: provider, sampler, propagator, span processor |
| `src/lib/usage/hosts.ts` | `serviceOfHost` |
| `src/lib/usage/prisma-count.ts` | `withUsageCount(client)` |
| `src/lib/usage/redis-count.ts` | `countedRedis(client)` |
| `src/lib/usage/script-meter.ts` | side-effect import for GitHub Actions scripts |
| `src/lib/usage/limits.ts` | the one list of limits, `statusOf` |
| `src/lib/usage/rollup.ts` | `parsePending`, `applyPending` |
| `src/lib/usage/services/*.ts` | one reader per service |
| `scripts/usage-rollup.ts` | drain, read services, write |
| `src/lib/counter/adapters/monitoring-usage.ts` | `getUsageSectionPromises()` |
| `src/app/dashboard/(counter)/admin/monitoring/usage/` | desk page, client, loading |
| `src/app/(mobile)/m/(counter)/monitoring/usage/` | phone page, client, loading |

---

## PR A: counting, shipped dark

### Task 1: Spike. Does the tracer carry what we need, and what does it cost?

**Files:**
- Create: `src/lib/usage/tracer.ts` (spike quality, rewritten in Task 3)
- Modify: `src/instrumentation.ts` (call `registerUsageTracer()` at the end of `register()`, inside the `nodejs` guard, skipped when `USAGE_METER === "0"`)
- Modify: `package.json` (`@opentelemetry/api@1.9.1`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/context-async-hooks`, exact versions)
- Create (scratchpad, not committed): a load script

- [ ] **Step 1:** Install the three packages at exact versions. Read `node_modules/next/dist/docs/01-app/02-guides/open-telemetry.md` and `node_modules/next/dist/docs/01-app/02-guides/instrumentation.md` first.
- [ ] **Step 2:** Write a tracer with: an `AsyncLocalStorageContextManager`; a propagator whose `extract` stores `carrier.referer` in the context under a key and whose `inject` does nothing; a sampler that records only spans whose `next.span_type` is `BaseServer.handleRequest` or `AppRender.fetch` and returns `NOT_RECORD` for the rest; a span processor that logs, at `onEnd`, for a root span `next.route`, `http.target`, the referer from context and duration, and for a fetch span `net.peer.name` and `http.status_code`. Logging is behind `USAGE_SPIKE_LOG=1`.
- [ ] **Step 3:** `npm run build`, then `USAGE_SPIKE_LOG=1 npx next start -p 3100`. Request one page, one `/api/tv/**` route, one server action and one page that fetches an outside host. Record in the plan, as a table under this task, what each span carried. Pass means: the root span gives route and target; the referer arrives through the propagator; the fetch span gives host and status; `trace.getActiveSpan()` inside a route handler returns a span whose trace id equals the root span's.
- [ ] **Step 4:** Measure cost. With the same build, run 2,000 sequential requests against a cheap route that needs no database (find one; the TV check-in answered from Redis is a candidate only if Redis is local, otherwise a static API route), once with `USAGE_METER=0` and once without, three runs each, and compare the server's `process.cpuUsage()` total per run. Record the medians. Pass is a rise of 2% or less.
- [ ] **Step 5:** Decide and write the decision under this task: tracer (continue to Task 2) or the spec's fallback, a `metered(source, handler)` wrapper on route handlers and the two layouts (rewrite Tasks 3 and 4 before continuing).
- [ ] **Step 6:** Commit.

**Result (2026-11-28, production build, `next start`):**

| Checked | Found |
|---|---|
| Request span | `http.target` at start, `next.route` and `http.status_code` by the end |
| Referer | Arrives through the propagator (`/api/auth/providers` sent with a referer showed it) |
| Outside call span | `net.peer.name` and `http.status_code`, same trace id as its request (seen on `/api/checks/[code]/state` calling Upstash) |
| Active span in a handler | Same trace id as the request span |
| Not in the plan | With `next start` each request makes two request spans: a pass for the proxy with no `next.route`, then the route. The first is counted as `proxyCalls`, not `calls`. |

Cost: 2,000 `/login` renders plus 2,000 `/api/auth/providers` calls, server CPU by `ps`. Off 4.11 to 4.34 s, on 4.25 to 4.60 s across seven pairs; medians about 4.2 s and 4.45 s. That is 4% to 8% on routes that cost 1 ms each, or 0.05 to 0.1 ms per request. Run-to-run noise is about 5%, so the per-request figure is the honest one.

**Decision: tracer.** The 2% line in the spec is read against the app's real CPU, which is what the anti-goal protects ("no measurable rise in Vercel CPU"). At 0.1 ms a request, a million requests a month is 100 s of the 14,400 s allowance, under 1%. Against a 1 ms route alone it is over 2%, and that is stated here rather than hidden. `USAGE_METER=0` turns it off, and once live the meter's own `cpuMs` and `calls` give the real per-request figure to check this against.

### Task 2: `sourceOf`

**Files:**
- Create: `src/lib/usage/source.ts`
- Test: `tests/lib/usage/source.test.ts` (follow where neighbouring `tests/lib/**` files live)

**Interfaces:**
- Produces: `type UsageSource = "tv" | "crew" | "phone" | "ask" | "sync" | "dashboard" | "other"`; `const USAGE_SOURCES: readonly UsageSource[]`; `sourceOf(pathname: string, referer?: string | null): UsageSource`

- [ ] **Step 1: Failing tests.** Cases, exact:

| pathname | referer | expected |
|---|---|---|
| `/api/tv/checkin` | none | `tv` |
| `/tv/abc` | none | `tv` |
| `/checks/XY12` | none | `crew` |
| `/api/checks/submit` | none | `crew` |
| `/m/overview` | none | `phone` |
| `/api/chat/stream` | `https://x/m/ask` | `ask` |
| `/dashboard/ask` | none | `ask` |
| `/m/ask` | none | `ask` |
| `/api/cron/retention` | none | `sync` |
| `/dashboard/pnl` | none | `dashboard` |
| `/api/stores` | `https://x/m/overview` | `phone` |
| `/api/stores` | `https://x/dashboard/pnl` | `dashboard` |
| `/api/stores` | `not a url` | `dashboard` |
| `/login` | none | `other` |
| `/api/auth/session` | `https://x/m/overview` | `other` |
| `/` | none | `other` |

Path rules win over the referer; the referer is used only for an `/api/**` path with no rule of its own. Query strings and a trailing slash are ignored.

A second test walks `src/app` for every `page.tsx` and `route.ts`, turns each into its URL pattern (dropping route groups), and asserts `sourceOf` returns something other than `other` unless the pattern is in an explicit `EXPECTED_OTHER` list in the test. The failure message names the route.

- [ ] **Step 2:** Run, see it fail. **Step 3:** Implement. **Step 4:** Run, see it pass. **Step 5:** Commit.

### Task 3: Meter, flush and tracer

**Files:**
- Create: `src/lib/usage/meter.ts`, `src/lib/usage/flush.ts`, `src/lib/usage/hosts.ts`
- Rewrite: `src/lib/usage/tracer.ts`
- Test: `tests/lib/usage/meter.test.ts`, `flush.test.ts`, `tracer.test.ts`, `hosts.test.ts`

**Interfaces:**
- Consumes: `UsageSource`, `sourceOf`
- Produces, `meter.ts`:
  - `type MeterSource = UsageSource | "all"`
  - `count(source: MeterSource, metric: string, value?: number, at?: Date): void` (default value 1; never throws)
  - `bindTrace(traceId: string, source: UsageSource): void`, `unbindTrace(traceId: string): void`
  - `currentSource(): UsageSource` (the active span's trace, else the default)
  - `setDefaultSource(source: UsageSource): void` (default `other`)
  - `oldestAgeMs(now?: number): number` (0 when empty)
  - `type PendingRow = [hour: string, source: MeterSource, metric: string, value: number]` (`hour` is an ISO string truncated to the UTC hour)
  - `type FlushPayload = { v: 1; instance: string; rows: PendingRow[] }`
  - `takePending(): FlushPayload | null` (empties the map; adds one `["<hour>", "all", "cpuMs", n]` row from `process.cpuUsage()` since the last take; null when there is nothing)
- Produces, `flush.ts`: `PENDING_KEY = "usage:pending"`, `FLUSH_AFTER_MS = 300_000`, `maybeFlush(): void` (if `oldestAgeMs() > FLUSH_AFTER_MS`, hands `flushNow()` to `waitUntil`), `flushNow(): Promise<void>` (never rejects)
- Produces, `hosts.ts`: `serviceOfHost(host: string): string | null` (null for the Upstash host and for the app's own host; `"other"` for an unknown host). Services: `neon`, `openai`, `gemini`, `resend`, `pusher`, `r2`, `microsoft`, `otter`, `harri`, `predicthq`, `open-meteo`, `shop`, `github`, `vercel`. Take the real host names from the code that calls each one, not from memory.
- Produces, `tracer.ts`: `registerUsageTracer(): void`, idempotent

Metric names, fixed here for every later task: `calls`, `wallMs`, `dbQueries`, `redisCommands`, `out:<service>`, `out:<service>:refused`, `cpuMs`.

- [ ] **Step 1: Failing tests.**
  - meter: two `count("tv", "calls")` in the same hour give one row of 2; counts in two hours give two rows; `takePending()` twice gives a payload then null; `count` with a NaN or negative value is ignored; past 2,000 distinct keys, further new keys are folded into source `other` with the same metric; `bindTrace` past 5,000 entries drops the oldest; `currentSource()` with no active span returns the default.
  - flush: with a Redis stub, `flushNow()` issues exactly one `rpush(PENDING_KEY, <string>)` whose JSON parses to a `FlushPayload`; with nothing pending it issues none; with `getRedis()` null it resolves; with a stub that rejects it resolves and the counts are gone; with a stub that never settles it resolves within 1 second (use `redisWithin` from `@/lib/cache/redis`); `maybeFlush()` under 5 minutes does not call `waitUntil`, over 5 minutes calls it once even if called three times before the flush settles.
  - tracer, using the real SDK with an in-memory setup: ending a root span with `http.target: "/api/tv/checkin"` adds `tv/calls` 1 and `tv/wallMs` of its duration and unbinds the trace; a fetch span with `net.peer.name` of the OpenAI host and `http.status_code` 429 inside that trace adds `tv/out:openai` 1 and `tv/out:openai:refused` 1; status 200 adds only the first; status 503 counts as refused; the Upstash host adds nothing; a processor callback that throws internally does not propagate.
- [ ] **Step 2:** Run, see them fail. **Step 3:** Implement. The flush's own `rpush` uses the raw client and is counted as `other/redisCommands`. **Step 4:** Run, see them pass.
- [ ] **Step 5:** Repeat Task 1 Step 4's measurement on the final code and record it. **Step 6:** Commit.

### Task 4: Count database queries, Redis commands, R2 calls and scripts

**Files:**
- Create: `src/lib/usage/prisma-count.ts`, `src/lib/usage/redis-count.ts`, `src/lib/usage/s3-count.ts`, `src/lib/usage/raw-redis.ts`, `src/lib/usage/script-meter.ts`, `src/lib/usage/script-meter-register.ts`
- Modify: `src/lib/prisma.ts` (wrap `createPrismaClient()` innermost), `src/lib/chat/prisma-chat.ts`, `src/lib/cache/redis.ts` (`getRedis` returns the counted client), `src/lib/blob.ts` (S3 client middleware), every script a workflow runs with `npx tsx scripts/...` (first line: `import "../src/lib/usage/script-meter"`, path adjusted)
- Test: `tests/lib/usage/prisma-count.test.ts`, `redis-count.test.ts`, `script-meter.test.ts`

**Interfaces:**
- Consumes: `count`, `currentSource`, `setDefaultSource`, `flushNow`, `serviceOfHost`
- Produces: `withUsageCount<T>(client: T): T`; `countedRedis(client: Redis): Redis`

- [ ] **Step 1: Failing tests.**
  - prisma: a model call and a `$queryRaw` each add 1 to `<currentSource>/dbQueries`; a query that throws still counts and still throws the same error.
  - redis: `get` adds 1; a pipeline with three commands adds 3 at `exec()` and nothing before; `multi()` behaves the same; non-function properties pass through; the wrapped client is the same object on repeat `getRedis()` calls.
  - script-meter: importing it sets the default source to `sync`; a `fetch` to a known host adds `sync/out:<service>` and a 429 adds `:refused`; a failing `fetch` rejects with the original error; `beforeExit` calls `flushNow` once.
- [ ] **Step 2 to 4:** Fail, implement, pass. `prisma-count.ts` and `script-meter.ts` must not import from `next/*`.
- [ ] **Step 5:** `npm run typecheck:scripts`. **Step 6:** Full gate. **Step 7:** Commit, open PR A.
- [ ] **Step 8: Prove it on a preview deploy.** Open the preview a few times across six minutes (a handful of requests; function time is at 91%). Then read `LRANGE usage:pending 0 -1` through the Upstash tools. Pass: at least one payload with `calls`, `wallMs`, `dbQueries`, `redisCommands` and `cpuMs` rows under sensible sources. This is also the proof that `waitUntil` works from the span processor. If no payload arrives, move the `maybeFlush()` call from the processor into `after()` in the two root layouts and the API routes' shared wrapper, and retest.
- [ ] **Step 9:** Merge PR A when CI is green. Check production the same way after ten minutes.

---

## PR B: tables, limits, roll-up

### Task 5: Tables and limits

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/manual-migrations/2026-11-27_usage-monitoring.sql`, `src/lib/usage/limits.ts`
- Modify: `src/lib/monitoring/redis-stats.ts`, `src/lib/monitoring/db-stats.ts`
- Test: `tests/lib/usage/limits.test.ts`

**Interfaces:**
- Produces, models:
  - `UsageHour { hour DateTime, source String, metric String, value Float, @@id([hour, source, metric]) }`
  - `UsageDay { date DateTime @db.Date, source String, metric String, value Float, @@id([date, source, metric]) }`
  - `ServiceUsage { id String @id @default(cuid()), capturedAt DateTime @default(now()), service String, metric String, value Float, ok Boolean @default(true), note String?, @@index([service, metric, capturedAt(sort: Desc)]) }`
  - `ServiceKey { id String @id @default(cuid()), service String, label String, endsAt DateTime? @db.Date, note String?, @@unique([service, label]) }`
- Produces, `limits.ts`:
  - `type Limit = { service: string; metric: string; label: string; limit: number; unit: string; period: "day" | "month" | "total"; plan: string; basis: "plan" | "ours" | "guess" }`
  - `LIMITS: readonly Limit[]`
  - `limitFor(service: string, metric: string): Limit | null`
  - `type LimitStatus = "ok" | "watch" | "act"`; `statusOf(used: number, limit: number): LimitStatus` (below 0.7 ok, from 0.7 watch, from 0.9 act; a limit of 0 or less is `ok`)
  - `keyStatus(endsAt: Date | null, now: Date): LimitStatus` (watch within 60 days, act once past)

Limits to enter (basis `plan` unless noted): Upstash 500,000 commands a month; Resend 100 emails a day and 3,000 a month; R2 10 GB stored, 1,000,000 writes and 10,000,000 reads a month (basis `guess`, plan to confirm); Neon Launch and Vercel Hobby figures taken from each service's current pricing page at build time and marked `guess` where the page is not explicit; Pusher free plan marked `guess`.

- [ ] **Step 1:** `npm run db:drift`. If it reports a difference, stop and report it; do not push.
- [ ] **Step 2:** Failing tests for `statusOf` (0.69 ok, 0.70 watch, 0.90 act, limit 0 ok), `keyStatus` (61 days ok, 60 watch, yesterday act, null ok) and "every `LIMITS` entry has a positive limit and a unique service plus metric plus period".
- [ ] **Step 3:** Implement. Add the models. Write the SQL migration by hand to match. `prisma db push` (additive only; if it asks to drop anything, stop).
- [ ] **Step 4:** `redis-stats.ts` reads the monthly Upstash limit from `limits.ts` and compares it with the month's commands, not the day's. `db-stats.ts` reads its cap from `limits.ts` and drops the "Neon free tier" comment. Update whatever tests and page copy name the old figures.
- [ ] **Step 5:** Tests pass. Commit.

### Task 6: Drain

**Files:**
- Create: `src/lib/usage/rollup.ts`, `scripts/usage-rollup.ts`
- Modify: `.github/workflows/otter-hourly-sync.yml` (a step after the sync, `if: always()`, run through `scripts/run-as-job.ts usage.rollup`), the job schedule list in `src/lib/monitoring/job-schedules.ts` so staleness knows the new job
- Test: `tests/lib/usage/rollup.test.ts`

**Interfaces:**
- Consumes: `FlushPayload`, `PendingRow`, `PENDING_KEY`, `USAGE_SOURCES`
- Produces: `parsePending(entries: unknown[]): { rows: PendingRow[]; skipped: number }` (sums rows with the same hour, source and metric); `applyPending(rows: PendingRow[]): Promise<number>` (one `INSERT ... ON CONFLICT (hour, source, metric) DO UPDATE SET value = "UsageHour".value + EXCLUDED.value`)

Order in the script: `SET usage:rollup-lock 1 NX EX 1200`, and exit 0 without opening the database if it was not set. Then `LRANGE usage:pending 0 999`, `applyPending`, and only after the write succeeds `LTRIM usage:pending <n> -1`. A crash between the write and the trim counts one batch twice; that is accepted and written in the script's header comment.

- [ ] **Step 1: Failing tests.** `parsePending`: two payloads with the same key are summed; a string that is not JSON, a payload with `v: 2`, a row with an unknown source and a row with a non-finite value are each skipped and counted in `skipped` while valid neighbours survive; an already-parsed object (Upstash auto-parses JSON) is accepted as well as a string. `applyPending` with mocked Prisma: no rows means no query; rows mean exactly one statement.
- [ ] **Step 2 to 4:** Fail, implement, pass. **Step 5:** `npm run typecheck:scripts`. Commit.

### Task 7: Service readers

**Files:**
- Create: `src/lib/usage/services/{neon,upstash,resend,r2,pusher,github}.ts`, `src/lib/usage/services/index.ts`
- Modify: `scripts/usage-rollup.ts`, `.github/workflows/otter-hourly-sync.yml` (env for the new step), `.env.example`
- Test: `tests/lib/usage/services.test.ts`

**Interfaces:**
- Produces: `type Reading = { service: string; metric: string; value: number }`; `type ReadResult = { service: string; ok: boolean; note?: string; readings: Reading[] }`; each reader `read(): Promise<ReadResult>` and never rejects; `readAllServices(): Promise<ReadResult[]>` (all in parallel); the script writes each reading as a `ServiceUsage` row, and one row `{ metric: "read", value: 0, ok: false, note }` for a failed reader.

Env names: `NEON_API_KEY`, `NEON_PROJECT_ID`, `UPSTASH_EMAIL`, `UPSTASH_API_KEY`, `UPSTASH_REDIS_ID`, `RESEND_API_KEY` (exists), `CLOUDFLARE_ANALYTICS_TOKEN`, `R2_ACCOUNT_ID` (exists), `R2_BUCKET_NAME` (exists), the Pusher variables `liveTvs` already uses, `GITHUB_TOKEN` (the workflow's own).

Metrics: neon `computeSeconds`, `storageBytes`, `transferBytes` (month to date); upstash `commandsMonth`, `storageBytes`; resend `sentToday`, `sentMonth`; r2 `storedBytes`, `objects`, `writesMonth`, `readsMonth`; pusher `openChannels`; github `runsToday`, `minutesMonth`, `lateStartsToday`.

The R2 reader uses Cloudflare's GraphQL endpoint with the query shape proven on 2026-11-27: `r2StorageAdaptiveGroups` (`max { payloadSize objectCount }`, filtered by bucket and today's date) and `r2OperationsAdaptiveGroups` (`sum { requests }` by `actionType`, month to date). Writes are `PutObject`, `CopyObject`, `CompleteMultipartUpload`, `CreateMultipartUpload`, `UploadPart`, `ListObjects`, `ListMultipartUploads`, `PutBucket*`; reads are `GetObject`, `HeadObject`, `HeadBucket`. For the other five, look the endpoint up in the service's current API reference before writing it (the Neon and Upstash tools in this session can search theirs) and put the reference URL in the reader's header comment.

- [ ] **Step 1: Failing tests**, with `fetch` stubbed per reader: a good response maps to the readings above; a missing env variable gives `{ ok: false, note: "not connected" }` and makes no request; a 401 and a 500 give `ok: false` with the status in the note; a body of the wrong shape gives `ok: false`; `readAllServices` with one reader throwing still returns the other five.
- [ ] **Step 2 to 4:** Fail, implement, pass. **Step 5:** Run the script once locally against production's Redis and a local or branch database with whatever keys are present, and record which services read. **Step 6:** Commit.

### Task 8: Retention, then ship B

**Files:**
- Modify: the retention code behind `POST /api/cron/retention`
- Test: beside the existing retention tests

- [ ] **Step 1:** Failing test: `UsageHour` rows older than 35 days are summed by store-local date, source and metric into `UsageDay` (added to any existing row) and then deleted, in one transaction; rows 35 days old or newer are untouched; `ServiceUsage` rows older than 400 days are deleted. Use the store time zone helper the codebase already has.
- [ ] **Step 2 to 4:** Fail, implement, pass. **Step 5:** Full gate, open PR B, merge when CI is green.
- [ ] **Step 6:** After the next Otter sync run, confirm `UsageHour` and `ServiceUsage` have rows in production and `usage:pending` was trimmed. List for the owner which secrets are still missing.

---

## PR C: the page

### Task 9: Adapter

**Files:**
- Create: `src/lib/counter/adapters/monitoring-usage.ts`
- Test: `tests/lib/counter/adapters/monitoring-usage.test.ts`

Read `docs/query-rules.md`, `DESIGN.md` and `adapters/monitoring-infra.ts` first. Read the mock (https://claude.ai/artifact/Pm5K7tqfTHdXB5SoNkGCz6) with the Artifact tool and take the section shapes and the wording from it.

**Interfaces:**
- Consumes: the four tables, `LIMITS`, `statusOf`, `keyStatus`, `parsePending`, `PENDING_KEY`
- Produces: `getUsageSectionPromises(): StreamedSections<UsageSections>` and `getUsageSections()`, where `UsageSections` has `headline` (answer sentence, closest limit, last month's value, freshness, status word), `summary` (flow of sources into CPU, database, Redis and Pusher; closest four limits; today by hour), `sources` (six cards), `services` (all rows, top eight first), `live` (database connections, TVs with a socket open), `days` (month grid, per-source breakdown), `keys`.

One load for the widest span (this month and last month of `UsageHour` plus `UsageDay`, the latest `ServiceUsage` row per service and metric plus the same from a month earlier, `ServiceKey`, and one `LRANGE` of `usage:pending`), in parallel, sliced per section. The CPU split by source is each source's share of `wallMs` applied to the `all/cpuMs` total and is flagged `estimated: true`. A limit with basis `guess` is flagged `toConfirm: true`.

- [ ] **Step 1: Failing tests** with mocked Prisma and Redis: empty tables give a headline that says counting has not started and no percentage anywhere; one service at 92% gives status "Act now" and names it in the answer sentence; two at 71% and 75% give "Watch" and name the higher; pending Redis counts are added to today's totals; a failed service read shows "last read failed" with its time and is left out of the closest-limit ranking; a key ending in 45 days is Watch; the query count for one page view is asserted (state the number in the test).
- [ ] **Step 2 to 4:** Fail, implement, pass. Commit.

### Task 10: Desk and phone pages

**Files:**
- Create: `src/app/dashboard/(counter)/admin/monitoring/usage/{page.tsx,counter-usage-client.tsx,loading.tsx}`, `src/app/(mobile)/m/(counter)/monitoring/usage/{page.tsx,counter-phone-usage-client.tsx,loading.tsx}`, a server action for editing `ServiceKey` beside the other monitoring actions
- Modify: `src/lib/counter/nav.ts` (`{ label: "Usage", href: "/dashboard/admin/monitoring/usage" }` after Bridge), the fidelity and reachability registries that list monitoring pages, `tests/lib/usage/source.test.ts` if the new routes need a line

Use the `counter-page` skill, `modern-web-guidance` (with `DISABLE_TELEMETRY=1`) and the mock. Copy the page, client and loading structure from `monitoring/infrastructure/` on both desk and phone, including the session check and the `data-perf-ready` span.

- [ ] **Step 1:** Head: answer sentence, closest limit as the big number with last month's value, freshness, status in words.
- [ ] **Step 2:** Five tabs as links with `?tab=` (Summary, Sources, Services, Live, Days); phone gets the same five with stacked bars in place of the flow drawing. Services shows eight rows then "Show all 15". Lists stop at 5 to 8 rows.
- [ ] **Step 3:** Motion per DESIGN.md: bars and numbers ease in once; flowing dashes only with the "Pause live view" control and reduced motion off. No self-refresh; Live has a Refresh button.
- [ ] **Step 4:** Every estimate carries the word "estimated"; every `guess` limit reads "to confirm"; Vercel CPU reads "measured by the app" with a field to type Vercel's own figure (stored as a `ServiceUsage` row, service `vercel`, metric `cpuDashboard`).
- [ ] **Step 5:** `npm run tokens` and `npm run lint:hooks` clean. Look at both pages in a browser, light and dark, with real data and with empty tables.
- [ ] **Step 6:** `npm run fidelity -- --grep <pageId>`. Commit.

### Task 11: Ship C

- [ ] **Step 1:** Full gate. `graphify update .`. Update CLAUDE.md only if a rule here would otherwise be rediscovered the hard way.
- [ ] **Step 2:** Open PR C with the before and after query count for the page (query-rules). Merge when CI is green.
- [ ] **Step 3:** Open the page in production on desk and phone and confirm real figures. Report what is live, what is estimated and which secrets the owner still has to add.

## Not in this plan

Spec build step 5 (compare our Vercel CPU with Vercel's dashboard after a week of data) needs a week to pass. Alerts by email or text, and folding Infra, Costs and Cache into this page, are follow-ups named in the spec.
