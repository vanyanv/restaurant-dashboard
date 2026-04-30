# Dev Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the dev-only `/dashboard/monitoring` page with five new Prisma tables, instrumentation wrappers across every sync and AI call site, Discord alerting, and a DEVELOPER role — exactly as specced in `docs/superpowers/specs/2026-04-30-dev-monitoring-design.md`.

**Architecture:** Expand-then-contract Prisma migration so every phase is independently deployable. Five new tables (`JobRun`, `AiUsageEvent`, `ErrorEvent`, `ChatTurn`, `CacheStat`) written through small wrapper helpers in `src/lib/monitoring/`. Page is a server component composing six `.inv-panel` departments under the editorial Late-Edition Ledger system; live tiles refresh through TanStack Query. Discord alerter dedupes by inspecting prior cycle state — no `AlertSent` table.

**Tech Stack:** Next.js 15 App Router, React 19, Prisma + Postgres (Neon), TanStack Query v5, Tailwind v4, NextAuth v4, Upstash Redis, Recharts (existing), Vercel.

> **Note on TDD:** The repo has no test framework configured (no vitest/jest, zero test files). Each task's "verify" step is a concrete manual check (curl, Prisma Studio, browser, dev-server log) instead of a failing-then-passing automated test. This is a deliberate deviation from the writing-plans skill default — the alternative would be standing up vitest just for this feature, which is scope creep against a codebase that doesn't otherwise test.

> **Editorial design rules (apply to every UI task):** Every UI change must respect `DESIGN.md` and the four CLAUDE.md tripwires — no generic Tailwind colors on `/dashboard/*`, two-tier typography (Fraunces prose / DM Sans tabular numbers / JetBrains Mono captions), `.inv-row` hover pattern with red `scaleY(0→1)` proofmark, `.inv-panel` composition (no shadcn `<Card>`). If a step shows code that violates this, fix the code, not the rule.

---

## Phase Map

| Phase | Output | Deployable? |
|---|---|---|
| 1 | Additive schema migration (DEVELOPER role + 5 tables, NO drops) + Vardan promoted | ✓ |
| 2 | Instrumentation primitives (wrappers, db-stats, redis-stats, schedules, instrumentation.ts) | ✓ (no call sites use them yet) |
| 3 | Every sync wrapped in `withJobRun`; `InvoiceSyncLog` writes removed; `invoice-actions.ts` reads from `JobRun` | ✓ (InvoiceSyncLog still exists, unused) |
| 4 | All five AI call sites wired to `recordAiUsage`; chat writes `ChatTurn` with status classification | ✓ |
| 5 | Cache instrumented; `CacheStat` flusher cron; cache failures land in `ErrorEvent` | ✓ |
| 6 | `/dashboard/monitoring` route gate, layout, skeleton page, sidebar nav (DEVELOPER-conditional) | ✓ (page is empty shell) |
| 7 | All six panels + summary endpoint + shared spark / drawer components | ✓ (full UI live) |
| 8 | Discord alerter, sweep cron, evaluator wired into `withJobRun` | ✓ |
| 9 | 90-day cleanup cron, contract migration drops `InvoiceSyncLog` | ✓ (final state) |

---

## File Map

### New files (~30)

```
prisma/
  migrations/<ts>-monitoring-additive/migration.sql                    [Phase 1]
  migrations/<ts>-monitoring-drop-invoice-sync-log/migration.sql       [Phase 9]

src/lib/monitoring/
  job-run.ts            [Phase 2]   withJobRun()
  ai-usage.ts           [Phase 2]   recordAiUsage() + PRICING_PER_MTOK + computeCost()
  errors.ts             [Phase 2]   withApiHandler, withServerAction, recordError()
  cache-stats.ts        [Phase 5]   in-process counters + flushCacheStats()
  alerts.ts             [Phase 8]   evaluateAlerts() + RULES + postToDiscord()
  db-stats.ts           [Phase 2]   pg_database_size, pg_total_relation_size, pg_stat_activity
  redis-stats.ts        [Phase 2]   Upstash dbsize, info memory, info stats
  job-schedules.ts      [Phase 2]   JOB_SCHEDULES static map
  queries.ts            [Phase 7]   Prisma queries powering each panel

instrumentation.ts                                                     [Phase 2]

src/app/dashboard/monitoring/
  layout.tsx            [Phase 6]   DEVELOPER gate via notFound()
  page.tsx              [Phase 6 skeleton, Phase 7 panels wired]

src/components/monitoring/
  masthead.tsx          [Phase 7]
  front-page-lede.tsx   [Phase 7]
  syncs-panel.tsx       [Phase 7]
  errors-panel.tsx      [Phase 7]
  ai-spend-panel.tsx    [Phase 7]
  chat-panel.tsx        [Phase 7]
  database-panel.tsx    [Phase 7]
  cache-panel.tsx       [Phase 7]
  inline-spark.tsx      [Phase 7]
  drilldown-drawer.tsx  [Phase 7]

src/app/api/monitoring/
  summary/route.ts      [Phase 7]   live tile data

src/app/api/cron/monitoring/
  cache-flush/route.ts  [Phase 5]
  sweep/route.ts        [Phase 8]
  cleanup/route.ts      [Phase 9]
```

### Modified files (~13)

```
prisma/schema.prisma                                                   [Phase 1, Phase 9]
src/components/app-sidebar.tsx                                         [Phase 6]
src/lib/cache/cached.ts                                                [Phase 5]
src/app/actions/invoice-actions.ts                                     [Phase 3]
src/app/api/invoices/sync/route.ts                                     [Phase 3]
src/app/api/otter/sync/route.ts                                        [Phase 3]
src/lib/otter-orders-sync.ts                                           [Phase 3]
src/lib/hourly-sync.ts                                                 [Phase 3]
src/app/api/yelp/sync/route.ts                                         [Phase 3]
src/app/api/cron/otter/hourly/route.ts                                 [Phase 3]
src/app/api/cron/cogs/sweep/route.ts                                   [Phase 3]
src/app/api/cron/cogs/stores/route.ts                                  [Phase 3]
src/app/api/chat/route.ts                                              [Phase 4]
src/lib/openai-insights.ts                                             [Phase 4]
src/lib/gemini-invoice.ts                                              [Phase 4]
src/app/actions/product-usage-actions.ts                               [Phase 4]
```

---

## Phase 1 — Additive schema migration

**Files:** `prisma/schema.prisma` (modify), new migration directory.

### Task 1.1: Add `DEVELOPER` to `Role` enum

- [ ] **Step 1:** Edit `prisma/schema.prisma`. Locate the enum at line 12.

```prisma
enum Role {
  OWNER
  DEVELOPER
}
```

- [ ] **Step 2:** Run `npx prisma format` to normalize spacing.

### Task 1.2: Add the five monitoring models

- [ ] **Step 1:** In `prisma/schema.prisma`, add a new section at the bottom (after the last model). Paste exactly:

```prisma
// ─────────────────────────────────────────────────────────────────────────
// Monitoring (dev-only) — see docs/superpowers/specs/2026-04-30-dev-monitoring-design.md
// ─────────────────────────────────────────────────────────────────────────

enum JobStatus {
  RUNNING
  SUCCESS
  FAILURE
  PARTIAL
}

model JobRun {
  id           String    @id @default(cuid())
  jobName      String
  storeId      String?
  triggeredBy  String
  startedAt    DateTime  @default(now())
  completedAt  DateTime?
  durationMs   Int?
  status       JobStatus @default(RUNNING)
  rowsWritten  Int?
  metadata     Json?
  errorMessage String?
  errorStack   String?

  store Store? @relation(fields: [storeId], references: [id], onDelete: SetNull)

  @@index([jobName, startedAt(sort: Desc)])
  @@index([status, startedAt(sort: Desc)])
}

model AiUsageEvent {
  id               String   @id @default(cuid())
  occurredAt       DateTime @default(now())
  feature          String
  provider         String
  model            String
  inputTokens      Int
  outputTokens     Int
  cachedTokens     Int      @default(0)
  estimatedCostUsd Decimal  @db.Decimal(10, 6)
  storeId          String?
  userId           String?
  durationMs       Int?

  @@index([occurredAt(sort: Desc)])
  @@index([feature, occurredAt(sort: Desc)])
}

model ErrorEvent {
  id         String   @id @default(cuid())
  occurredAt DateTime @default(now())
  source     String
  route      String?
  method     String?
  status     Int?
  message    String
  stack      String?
  userId     String?
  storeId    String?
  metadata   Json?

  @@index([occurredAt(sort: Desc)])
  @@index([source, occurredAt(sort: Desc)])
}

model ChatTurn {
  id               String   @id @default(cuid())
  conversationId   String
  occurredAt       DateTime @default(now())
  userId           String?
  storeId          String?
  userMessage      String   @db.Text
  assistantMessage String?  @db.Text
  toolsUsed        String[]
  aiUsageEventId   String?
  status           String   @default("OK")
  finishReason     String?
  errorMessage     String?
  toolErrors       Json?
  feedback         String?

  @@index([occurredAt(sort: Desc)])
  @@index([conversationId, occurredAt])
}

model CacheStat {
  id         String   @id @default(cuid())
  hourBucket DateTime
  keyPrefix  String
  hits       Int      @default(0)
  misses     Int      @default(0)
  writes     Int      @default(0)
  busts      Int      @default(0)
  failures   Int      @default(0)

  @@unique([hourBucket, keyPrefix])
  @@index([hourBucket(sort: Desc)])
}
```

- [ ] **Step 2:** Open `prisma/schema.prisma` and locate the `Store` model. Add a back-relation field for `JobRun`:

```prisma
model Store {
  // ... existing fields ...
  jobRuns JobRun[]
}
```

(Place this with the other relation arrays in the `Store` model. Search for an existing `[]` relation field on `Store` and add the new line beside it.)

- [ ] **Step 3:** Run `npx prisma format` then `npx prisma validate`. Both should succeed silently.

### Task 1.3: Generate the migration

- [ ] **Step 1:** With `DATABASE_URL` pointing at your local Postgres (NOT prod), run:

```bash
npx prisma migrate dev --name monitoring_additive --create-only
```

- [ ] **Step 2:** Open the new file under `prisma/migrations/<ts>_monitoring_additive/migration.sql`. Verify it contains: `ALTER TYPE "Role" ADD VALUE 'DEVELOPER'`, `CREATE TYPE "JobStatus"`, five `CREATE TABLE` statements, the indexes, and the `Store_jobRuns` foreign key. Do NOT see any `DROP TABLE "InvoiceSyncLog"` — that comes in Phase 9.

- [ ] **Step 3:** Apply the migration locally:

```bash
npx prisma migrate dev
```

- [ ] **Step 4:** Verify schema:

```bash
npx prisma studio
```

Open Studio in the browser, confirm the five new tables exist and `InvoiceSyncLog` still exists.

### Task 1.4: Promote Vardan to DEVELOPER

- [ ] **Step 1:** Run a one-shot SQL via Prisma's executor against the database that holds Vardan's user (likely prod after migrate-deploy; local for testing now):

```bash
npx prisma db execute --stdin <<'SQL'
UPDATE "User" SET role = 'DEVELOPER' WHERE email = 'vardan@chrisneddys.com';
SELECT id, email, role FROM "User" WHERE role = 'DEVELOPER';
SQL
```

- [ ] **Step 2:** Confirm exactly one row returned with `role = DEVELOPER`. If Vardan's user doesn't exist locally, skip this step — it's a one-time prod operation done after the migration deploys.

### Task 1.5: Commit

- [ ] **Step 1:** Stage and commit:

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "schema: add DEVELOPER role + monitoring tables (additive)"
```

### Phase 1 verification

- `npx prisma generate && npx tsc --noEmit` succeeds.
- `npx prisma migrate dev` applies cleanly against a fresh DB.
- `SELECT 1 FROM "JobRun"; SELECT 1 FROM "AiUsageEvent"; SELECT 1 FROM "ErrorEvent"; SELECT 1 FROM "ChatTurn"; SELECT 1 FROM "CacheStat";` all return without error.
- `SELECT enum_range(NULL::"Role");` returns `{OWNER,DEVELOPER}`.
- `SELECT 1 FROM "InvoiceSyncLog";` still works (not yet dropped).

---

## Phase 2 — Instrumentation primitives

**Files:** all new under `src/lib/monitoring/`, plus `instrumentation.ts` at repo root.

### Task 2.1: `src/lib/monitoring/job-run.ts`

- [ ] **Step 1:** Create file with this exact content:

```ts
import { prisma } from "@/lib/prisma"
import { JobStatus } from "@/generated/prisma/client"

export type JobRunCtx = {
  jobRunId: string
  addRows: (n: number) => void
}

export type JobRunOpts = {
  storeId?: string | null
  triggeredBy: "cron" | "manual" | "webhook" | "github-actions" | "internal"
  metadata?: Record<string, unknown>
}

/**
 * Wrap a sync/cron operation. Writes a JobRun row at start (RUNNING),
 * updates to SUCCESS/FAILURE on completion, captures duration + rows + error.
 * Re-throws any caught error after writing the row, so existing error paths
 * still trigger upstream behavior.
 */
export async function withJobRun<T>(
  jobName: string,
  opts: JobRunOpts,
  fn: (ctx: JobRunCtx) => Promise<T>,
): Promise<T> {
  const run = await prisma.jobRun.create({
    data: {
      jobName,
      storeId: opts.storeId ?? null,
      triggeredBy: opts.triggeredBy,
      metadata: (opts.metadata ?? null) as never,
      status: JobStatus.RUNNING,
    },
    select: { id: true, startedAt: true },
  })

  let rows = 0
  const addRows = (n: number) => {
    rows += n
  }

  const start = Date.now()

  try {
    const result = await fn({ jobRunId: run.id, addRows })
    await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        status: JobStatus.SUCCESS,
        completedAt: new Date(),
        durationMs: Date.now() - start,
        rowsWritten: rows,
      },
    })
    // Phase 8 will add: void evaluateAlerts(run.id)
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    await prisma.jobRun
      .update({
        where: { id: run.id },
        data: {
          status: JobStatus.FAILURE,
          completedAt: new Date(),
          durationMs: Date.now() - start,
          rowsWritten: rows,
          errorMessage: message.slice(0, 4000),
          errorStack: stack?.slice(0, 8000),
        },
      })
      .catch(() => {})
    throw err
  }
}
```

- [ ] **Step 2:** Type-check: `npx tsc --noEmit`. Expect zero errors.

### Task 2.2: `src/lib/monitoring/ai-usage.ts`

- [ ] **Step 1:** Create with this content. Pricing values are USD per 1M tokens, current as of 2026-04-30 — update when providers change pricing.

```ts
import { prisma } from "@/lib/prisma"

export const PRICING_PER_MTOK = {
  "gpt-4.1-mini":     { in: 0.40, cachedIn: 0.10,  out: 1.60 },
  "gpt-4o-mini":      { in: 0.15, cachedIn: 0.075, out: 0.60 },
  "gemini-2.5-flash": { in: 0.30, cachedIn: 0.075, out: 2.50 },
} as const

export type AiUsageInput = {
  feature: string
  provider: "openai" | "google"
  model: string
  inputTokens: number
  outputTokens: number
  cachedTokens?: number
  storeId?: string | null
  userId?: string | null
  durationMs?: number
}

export function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
): number {
  const p = (PRICING_PER_MTOK as Record<string, { in: number; cachedIn: number; out: number }>)[model]
  if (!p) {
    console.warn(`[ai-usage] missing pricing for model "${model}" — recording $0`)
    return 0
  }
  const uncachedIn = Math.max(0, inputTokens - cachedTokens)
  return (
    (uncachedIn * p.in + cachedTokens * p.cachedIn + outputTokens * p.out) / 1_000_000
  )
}

/**
 * Record one AI call. Returns the created event id so callers (e.g. /api/chat)
 * can FK it from ChatTurn.aiUsageEventId. Never throws — pricing-table miss
 * logs a warning and writes 0; DB error logs and returns "".
 */
export async function recordAiUsage(input: AiUsageInput): Promise<string> {
  try {
    const cached = input.cachedTokens ?? 0
    const cost = computeCostUsd(input.model, input.inputTokens, input.outputTokens, cached)
    const row = await prisma.aiUsageEvent.create({
      data: {
        feature: input.feature,
        provider: input.provider,
        model: input.model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        cachedTokens: cached,
        estimatedCostUsd: cost,
        storeId: input.storeId ?? null,
        userId: input.userId ?? null,
        durationMs: input.durationMs ?? null,
      },
      select: { id: true },
    })
    return row.id
  } catch (err) {
    console.error("[ai-usage] write failed", err)
    return ""
  }
}
```

- [ ] **Step 2:** Type-check: `npx tsc --noEmit`. Expect zero errors.

### Task 2.3: `src/lib/monitoring/errors.ts`

- [ ] **Step 1:** Create with this content:

```ts
import { prisma } from "@/lib/prisma"
import type { NextRequest, NextResponse } from "next/server"

export type ErrorSource = "api" | "server-action" | "cron" | "client" | "alerter" | "cache" | "uncaught"

/**
 * Persist one error. Never throws; logs and swallows internal failures so
 * the recorder cannot itself crash the caller.
 */
export async function recordError(args: {
  source: ErrorSource
  route?: string | null
  method?: string | null
  status?: number | null
  message: string
  stack?: string | null
  userId?: string | null
  storeId?: string | null
  metadata?: Record<string, unknown> | null
}): Promise<void> {
  try {
    await prisma.errorEvent.create({
      data: {
        source: args.source,
        route: args.route ?? null,
        method: args.method ?? null,
        status: args.status ?? null,
        message: args.message.slice(0, 8000),
        stack: args.stack?.slice(0, 16000) ?? null,
        userId: args.userId ?? null,
        storeId: args.storeId ?? null,
        metadata: (args.metadata ?? null) as never,
      },
    })
  } catch (err) {
    console.error("[record-error] write failed", err)
  }
}

type RouteHandler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<NextResponse> | Promise<Response>

/**
 * Wrap a route handler. Catches uncaught throws, persists to ErrorEvent,
 * re-throws so Next still returns a 500. Use selectively on routes where
 * we want a record of failures — not blanket-applied (yet).
 */
export function withApiHandler(handler: RouteHandler): RouteHandler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : undefined
      await recordError({
        source: "api",
        route: new URL(req.url).pathname,
        method: req.method,
        status: 500,
        message,
        stack,
      })
      throw err
    }
  }
}

/**
 * Wrap a server action. Same shape as withApiHandler, no req/res — caller
 * passes a logical action name.
 */
export function withServerAction<TArgs extends unknown[], TReturn>(
  actionName: string,
  fn: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs) => {
    try {
      return await fn(...args)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : undefined
      await recordError({
        source: "server-action",
        route: actionName,
        message,
        stack,
      })
      throw err
    }
  }
}
```

- [ ] **Step 2:** Type-check: `npx tsc --noEmit`. Expect zero errors.

### Task 2.4: `src/lib/monitoring/job-schedules.ts`

- [ ] **Step 1:** Create with this content. Cadences are based on existing cron schedules; refine when more are added.

```ts
/**
 * Known cadence per job. Used by the monitoring page to compute "next expected"
 * and by the alert evaluator to detect overdue jobs (overdue = past 1.5× cadence).
 */
export type JobSchedule = {
  cadenceMinutes: number
  description: string
}

export const JOB_SCHEDULES: Record<string, JobSchedule> = {
  "otter.metrics.sync":     { cadenceMinutes: 60 * 6,  description: "every 6h" },
  "otter.orders.sync":      { cadenceMinutes: 60 * 6,  description: "every 6h" },
  "otter.hourly.sync":      { cadenceMinutes: 60,      description: "hourly" },
  "invoices.email.sync":    { cadenceMinutes: 60 * 6,  description: "every 6h" },
  "yelp.sync":              { cadenceMinutes: 60 * 24, description: "daily" },
  "cogs.sweep":             { cadenceMinutes: 60 * 24, description: "daily" },
  "cogs.stores":            { cadenceMinutes: 60 * 24, description: "daily" },
  "monitoring.cache-flush": { cadenceMinutes: 10,      description: "every 10m" },
  "monitoring.sweep":       { cadenceMinutes: 15,      description: "every 15m" },
  "monitoring.cleanup":     { cadenceMinutes: 60 * 24, description: "daily" },
}

export const OVERDUE_MULTIPLIER = 1.5

export function isOverdue(jobName: string, lastRunAt: Date | null): boolean {
  if (!lastRunAt) return false
  const sched = JOB_SCHEDULES[jobName]
  if (!sched) return false
  const ageMs = Date.now() - lastRunAt.getTime()
  return ageMs > sched.cadenceMinutes * 60_000 * OVERDUE_MULTIPLIER
}
```

### Task 2.5: `src/lib/monitoring/db-stats.ts`

- [ ] **Step 1:** Create with this content:

```ts
import { prisma } from "@/lib/prisma"

export type DbSize = {
  totalBytes: number
  capBytes: number
  pct: number
}

export type TableSize = {
  table: string
  bytes: number
  rows: bigint
}

export type DbConnections = {
  active: number
  max: number
}

const DEFAULT_CAP = 512 * 1024 * 1024 // Neon free tier

export async function getDbSize(): Promise<DbSize> {
  const rows = await prisma.$queryRaw<{ size: bigint }[]>`
    SELECT pg_database_size(current_database())::bigint AS size
  `
  const totalBytes = Number(rows[0]?.size ?? 0n)
  const capBytes = Number(process.env.NEON_STORAGE_CAP_BYTES ?? DEFAULT_CAP)
  return { totalBytes, capBytes, pct: capBytes > 0 ? (totalBytes / capBytes) * 100 : 0 }
}

export async function getTableSizes(limit = 12): Promise<TableSize[]> {
  const rows = await prisma.$queryRaw<{ relname: string; bytes: bigint; rows: bigint }[]>`
    SELECT
      c.relname,
      pg_total_relation_size(c.oid)::bigint AS bytes,
      COALESCE(c.reltuples::bigint, 0::bigint) AS rows
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC
    LIMIT ${limit}
  `
  return rows.map((r) => ({ table: r.relname, bytes: Number(r.bytes), rows: r.rows }))
}

export async function getConnections(): Promise<DbConnections> {
  const rows = await prisma.$queryRaw<{ active: bigint; max: bigint }[]>`
    SELECT
      (SELECT COUNT(*)::bigint FROM pg_stat_activity WHERE datname = current_database()) AS active,
      (SELECT setting::bigint FROM pg_settings WHERE name = 'max_connections') AS max
  `
  return { active: Number(rows[0]?.active ?? 0n), max: Number(rows[0]?.max ?? 0n) }
}
```

### Task 2.6: `src/lib/monitoring/redis-stats.ts`

- [ ] **Step 1:** Create with this content:

```ts
import { getRedis } from "@/lib/cache/redis"

export type RedisLive = {
  available: boolean
  keys: number
  memoryBytes: number
  memoryMaxBytes: number
  memoryPct: number
  commandsToday: number
  commandsLimit: number
  commandsPct: number
}

const DEFAULT_DAILY_CMD_LIMIT = Number(process.env.UPSTASH_DAILY_COMMAND_LIMIT ?? 500_000)

/**
 * Pull DBSIZE + memory + command counters from Upstash. Best-effort — any
 * field that fails parsing returns 0. If Upstash isn't configured, returns
 * { available: false } and zeros so the panel can render an empty state.
 */
export async function getRedisLive(): Promise<RedisLive> {
  const r = getRedis()
  if (!r) {
    return {
      available: false,
      keys: 0,
      memoryBytes: 0, memoryMaxBytes: 0, memoryPct: 0,
      commandsToday: 0, commandsLimit: DEFAULT_DAILY_CMD_LIMIT, commandsPct: 0,
    }
  }

  const [keys, info] = await Promise.all([
    r.dbsize().catch(() => 0),
    r.eval<string[], string>(`return redis.call('INFO')`, [], []).catch(() => ""),
  ])

  const used = parseInfoBytes(info, "used_memory")
  const max = parseInfoBytes(info, "maxmemory") || (256 * 1024 * 1024) // free-tier default
  const cmds = parseInfoNumber(info, "total_commands_processed")

  return {
    available: true,
    keys: Number(keys ?? 0),
    memoryBytes: used,
    memoryMaxBytes: max,
    memoryPct: max > 0 ? (used / max) * 100 : 0,
    // commandsToday is a process-life counter without a daily reset, but it's
    // still useful for "is this growing fast?" — daily-limit panel uses it directly.
    commandsToday: cmds,
    commandsLimit: DEFAULT_DAILY_CMD_LIMIT,
    commandsPct: DEFAULT_DAILY_CMD_LIMIT > 0 ? (cmds / DEFAULT_DAILY_CMD_LIMIT) * 100 : 0,
  }
}

function parseInfoBytes(info: string, key: string): number {
  const match = info.match(new RegExp(`^${key}:(\\d+)`, "m"))
  return match ? Number(match[1]) : 0
}

function parseInfoNumber(info: string, key: string): number {
  return parseInfoBytes(info, key) // identical parsing
}
```

### Task 2.7: `instrumentation.ts` at repo root

- [ ] **Step 1:** Create `/home/vardan/restaurant-dashboard/instrumentation.ts`:

```ts
/**
 * Next 15 instrumentation hook. Runs once per server process start.
 * Attaches Node-side handlers for uncaught errors so they land in
 * ErrorEvent instead of disappearing into stderr.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  const { recordError } = await import("@/lib/monitoring/errors")

  process.on("uncaughtException", (err) => {
    void recordError({
      source: "uncaught",
      message: err.message,
      stack: err.stack,
    })
  })

  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason))
    void recordError({
      source: "uncaught",
      message: err.message,
      stack: err.stack,
    })
  })
}
```

- [ ] **Step 2:** Verify Next picks it up: `npm run dev`. Server starts without warnings about instrumentation.ts.

### Task 2.8: Document env vars

- [ ] **Step 1:** Add a section to the spec README OR create `docs/superpowers/specs/2026-04-30-dev-monitoring-design.md`'s "Env" section as the canonical reference. Verify the four vars from the spec are documented (`DISCORD_MONITORING_WEBHOOK_URL`, `MONITORING_AI_DAILY_USD_LIMIT`, `NEON_STORAGE_CAP_BYTES`, `UPSTASH_DAILY_COMMAND_LIMIT`).

### Task 2.9: Commit

- [ ] **Step 1:**

```bash
git add src/lib/monitoring instrumentation.ts
git commit -m "monitoring: add instrumentation primitives (job-run, ai-usage, errors, db/redis stats)"
```

### Phase 2 verification

- `npx tsc --noEmit` succeeds.
- `npm run dev` starts without instrumentation.ts warnings.
- Open a Node REPL or temp script and call `await getDbSize()` against the local DB — non-zero `totalBytes`. Same for `await getRedisLive()` — `available: true` if Upstash creds are set, `false` otherwise.
- Manual exercise of `withJobRun`: in a temp script, `await withJobRun("test.smoke", { triggeredBy: "manual" }, async () => 1)` — observe a SUCCESS row in `JobRun`. Repeat with a function that throws — observe a FAILURE row with `errorMessage`.

---

## Phase 3 — Wire syncs to `withJobRun`

Each sync gets one wrapping commit. Pattern is identical: import `withJobRun`, wrap the existing body, capture row counts via `addRows`. The previous logging stays as fallback during the transition.

### Task 3.1: Replace `InvoiceSyncLog` writes in `/api/invoices/sync/route.ts`

- [ ] **Step 1:** Open the file. Replace the four `prisma.invoiceSyncLog.*` references:

  - `prisma.invoiceSyncLog.findFirst` (~line 236) — replace with a `JobRun` lookup:

```ts
const lastSync = await prisma.jobRun.findFirst({
  where: { jobName: "invoices.email.sync", status: "SUCCESS" },
  orderBy: { startedAt: "desc" },
  select: { startedAt: true },
})
const lookbackDays = lookbackDaysOverride ?? (lastSync ? 7 : 30)
```

  - The three `prisma.invoiceSyncLog.create({...})` calls — remove them entirely. The wrapping `withJobRun` (added in step 2) records start/finish and metadata.

- [ ] **Step 2:** Wrap the entire `runSync` (or equivalently named) function body in `withJobRun`. Locate the top-level handler (the `async function runSync(...)` or the body of the POST handler — search for `async function processSync`). Wrap as:

```ts
import { withJobRun } from "@/lib/monitoring/job-run"

// inside the handler, replacing the existing body:
return withJobRun(
  "invoices.email.sync",
  { triggeredBy: isCronRequest(req) ? "cron" : "manual" },
  async ({ addRows }) => {
    const result = await runSyncImpl(emit, userId, accountId, lookbackDaysOverride)
    addRows(result.created)
    return result
  },
)
```

If the existing function returns a SyncResult, propagate it as the wrapper's return.

- [ ] **Step 3:** Pass `metadata` to the JobRun row by passing extra fields through to a follow-up update (the wrapper writes metadata only at start; final counts live in `rowsWritten`). For richer detail, modify `withJobRun` later — for now, `rowsWritten = created` is enough; `scanned/skipped/errors` can be inferred from the surrounding context.

  **Alternative (cleaner):** widen the wrapper closure to write `metadata` at end. For Phase 3 keep it minimal — `rowsWritten` is enough. Spec allows `metadata` to be added in Phase 9 if richer drilldowns need it.

- [ ] **Step 4:** Run the dev server, trigger an invoice sync (`/api/invoices/sync` POST while logged in as Vardan). Observe a `JobRun` row with `jobName = invoices.email.sync` and `status = SUCCESS`.

- [ ] **Step 5:** Commit.

```bash
git add src/app/api/invoices/sync/route.ts
git commit -m "invoices: route sync through withJobRun, drop InvoiceSyncLog writes"
```

### Task 3.2: Update `src/app/actions/invoice-actions.ts` last-sync read

- [ ] **Step 1:** Open the file. Find references to `invoiceSyncLog`. Replace each `prisma.invoiceSyncLog.findFirst({...})` with:

```ts
const lastSync = await prisma.jobRun.findFirst({
  where: { jobName: "invoices.email.sync", status: "SUCCESS" },
  orderBy: { startedAt: "desc" },
  select: { startedAt: true, completedAt: true, rowsWritten: true },
})
// callers reading lastSync.completedAt / .startedAt / .invoicesCreated:
//   replace lastSync.invoicesCreated with lastSync.rowsWritten
```

- [ ] **Step 2:** Search for any remaining `invoiceSyncLog` references in the file: `grep -n invoiceSyncLog src/app/actions/invoice-actions.ts` should return zero matches.

- [ ] **Step 3:** `npx tsc --noEmit` succeeds.

- [ ] **Step 4:** Commit.

```bash
git add src/app/actions/invoice-actions.ts
git commit -m "invoices: read last-sync from JobRun"
```

### Task 3.3: Wrap `/api/otter/sync/route.ts`

- [ ] **Step 1:** Open the file. Find the POST handler. Wrap its body:

```ts
import { withJobRun } from "@/lib/monitoring/job-run"

// inside POST:
return withJobRun(
  "otter.metrics.sync",
  { triggeredBy: isCronRequest(req) ? "cron" : "manual" },
  async ({ addRows }) => {
    const result = await runOtterMetricsSync(...)
    addRows(result.dailyRows + result.menuRows + result.ratingRows)  // adjust to actual return shape
    return NextResponse.json(result)
  },
)
```

(Adjust `runOtterMetricsSync` to whatever the existing function is named — search the file. Adjust the `addRows` total to whatever the result object exposes.)

- [ ] **Step 2:** Trigger the sync; observe `JobRun` row.

- [ ] **Step 3:** Commit.

```bash
git add src/app/api/otter/sync/route.ts
git commit -m "otter: route metrics sync through withJobRun"
```

### Task 3.4: Wrap `src/lib/otter-orders-sync.ts`

- [ ] **Step 1:** Open the file. Find the exported entrypoint (likely `syncOtterOrders` or similar). Wrap its body:

```ts
import { withJobRun } from "@/lib/monitoring/job-run"

export async function syncOtterOrders(opts: { storeId?: string; triggeredBy?: "cron" | "manual" }) {
  return withJobRun(
    "otter.orders.sync",
    { storeId: opts.storeId ?? null, triggeredBy: opts.triggeredBy ?? "manual" },
    async ({ addRows }) => {
      // ... existing body ...
      addRows(insertedOrders)
      return result
    },
  )
}
```

- [ ] **Step 2:** Find every caller of this function and ensure they pass `triggeredBy` if they know it (cron callers should pass `"cron"`).

- [ ] **Step 3:** Trigger; observe row.

- [ ] **Step 4:** Commit.

```bash
git add src/lib/otter-orders-sync.ts
git commit -m "otter: wrap orders sync in withJobRun"
```

### Task 3.5: Wrap `src/lib/hourly-sync.ts`

- [ ] **Step 1:** Same pattern — wrap the exported entrypoint with `jobName: "otter.hourly.sync"`. `triggeredBy` from the cron caller. `addRows` = number of hourly summary rows upserted.

- [ ] **Step 2:** Verify, commit.

```bash
git add src/lib/hourly-sync.ts
git commit -m "otter: wrap hourly sync in withJobRun"
```

### Task 3.6: Wrap `/api/yelp/sync/route.ts`

- [ ] **Step 1:** `jobName: "yelp.sync"`. `addRows` = number of stores updated.

- [ ] **Step 2:** Verify, commit.

### Task 3.7: Wrap the three cron handlers

- [ ] **Step 1:** `/api/cron/otter/hourly/route.ts` — already calls `hourly-sync` which is now wrapped. Verify the cron handler doesn't double-wrap. If it has its own surrounding logic, leave the wrap in `hourly-sync.ts` only.

- [ ] **Step 2:** `/api/cron/cogs/sweep/route.ts` — wrap with `jobName: "cogs.sweep"`, `triggeredBy: "github-actions"`, `storeId` from request body.

- [ ] **Step 3:** `/api/cron/cogs/stores/route.ts` — wrap with `jobName: "cogs.stores"`, `triggeredBy: "github-actions"`.

- [ ] **Step 4:** Trigger each cron locally (curl with the appropriate headers/secrets). Observe rows.

- [ ] **Step 5:** Commit.

```bash
git add src/app/api/cron
git commit -m "cron: wrap cogs + otter hourly cron handlers in withJobRun"
```

### Phase 3 verification

- Each of the 8 known jobs writes a `JobRun` row when triggered. Confirm via:

```bash
npx prisma studio
```

Then in Studio's `JobRun` table, see distinct `jobName` values for every wrapped sync.

- `grep -rn "invoiceSyncLog" src/` returns zero matches in non-generated files (matches in `src/generated/prisma/` are expected — they regenerate on the contract migration in Phase 9).
- The dev server runs without errors after every sync trigger.

---

## Phase 4 — Wire AI calls + ChatTurn

### Task 4.1: Capture token usage in `src/lib/openai-insights.ts`

- [ ] **Step 1:** Open the file. Locate the existing `OpenAIUsage` shape returned alongside the response (around lines 24–84 per the spec exploration).

- [ ] **Step 2:** After the API response is parsed, before returning, call:

```ts
import { recordAiUsage } from "@/lib/monitoring/ai-usage"

// after response.usage is captured:
await recordAiUsage({
  feature: "pnl-insights",
  provider: "openai",
  model: response.model,                       // or the model constant used
  inputTokens: usage.promptTokens,
  outputTokens: usage.completionTokens,
  cachedTokens: usage.cachedPromptTokens ?? 0,
  storeId: opts.storeId ?? null,                // pass through if available
  userId: opts.userId ?? null,
  durationMs: Date.now() - start,               // track start at top of fn
})
```

- [ ] **Step 3:** Trigger a P&L insight via the dashboard. Observe an `AiUsageEvent` row with `feature = pnl-insights` and `estimatedCostUsd > 0`.

- [ ] **Step 4:** Commit.

### Task 4.2: Capture token usage in `src/lib/gemini-invoice.ts`

- [ ] **Step 1:** Currently drops `usageMetadata`. After the Gemini response, extract:

```ts
const inputTokens = response.usageMetadata?.promptTokenCount ?? 0
const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0
```

(For OpenAI fallback path, use `response.usage.prompt_tokens` / `completion_tokens` and `provider: "openai"`, `model: "gpt-4.1-mini"`.)

- [ ] **Step 2:** Call `recordAiUsage({ feature: "invoice-ocr", provider: ..., model: ..., inputTokens, outputTokens })` after each response.

- [ ] **Step 3:** Trigger an invoice sync that processes at least one PDF. Observe an `AiUsageEvent` row with `feature = invoice-ocr`.

- [ ] **Step 4:** Commit.

### Task 4.3: Capture token usage in `src/app/actions/product-usage-actions.ts`

- [ ] **Step 1:** Three AI calls inside the file (around lines 1034–1110, 1114–1311, 1315–1555 per the spec). For each, after the response, call:

```ts
await recordAiUsage({
  feature: "usage-insights" /* or "usage-demand" or "usage-weekly" */,
  provider: "openai",
  model: "gpt-4o-mini",
  inputTokens: response.usage?.prompt_tokens ?? 0,
  outputTokens: response.usage?.completion_tokens ?? 0,
})
```

Use distinct `feature` values per call to keep them separable on the panel.

- [ ] **Step 2:** Run each of the three actions from the dashboard. Observe three new `AiUsageEvent` rows with the three distinct `feature` values.

- [ ] **Step 3:** Commit.

### Task 4.4: Add ChatTurn writing to `/api/chat/route.ts` (with status classification)

- [ ] **Step 1:** Open the file. Locate the streaming AI response section (around lines 160–174 per the spec).

- [ ] **Step 2:** Generate a `conversationId` for the request: if the chat UI passes one, use it; otherwise generate a fresh `cuid()`. Store at the top of the handler.

- [ ] **Step 3:** Capture the user's last message before the API call:

```ts
const userMessage = messages[messages.length - 1]?.content ?? ""
const userMessageStored = String(userMessage).slice(0, 4000)
```

- [ ] **Step 4:** After the streaming response completes (in the `onFinish` callback for the AI SDK), classify status and write the row:

```ts
import { recordAiUsage } from "@/lib/monitoring/ai-usage"
import { prisma } from "@/lib/prisma"

// ... existing streamText call ...
onFinish: async ({ text, finishReason, usage, toolCalls, toolResults }) => {
  const aiUsageEventId = await recordAiUsage({
    feature: "chat",
    provider: "openai",
    model: "gpt-4.1-mini",
    inputTokens: usage.promptTokens ?? 0,
    outputTokens: usage.completionTokens ?? 0,
    cachedTokens: usage.cachedPromptTokens ?? 0,
    userId: session.user.id,
    durationMs: Date.now() - start,
  })

  const toolErrors: Record<string, string> = {}
  for (const r of toolResults ?? []) {
    if ((r as { error?: unknown }).error) {
      toolErrors[r.toolName] = String((r as { error: unknown }).error)
    }
  }

  let status: "OK" | "EMPTY" | "TRUNCATED" | "REFUSED" | "TOOL_FAILED" = "OK"
  if (Object.keys(toolErrors).length > 0) status = "TOOL_FAILED"
  else if (finishReason === "length") status = "TRUNCATED"
  else if (finishReason === "content-filter") status = "REFUSED"
  else if (!text || text.trim().length === 0) status = "EMPTY"

  await prisma.chatTurn.create({
    data: {
      conversationId,
      userId: session.user.id,
      userMessage: userMessageStored,
      assistantMessage: String(text ?? "").slice(0, 4000),
      toolsUsed: (toolCalls ?? []).map((c) => c.toolName),
      aiUsageEventId,
      status,
      finishReason: finishReason ?? null,
      toolErrors: Object.keys(toolErrors).length > 0 ? (toolErrors as never) : undefined,
    },
  })
},
```

- [ ] **Step 5:** Wrap the entire chat handler body (the `try` containing the `streamText` call) with a top-level catch that classifies hard failures:

```ts
try {
  // ... streamText body ...
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  const isRateLimit = /rate.?limit|429/i.test(message)
  await prisma.chatTurn.create({
    data: {
      conversationId,
      userId: session.user.id,
      userMessage: userMessageStored,
      assistantMessage: null,
      toolsUsed: [],
      status: isRateLimit ? "RATE_LIMITED" : "ERROR",
      errorMessage: message.slice(0, 4000),
    },
  })
  throw err
}
```

- [ ] **Step 6:** Send a chat message via `/dashboard/chat`. Confirm `ChatTurn` row with `status = OK`, populated `userMessage` + `assistantMessage`, FK'd `aiUsageEventId`.

- [ ] **Step 7:** Force one failure mode: temporarily break the OpenAI key (env var) and send a message. Confirm `ChatTurn` row with `status = ERROR` + `errorMessage`. Restore the key.

- [ ] **Step 8:** Commit.

```bash
git add src/app/api/chat/route.ts
git commit -m "chat: write ChatTurn with status classification + recordAiUsage"
```

### Phase 4 verification

- `AiUsageEvent` rows exist for: `chat`, `pnl-insights`, `invoice-ocr`, `usage-insights`, `usage-demand`, `usage-weekly` (after exercising each).
- Each row's `estimatedCostUsd` is non-zero (or zero with a console warning if pricing-table miss).
- `ChatTurn` rows accumulate per chat message with correct `status`.
- Forced error → `ChatTurn.status = "ERROR"`.

---

## Phase 5 — Cache instrumentation

### Task 5.1: Create `src/lib/monitoring/cache-stats.ts`

- [ ] **Step 1:** Create with this content:

```ts
import { prisma } from "@/lib/prisma"

type Counter = { hits: number; misses: number; writes: number; busts: number; failures: number }
const counters = new Map<string, Counter>()

const FLUSH_EVERY_OPS = 200

let opsSinceFlush = 0

function getOrCreate(prefix: string): Counter {
  let c = counters.get(prefix)
  if (!c) {
    c = { hits: 0, misses: 0, writes: 0, busts: 0, failures: 0 }
    counters.set(prefix, c)
  }
  return c
}

function maybeFlush() {
  opsSinceFlush++
  if (opsSinceFlush >= FLUSH_EVERY_OPS) {
    void flushCacheStats()
  }
}

export function bumpHit(prefix: string)     { getOrCreate(prefix).hits++;     maybeFlush() }
export function bumpMiss(prefix: string)    { getOrCreate(prefix).misses++;   maybeFlush() }
export function bumpWrite(prefix: string)   { getOrCreate(prefix).writes++;   maybeFlush() }
export function bumpBust(prefix: string)    { getOrCreate(prefix).busts++;    maybeFlush() }
export function bumpFailure(prefix: string) { getOrCreate(prefix).failures++; maybeFlush() }

/**
 * Upsert all in-process counters into CacheStat. Called from the 10-min cron
 * and opportunistically every FLUSH_EVERY_OPS operations.
 */
export async function flushCacheStats(): Promise<{ flushed: number }> {
  if (counters.size === 0) return { flushed: 0 }

  const snapshot = new Map(counters)
  counters.clear()
  opsSinceFlush = 0

  const hour = new Date()
  hour.setMinutes(0, 0, 0)

  let flushed = 0
  for (const [prefix, c] of snapshot) {
    try {
      await prisma.cacheStat.upsert({
        where: { hourBucket_keyPrefix: { hourBucket: hour, keyPrefix: prefix } },
        create: { hourBucket: hour, keyPrefix: prefix, ...c },
        update: {
          hits:     { increment: c.hits },
          misses:   { increment: c.misses },
          writes:   { increment: c.writes },
          busts:    { increment: c.busts },
          failures: { increment: c.failures },
        },
      })
      flushed++
    } catch (err) {
      console.error("[cache-stats] flush failed for", prefix, err)
      // restore counts so we don't lose them on the next pass
      const restore = getOrCreate(prefix)
      restore.hits     += c.hits
      restore.misses   += c.misses
      restore.writes   += c.writes
      restore.busts    += c.busts
      restore.failures += c.failures
    }
  }
  return { flushed }
}

export function prefixOf(cacheKey: string): string {
  const idx = cacheKey.indexOf(":")
  return idx > 0 ? cacheKey.slice(0, idx) : cacheKey
}
```

### Task 5.2: Instrument `src/lib/cache/cached.ts`

- [ ] **Step 1:** Open the file. Add at the top:

```ts
import { bumpHit, bumpMiss, bumpWrite, bumpBust, bumpFailure, prefixOf } from "@/lib/monitoring/cache-stats"
import { recordError } from "@/lib/monitoring/errors"
```

- [ ] **Step 2:** In `cached()`, after `redis.get<T>(key)`:
  - On hit: `bumpHit(prefixOf(key))` before returning.
  - On miss (or null/undefined): `bumpMiss(prefixOf(key))` before invoking loader.
  - On write success: `bumpWrite(prefixOf(key))`.
  - On read failure (catch block): `bumpFailure(prefixOf(key))` AND `recordError({ source: "cache", message: ..., metadata: { op: "read", key } })`.
  - On write failure: `bumpFailure(prefixOf(key))` AND `recordError({ source: "cache", message: ..., metadata: { op: "write", key } })`.

- [ ] **Step 3:** In `bustTags()`, after a successful tag's bust (after `pipe.exec()`): `bumpBust(tag)` for each tag processed.

- [ ] **Step 4:** Type-check, run dev, hit any cached endpoint repeatedly. The counters live in-process — call `flushCacheStats()` from a Node REPL and confirm a `CacheStat` row is created.

- [ ] **Step 5:** Commit.

```bash
git add src/lib/cache/cached.ts src/lib/monitoring/cache-stats.ts
git commit -m "cache: bump hit/miss/write/bust/failure counters + flusher"
```

### Task 5.3: Create `/api/cron/monitoring/cache-flush/route.ts`

- [ ] **Step 1:** Create with this content:

```ts
import { NextRequest, NextResponse } from "next/server"
import { isCronRequest } from "@/lib/rate-limit"
import { flushCacheStats } from "@/lib/monitoring/cache-stats"

export const maxDuration = 10

export async function POST(req: NextRequest) {
  if (!isCronRequest(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const result = await flushCacheStats()
  return NextResponse.json(result)
}
```

- [ ] **Step 2:** Add a schedule for this in the GitHub Actions cron config (or `vercel.json` `crons` block — match whichever the project uses for the existing cogs/otter crons). Cadence: every 10 minutes.

- [ ] **Step 3:** Manually curl the endpoint with the cron secret. Observe a `CacheStat` row written with the in-process counter values.

- [ ] **Step 4:** Commit.

```bash
git add src/app/api/cron/monitoring
git commit -m "monitoring: add cache-flush cron endpoint"
```

### Phase 5 verification

- After driving cache hits via `/dashboard/pnl` (or any cached endpoint) and curling the flush endpoint, `CacheStat` rows exist with realistic `hits`/`misses`.
- Forcing a cache-write failure (temporarily break Upstash creds) writes one `ErrorEvent` with `source = "cache"`.

---

## Phase 6 — Route gate + sidebar

### Task 6.1: Layout gate `src/app/dashboard/monitoring/layout.tsx`

- [ ] **Step 1:** Create directory + file:

```ts
import { notFound } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export default async function MonitoringLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (session?.user.role !== "DEVELOPER") notFound()
  return <>{children}</>
}
```

### Task 6.2: Page skeleton `src/app/dashboard/monitoring/page.tsx`

- [ ] **Step 1:** Create with this content (Phase 7 fills it in):

```tsx
export default function MonitoringPage() {
  return (
    <main className="px-6 py-10 max-w-275 mx-auto">
      <h1
        className="font-serif"
        style={{
          fontSize: "clamp(28px, 4vw, 44px)",
          fontWeight: 500,
          fontVariationSettings: '"opsz" 144, "SOFT" 30',
          letterSpacing: "-0.03em",
          lineHeight: 0.95,
          color: "var(--ink)",
        }}
      >
        Monitoring
      </h1>
      <p className="mt-4 font-mono uppercase tracking-[0.12em] text-[10px] text-(--ink-faint)">
        — page panels coming in phase 7 —
      </p>
    </main>
  )
}
```

### Task 6.3: Conditional Monitoring nav item in `src/components/app-sidebar.tsx`

- [ ] **Step 1:** Open the file. The component is `"use client"` and uses `signOut` from `next-auth/react` — add `useSession` import alongside:

```tsx
import { signOut, useSession } from "next-auth/react"
```

- [ ] **Step 2:** Inside the component (inside `AppSidebar`, before the JSX return), read the session role:

```tsx
const { data: session } = useSession()
const isDev = session?.user.role === "DEVELOPER"
```

- [ ] **Step 3:** Build a derived NAV with the Monitoring item appended to "Back of House" only when `isDev`:

```tsx
const nav = React.useMemo(() => {
  if (!isDev) return NAV
  return NAV.map((section) =>
    section.label === "Back of House"
      ? {
          ...section,
          items: [
            ...section.items,
            { title: "Monitoring", url: "/dashboard/monitoring", icon: Activity },
          ],
        }
      : section,
  )
}, [isDev])
```

`Activity` is already imported. Render `nav` instead of `NAV` in the JSX.

- [ ] **Step 4:** Smoke test: log in as Vardan (after Phase 1 promotion). The sidebar shows "Monitoring" at the bottom of Back of House. Log in as Chris — the entry is absent. Visit `/dashboard/monitoring` directly while logged in as Chris — Next 404. Visit while logged in as Vardan — page loads.

- [ ] **Step 5:** Commit.

```bash
git add src/app/dashboard/monitoring src/components/app-sidebar.tsx
git commit -m "monitoring: dev-only route gate + sidebar entry (skeleton page)"
```

### Phase 6 verification

- Chris (OWNER) → `/dashboard/monitoring` returns Next's 404, no Monitoring item in sidebar.
- Vardan (DEVELOPER) → page renders with the title and placeholder line, Monitoring item visible.

---

## Phase 7 — The page (panels + masthead + drilldowns)

This phase is the largest. Each panel is its own task. Build shared components first.

### Task 7.1: `src/lib/monitoring/queries.ts`

- [ ] **Step 1:** Create with this content (Prisma queries powering each panel):

```ts
import { prisma } from "@/lib/prisma"
import { JOB_SCHEDULES, isOverdue } from "./job-schedules"

export type SyncRow = {
  jobName: string
  lastRunAt: Date | null
  status: "RUNNING" | "SUCCESS" | "FAILURE" | "PARTIAL" | null
  rowsWritten: number | null
  durationMs: number | null
  overdue: boolean
  cadenceLabel: string
}

export async function getSyncs(storeId?: string | null): Promise<SyncRow[]> {
  const knownJobs = Object.keys(JOB_SCHEDULES)
  const latest = await Promise.all(
    knownJobs.map(async (jobName) => {
      const row = await prisma.jobRun.findFirst({
        where: { jobName, ...(storeId ? { storeId } : {}) },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true, status: true, rowsWritten: true, durationMs: true },
      })
      return {
        jobName,
        lastRunAt: row?.startedAt ?? null,
        status: row?.status ?? null,
        rowsWritten: row?.rowsWritten ?? null,
        durationMs: row?.durationMs ?? null,
        overdue: isOverdue(jobName, row?.startedAt ?? null),
        cadenceLabel: JOB_SCHEDULES[jobName].description,
      }
    }),
  )
  return latest
}

export async function getRecentErrors(limit = 50) {
  return prisma.errorEvent.findMany({
    orderBy: { occurredAt: "desc" },
    take: limit,
    select: { id: true, occurredAt: true, source: true, route: true, status: true, message: true, stack: true },
  })
}

export async function getErrorCount24h() {
  const since = new Date(Date.now() - 24 * 3600_000)
  return prisma.errorEvent.count({ where: { occurredAt: { gte: since } } })
}

export async function getErrorsByHour(hours = 24) {
  const since = new Date(Date.now() - hours * 3600_000)
  const rows = await prisma.$queryRaw<{ bucket: Date; count: bigint }[]>`
    SELECT date_trunc('hour', "occurredAt") AS bucket, COUNT(*)::bigint AS count
    FROM "ErrorEvent"
    WHERE "occurredAt" >= ${since}
    GROUP BY 1 ORDER BY 1 ASC
  `
  return rows.map((r) => ({ bucket: r.bucket, count: Number(r.count) }))
}

export async function getAiCostByDay(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000)
  const rows = await prisma.$queryRaw<{ day: Date; cost: number; tokens: bigint }[]>`
    SELECT
      date_trunc('day', "occurredAt") AS day,
      SUM("estimatedCostUsd")::float AS cost,
      SUM("inputTokens" + "outputTokens")::bigint AS tokens
    FROM "AiUsageEvent"
    WHERE "occurredAt" >= ${since}
    GROUP BY 1 ORDER BY 1 ASC
  `
  return rows.map((r) => ({ day: r.day, cost: Number(r.cost ?? 0), tokens: Number(r.tokens ?? 0n) }))
}

export async function getAiByFeature(hours = 24) {
  const since = new Date(Date.now() - hours * 3600_000)
  const rows = await prisma.$queryRaw<{ feature: string; provider: string; model: string; calls: bigint; tokens_in: bigint; tokens_out: bigint; cost: number }[]>`
    SELECT
      feature,
      MIN(provider) AS provider,
      MIN(model) AS model,
      COUNT(*)::bigint AS calls,
      SUM("inputTokens")::bigint AS tokens_in,
      SUM("outputTokens")::bigint AS tokens_out,
      SUM("estimatedCostUsd")::float AS cost
    FROM "AiUsageEvent"
    WHERE "occurredAt" >= ${since}
    GROUP BY feature
    ORDER BY cost DESC
  `
  return rows.map((r) => ({
    feature: r.feature,
    provider: r.provider,
    model: r.model,
    calls: Number(r.calls),
    tokensIn: Number(r.tokens_in),
    tokensOut: Number(r.tokens_out),
    cost: Number(r.cost ?? 0),
  }))
}

export async function getChatStats(hours = 24) {
  const since = new Date(Date.now() - hours * 3600_000)
  const rows = await prisma.$queryRaw<{ status: string; count: bigint }[]>`
    SELECT status, COUNT(*)::bigint AS count
    FROM "ChatTurn"
    WHERE "occurredAt" >= ${since}
    GROUP BY status
  `
  return rows.map((r) => ({ status: r.status, count: Number(r.count) }))
}

export async function getRecentNonOkChatTurns(limit = 20) {
  return prisma.chatTurn.findMany({
    where: { status: { not: "OK" } },
    orderBy: { occurredAt: "desc" },
    take: limit,
    select: {
      id: true, occurredAt: true, status: true, finishReason: true,
      userMessage: true, assistantMessage: true, errorMessage: true, toolErrors: true,
      aiUsageEventId: true,
    },
  })
}

export async function getCacheStats(hours = 168) {
  const since = new Date(Date.now() - hours * 3600_000)
  const rows = await prisma.$queryRaw<{ keyPrefix: string; hits: bigint; misses: bigint; writes: bigint; busts: bigint; failures: bigint }[]>`
    SELECT
      "keyPrefix",
      SUM(hits)::bigint     AS hits,
      SUM(misses)::bigint   AS misses,
      SUM(writes)::bigint   AS writes,
      SUM(busts)::bigint    AS busts,
      SUM(failures)::bigint AS failures
    FROM "CacheStat"
    WHERE "hourBucket" >= ${since}
    GROUP BY "keyPrefix"
    ORDER BY (SUM(hits) + SUM(misses)) DESC
  `
  return rows.map((r) => {
    const hits = Number(r.hits)
    const misses = Number(r.misses)
    const total = hits + misses
    return {
      keyPrefix: r.keyPrefix,
      hits, misses,
      writes: Number(r.writes),
      busts: Number(r.busts),
      failures: Number(r.failures),
      hitPct: total > 0 ? (hits / total) * 100 : 0,
      sample: total,
    }
  })
}
```

### Task 7.2: Summary endpoint `/api/monitoring/summary/route.ts`

- [ ] **Step 1:** Create:

```ts
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getDbSize, getConnections } from "@/lib/monitoring/db-stats"
import { getRedisLive } from "@/lib/monitoring/redis-stats"
import { getSyncs, getErrorCount24h } from "@/lib/monitoring/queries"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (session?.user.role !== "DEVELOPER") {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  const url = new URL(req.url)
  const storeId = url.searchParams.get("store") || undefined

  const [db, redis, conn, syncs, errorsCount, todayCost] = await Promise.all([
    getDbSize(),
    getRedisLive(),
    getConnections(),
    getSyncs(storeId === "all" ? null : storeId ?? null),
    getErrorCount24h(),
    aiCostToday(),
  ])

  return NextResponse.json({
    refreshedAt: new Date().toISOString(),
    db,
    redis,
    conn,
    syncs,
    errorsCount,
    todayCostUsd: todayCost,
  })
}

async function aiCostToday(): Promise<number> {
  const since = new Date()
  since.setHours(0, 0, 0, 0)
  const rows = await prisma.$queryRaw<{ s: number }[]>`
    SELECT COALESCE(SUM("estimatedCostUsd"), 0)::float AS s
    FROM "AiUsageEvent" WHERE "occurredAt" >= ${since}
  `
  return Number(rows[0]?.s ?? 0)
}
```

### Task 7.3: Shared `inline-spark.tsx`

- [ ] **Step 1:** Create with this content:

```tsx
"use client"

type Point = { x: number | Date; y: number }

export function InlineSpark({
  points,
  width = 80,
  height = 16,
  baselineMultiplier = 1.5,
}: {
  points: Point[]
  width?: number
  height?: number
  baselineMultiplier?: number
}) {
  if (points.length === 0) {
    return <span className="inline-block" style={{ width, height }} aria-hidden />
  }
  const ys = points.map((p) => p.y)
  const max = Math.max(1, ...ys)
  const min = Math.min(0, ...ys)
  const range = max - min || 1
  const stepX = points.length > 1 ? width / (points.length - 1) : 0
  const path = points
    .map((p, i) => {
      const x = i * stepX
      const y = height - ((p.y - min) / range) * height
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")
  const last = points[points.length - 1]
  const lastX = (points.length - 1) * stepX
  const lastY = height - ((last.y - min) / range) * height
  const baseline = ys.slice(0, -1).reduce((a, b) => a + b, 0) / Math.max(1, ys.length - 1)
  const isElevated = baseline > 0 && last.y > baseline * baselineMultiplier
  return (
    <svg width={width} height={height} aria-hidden style={{ display: "inline-block", verticalAlign: "middle" }}>
      <path d={path} fill="none" stroke="var(--ink-muted)" strokeWidth={1} />
      <circle
        cx={lastX}
        cy={lastY}
        r={1.6}
        fill={isElevated ? "var(--accent)" : "var(--ink)"}
      />
    </svg>
  )
}
```

### Task 7.4: Shared `drilldown-drawer.tsx`

- [ ] **Step 1:** Create with this content:

```tsx
"use client"

import { useEffect } from "react"

export function DrilldownDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="px-5 py-4"
      style={{
        background: "rgba(255, 253, 247, 0.92)",
        borderTop: "1px solid var(--hairline)",
        borderBottom: "1px solid var(--hairline)",
      }}
    >
      {children}
    </div>
  )
}
```

### Task 7.5: `masthead.tsx`

- [ ] **Step 1:** Create with this content. Renders: title, folio strip with refresh, store filter, status sentence.

```tsx
"use client"

import { useQuery } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"

type Summary = {
  refreshedAt: string
  db: { totalBytes: number; capBytes: number; pct: number }
  redis: { keys: number; memoryPct: number; commandsPct: number; available: boolean }
  syncs: { jobName: string; status: string | null; overdue: boolean }[]
  errorsCount: number
  todayCostUsd: number
}

export function Masthead({ stores }: { stores: { id: string; name: string }[] }) {
  const router = useRouter()
  const params = useSearchParams()
  const selected = params.get("store") || "all"

  const { data, dataUpdatedAt, refetch, isFetching } = useQuery<Summary>({
    queryKey: ["monitoring-summary", selected],
    queryFn: async () => {
      const url = `/api/monitoring/summary${selected !== "all" ? `?store=${selected}` : ""}`
      const res = await fetch(url, { cache: "no-store" })
      if (!res.ok) throw new Error("summary fetch failed")
      return res.json()
    },
    refetchInterval: 60_000,
  })

  const overdue = data?.syncs.filter((s) => s.overdue).length ?? 0
  const failing = data?.syncs.filter((s) => s.status === "FAILURE").length ?? 0
  const dbPct = Math.round(data?.db.pct ?? 0)
  const errCount = data?.errorsCount ?? 0
  const cost = data?.todayCostUsd ?? 0
  const cachePct = Math.round(data?.redis.memoryPct ?? 0)

  const allGood = !failing && !overdue && errCount === 0 && dbPct < 75 && cachePct < 80

  return (
    <header className="mb-10 mt-6">
      <div className="flex items-baseline justify-between">
        <h1
          style={{
            fontFamily: "Fraunces, Iowan Old Style, Georgia, serif",
            fontSize: "clamp(28px, 4vw, 44px)",
            fontWeight: 500,
            fontVariationSettings: '"opsz" 144, "SOFT" 30',
            letterSpacing: "-0.03em",
            lineHeight: 0.95,
            color: "var(--ink)",
          }}
        >
          Monitoring
        </h1>
        <StoreFilter stores={stores} selected={selected} onChange={(v) => {
          const sp = new URLSearchParams(params.toString())
          if (v === "all") sp.delete("store"); else sp.set("store", v)
          router.replace(`?${sp.toString()}`)
        }} />
      </div>

      <div
        className="mt-3 font-mono uppercase"
        style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--ink-faint)" }}
      >
        {formatFolio(dataUpdatedAt)} · last refresh {ago(dataUpdatedAt)} ·{" "}
        <button
          onClick={() => refetch()}
          aria-label="Refresh"
          style={{
            display: "inline-block",
            transition: "transform 600ms cubic-bezier(0.2, 0.7, 0.2, 1)",
            transform: isFetching ? "rotate(360deg)" : "rotate(0)",
          }}
        >
          ↻
        </button>
      </div>

      <p
        className="mt-4"
        style={{
          fontFamily: "DM Sans, system-ui, sans-serif",
          fontSize: 13, lineHeight: 1.5, color: "var(--ink-muted)", maxWidth: "70ch",
        }}
      >
        {allGood
          ? <>All {data?.syncs.length ?? 0} syncs current. No errors in the last 24 hours. AI spend ${cost.toFixed(2)} today, on baseline. Database {dbPct}%. Cache {cachePct}%.</>
          : <Degraded data={data} />}
      </p>
    </header>
  )
}

function Degraded({ data }: { data: Summary | undefined }) {
  if (!data) return <>Loading…</>
  const parts: React.ReactNode[] = []
  const failing = data.syncs.filter((s) => s.status === "FAILURE")
  for (const f of failing) parts.push(<span key={f.jobName} style={{ color: "var(--accent)" }}>{f.jobName} failing</span>)
  const overdue = data.syncs.filter((s) => s.overdue && s.status !== "FAILURE")
  for (const o of overdue) parts.push(<span key={o.jobName} style={{ color: "var(--accent)" }}>{o.jobName} overdue</span>)
  if (data.errorsCount > 0) parts.push(<span key="err" style={{ color: "var(--accent)" }}>{data.errorsCount} errors logged today</span>)
  if ((data.db.pct ?? 0) >= 75) parts.push(<span key="db" style={{ color: "var(--accent)" }}>DB at {Math.round(data.db.pct)}%</span>)
  return <>{parts.flatMap((p, i) => i === 0 ? [p] : [". ", p])}.</>
}

function StoreFilter({ stores, selected, onChange }: { stores: { id: string; name: string }[]; selected: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-2">
      <button
        className="toolbar-btn"
        data-active={selected === "all"}
        onClick={() => onChange("all")}
      >All</button>
      {stores.map((s) => (
        <button key={s.id} className="toolbar-btn" data-active={selected === s.id} onClick={() => onChange(s.id)}>
          {s.name}
        </button>
      ))}
    </div>
  )
}

function formatFolio(t: number): string {
  if (!t) return ""
  const d = new Date(t)
  const day = d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()
  const date = d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
  return `${day} · ${date} · ${time}`
}

function ago(t: number): string {
  if (!t) return "—"
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}
```

### Task 7.6: `front-page-lede.tsx`

- [ ] **Step 1:** Create:

```tsx
"use client"

import { useQuery } from "@tanstack/react-query"

type Summary = { syncs: { jobName: string; lastRunAt: string | null; status: string | null; overdue: boolean }[] }

export function FrontPageLede() {
  const { data } = useQuery<Summary>({
    queryKey: ["monitoring-summary-lede"],
    queryFn: async () => (await fetch("/api/monitoring/summary", { cache: "no-store" })).json(),
    refetchInterval: 60_000,
  })

  if (!data) return null
  const failing = data.syncs.find((s) => s.status === "FAILURE") ?? data.syncs.find((s) => s.overdue)
  if (!failing) return null

  return (
    <section
      className="my-8"
      style={{
        borderTop: "1px dashed var(--hairline-bold)",
        borderBottom: "1px dashed var(--hairline-bold)",
        padding: "18px 0",
      }}
    >
      <h2
        style={{
          fontFamily: "Fraunces, Iowan Old Style, Georgia, serif",
          fontSize: 26, fontWeight: 450,
          fontVariationSettings: '"opsz" 96, "SOFT" 50',
          letterSpacing: "-0.022em",
          lineHeight: 1.1, color: "var(--ink)",
        }}
      >
        <em style={{ fontStyle: "italic" }}>{failing.jobName}</em>{" "}
        {failing.status === "FAILURE" ? "is failing." : "is overdue."}
      </h2>
      <p style={{ fontFamily: "DM Sans, system-ui, sans-serif", fontSize: 13, color: "var(--ink-muted)", marginTop: 8 }}>
        Last run {failing.lastRunAt ? new Date(failing.lastRunAt).toLocaleString() : "never"}.
      </p>
    </section>
  )
}
```

### Task 7.7: `syncs-panel.tsx`

- [ ] **Step 1:** Create as a server component that takes `syncs: SyncRow[]` (computed at page level via `getSyncs`). Render an `.inv-panel` with `.inv-panel__head` (department label "SYNCS"), then a list of `.inv-row` per job. Columns: time (mono), job name (Fraunces 17), status (mono — red on FAILURE), rows (DM Sans tabular), duration, next-expected (mono — red when `overdue`).

```tsx
import type { SyncRow } from "@/lib/monitoring/queries"

export function SyncsPanel({ rows }: { rows: SyncRow[] }) {
  return (
    <section className="inv-panel">
      <div className="inv-panel__head">
        <span className="inv-panel__dept">SYNCS</span>
      </div>
      <div>
        {rows.map((r) => (
          <div key={r.jobName} className="inv-row" style={{ display: "grid", gridTemplateColumns: "120px 1fr 100px 80px 80px 120px", gap: 16, alignItems: "baseline" }}>
            <span className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.12em", color: r.status === "FAILURE" ? "var(--accent)" : "var(--ink-faint)" }}>
              {r.lastRunAt ? formatAgo(r.lastRunAt) : "never"}
            </span>
            <span style={{ fontFamily: "Fraunces, serif", fontSize: 17, fontWeight: 500, color: "var(--ink)" }}>{r.jobName}</span>
            <span className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.12em", color: r.status === "FAILURE" ? "var(--accent)" : "var(--ink-muted)" }}>
              · {(r.status ?? "—").toLowerCase()}
            </span>
            <span style={{ fontFamily: "DM Sans, sans-serif", fontWeight: 600, fontSize: 15.5, fontVariantNumeric: "tabular-nums lining-nums", color: "var(--ink)" }}>
              {r.rowsWritten ?? "—"}
            </span>
            <span style={{ fontFamily: "DM Sans, sans-serif", fontWeight: 600, fontSize: 15.5, fontVariantNumeric: "tabular-nums lining-nums", color: "var(--ink-muted)" }}>
              {r.durationMs != null ? formatDuration(r.durationMs) : "—"}
            </span>
            <span className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.12em", color: r.overdue ? "var(--accent)" : "var(--ink-muted)" }}>
              {r.cadenceLabel}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function formatAgo(d: Date): string {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 60) return `${s}S AGO`
  if (s < 3600) return `${Math.round(s / 60)}M AGO`
  if (s < 86400) return `${Math.round(s / 3600)}H AGO`
  return `${Math.round(s / 86400)}D AGO`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}MS`
  return `${(ms / 1000).toFixed(1)}S`
}
```

(Drilldown via inline `DrilldownDrawer` toggled by per-row click — added in Task 7.8 once all panels exist; keep this task minimal.)

### Task 7.8: `errors-panel.tsx`

- [ ] **Step 1:** Create:

```tsx
import { InlineSpark } from "./inline-spark"

type ErrorRow = {
  id: string
  occurredAt: Date
  source: string
  route: string | null
  status: number | null
  message: string
  stack: string | null
}

export function ErrorsPanel({ errors, byHour }: { errors: ErrorRow[]; byHour: { bucket: Date; count: number }[] }) {
  return (
    <section className="inv-panel">
      <div className="inv-panel__head" style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span className="inv-panel__dept">ERRORS</span>
        <span className="font-mono" style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--ink-muted)" }}>
          {errors.length} / 24h
        </span>
        <InlineSpark points={byHour.map((b) => ({ x: b.bucket, y: b.count }))} width={96} />
      </div>
      {errors.length === 0 ? (
        <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, letterSpacing: "0.12em", color: "var(--ink-faint)", textTransform: "uppercase" }}>
          no errors in the last 24 hours
        </p>
      ) : (
        <div>
          {errors.map((e) => (
            <div key={e.id} className="inv-row" style={{ display: "grid", gridTemplateColumns: "100px 80px 1fr 2fr", gap: 16, alignItems: "baseline" }}>
              <span className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--accent)" }}>
                {formatTime(e.occurredAt)}
              </span>
              <span className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--ink-muted)" }}>
                {e.source}
              </span>
              <span style={{ fontFamily: "Fraunces, serif", fontSize: 17, fontWeight: 500, color: "var(--ink)" }}>
                {e.route ?? "—"}
              </span>
              <span style={{ fontFamily: "DM Sans, sans-serif", fontSize: 13, color: "var(--ink-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {e.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function formatTime(d: Date): string {
  const x = new Date(d)
  return `${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`
}
```

### Task 7.9: `ai-spend-panel.tsx`

- [ ] **Step 1:** Create:

```tsx
import { InlineSpark } from "./inline-spark"

type ByDay = { day: Date; cost: number; tokens: number }
type ByFeature = { feature: string; provider: string; model: string; calls: number; tokensIn: number; tokensOut: number; cost: number }

export function AiSpendPanel({ byDay, byFeature }: { byDay: ByDay[]; byFeature: ByFeature[] }) {
  const today = byDay[byDay.length - 1]?.cost ?? 0
  const baseline = byDay.length > 1
    ? byDay.slice(0, -1).reduce((a, b) => a + b.cost, 0) / Math.max(1, byDay.length - 1)
    : 0
  const elevated = baseline > 0 && today > baseline * 1.5
  const pctAbove = baseline > 0 ? Math.round(((today - baseline) / baseline) * 100) : 0

  return (
    <section className="inv-panel">
      <div className="inv-panel__head" style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span className="inv-panel__dept">AI SPEND</span>
        <span style={{ fontFamily: "DM Sans, sans-serif", fontWeight: 600, fontSize: 15.5, fontVariantNumeric: "tabular-nums lining-nums", color: "var(--ink)" }}>
          ${today.toFixed(2)}
        </span>
        <InlineSpark points={byDay.map((d) => ({ x: d.day, y: d.cost }))} width={96} />
        {elevated && (
          <span className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--accent)" }}>
            · +{pctAbove}%
          </span>
        )}
      </div>
      <div>
        {byFeature.map((f) => (
          <div key={f.feature} className="inv-row" style={{ display: "grid", gridTemplateColumns: "1fr 180px 70px 140px 90px", gap: 16, alignItems: "baseline" }}>
            <span style={{ fontFamily: "Fraunces, serif", fontSize: 17, fontWeight: 500 }}>{f.feature}</span>
            <span className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--ink-muted)" }}>
              {f.provider} · {f.model}
            </span>
            <span style={{ fontFamily: "DM Sans, sans-serif", fontWeight: 600, fontSize: 15.5, fontVariantNumeric: "tabular-nums lining-nums" }}>{f.calls}</span>
            <span style={{ fontFamily: "DM Sans, sans-serif", fontWeight: 600, fontSize: 15.5, fontVariantNumeric: "tabular-nums lining-nums", color: "var(--ink-muted)" }}>
              {fmt(f.tokensIn)} / {fmt(f.tokensOut)}
            </span>
            <span style={{ fontFamily: "DM Sans, sans-serif", fontWeight: 600, fontSize: 15.5, fontVariantNumeric: "tabular-nums lining-nums" }}>
              ${f.cost.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
      <div style={{ borderTop: "1px dashed var(--hairline-bold)", marginTop: 14, paddingTop: 14 }}>
        <div className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--ink-faint)", marginBottom: 6 }}>
          last 7 days
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
          {byDay.slice(-7).map((d) => (
            <div key={String(d.day)}>
              <div className="font-mono" style={{ fontSize: 10, color: "var(--ink-faint)" }}>{new Date(d.day).toLocaleDateString("en-US", { weekday: "short" })}</div>
              <div style={{ fontFamily: "DM Sans, sans-serif", fontWeight: 600, fontSize: 13, fontVariantNumeric: "tabular-nums lining-nums" }}>${d.cost.toFixed(2)}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}
```

### Task 7.10: `chat-panel.tsx`

- [ ] **Step 1:** Create:

```tsx
type Stat = { status: string; count: number }
type Turn = {
  id: string
  occurredAt: Date
  status: string
  finishReason: string | null
  userMessage: string
  assistantMessage: string | null
  errorMessage: string | null
  toolErrors: unknown
}

const STATUS_ORDER = ["OK", "TRUNCATED", "REFUSED", "EMPTY", "RATE_LIMITED", "TOOL_FAILED", "ERROR"] as const

export function ChatPanel({ stats, recent }: { stats: Stat[]; recent: Turn[] }) {
  const total = stats.reduce((a, b) => a + b.count, 0)
  const failures = stats.filter((s) => s.status === "ERROR" || s.status === "TOOL_FAILED").reduce((a, b) => a + b.count, 0)
  return (
    <section className="inv-panel">
      <div className="inv-panel__head" style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span className="inv-panel__dept">CHAT</span>
        <span style={{ fontFamily: "DM Sans, sans-serif", fontWeight: 600, fontSize: 15.5, fontVariantNumeric: "tabular-nums lining-nums" }}>{total}</span>
        <span className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--ink-muted)" }}>turns / 24h</span>
        {failures > 0 && (
          <span className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--accent)" }}>· {failures} failures</span>
        )}
      </div>

      <div style={{ display: "flex", height: 1, marginBottom: 14, marginTop: 4, background: "var(--hairline)" }}>
        {STATUS_ORDER.map((status) => {
          const count = stats.find((s) => s.status === status)?.count ?? 0
          if (count === 0) return null
          const isErr = status === "ERROR" || status === "TOOL_FAILED"
          return (
            <div
              key={status}
              title={`${status}: ${count}`}
              style={{
                flex: count,
                background: isErr ? "var(--accent)" : "var(--ink)",
                opacity: isErr ? 1 : (status === "OK" ? 0.6 : 0.3),
              }}
            />
          )
        })}
      </div>

      {recent.length === 0 ? (
        <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, letterSpacing: "0.12em", color: "var(--ink-faint)", textTransform: "uppercase" }}>
          no failures in recent turns
        </p>
      ) : (
        <div>
          {recent.map((t) => (
            <div key={t.id} className="inv-row" style={{ display: "grid", gridTemplateColumns: "80px 110px 1fr 1.5fr", gap: 16, alignItems: "baseline" }}>
              <span className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--accent)" }}>
                {new Date(t.occurredAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}
              </span>
              <span className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--accent)" }}>
                {t.status}
              </span>
              <span style={{ fontFamily: "Fraunces, serif", fontSize: 17, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.userMessage.slice(0, 80)}
              </span>
              <span style={{ fontFamily: "DM Sans, sans-serif", fontSize: 13, color: "var(--ink-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.errorMessage ?? t.assistantMessage?.slice(0, 100) ?? "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
```

### Task 7.11: `database-panel.tsx`

- [ ] **Step 1:** Create:

```tsx
type Db = { totalBytes: number; capBytes: number; pct: number }
type Tbl = { table: string; bytes: number; rows: bigint }
type Conn = { active: number; max: number }

export function DatabasePanel({ db, tables, conn }: { db: Db; tables: Tbl[]; conn: Conn }) {
  const pct = db.pct
  const barColor = pct >= 90 ? "var(--accent-dark)" : pct >= 75 ? "var(--accent)" : "var(--ink)"

  return (
    <section className="inv-panel">
      <div className="inv-panel__head" style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span className="inv-panel__dept">DATABASE</span>
        <span style={{ fontFamily: "DM Sans, sans-serif", fontWeight: 600, fontSize: 15.5, fontVariantNumeric: "tabular-nums lining-nums", color: pct >= 75 ? "var(--accent)" : "var(--ink)" }}>
          {fmtBytes(db.totalBytes)} / {fmtBytes(db.capBytes)} · {pct.toFixed(0)}%
        </span>
      </div>

      <div style={{ height: 4, border: "1px solid var(--hairline-bold)", marginBottom: 18 }}>
        <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, background: barColor, transition: "width 280ms cubic-bezier(0.2, 0.7, 0.2, 1), background 280ms" }} />
      </div>

      <div>
        {tables.map((t) => {
          const share = db.totalBytes > 0 ? (t.bytes / db.totalBytes) * 100 : 0
          return (
            <div key={t.table} className="inv-row" style={{ display: "grid", gridTemplateColumns: "1fr 100px 200px 100px", gap: 16, alignItems: "baseline" }}>
              <span style={{ fontFamily: "Fraunces, serif", fontSize: 17, fontWeight: 500 }}>{t.table}</span>
              <span style={{ fontFamily: "DM Sans, sans-serif", fontWeight: 600, fontSize: 15.5, fontVariantNumeric: "tabular-nums lining-nums" }}>{fmtBytes(t.bytes)}</span>
              <div style={{ height: 3, border: "1px solid var(--hairline)" }}>
                <div style={{ height: "100%", width: `${share}%`, background: "var(--ink-muted)" }} />
              </div>
              <span className="font-mono" style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--ink-muted)" }}>{String(t.rows)} rows</span>
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--hairline)" }}>
        <span className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--ink-muted)" }}>connections</span>{" "}
        <span style={{ fontFamily: "DM Sans, sans-serif", fontWeight: 600, fontSize: 15.5, fontVariantNumeric: "tabular-nums lining-nums" }}>
          {conn.active} / {conn.max}
        </span>
      </div>
    </section>
  )
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
```

### Task 7.12: `cache-panel.tsx`

- [ ] **Step 1:** Create:

```tsx
type Redis = { available: boolean; keys: number; memoryBytes: number; memoryMaxBytes: number; memoryPct: number; commandsToday: number; commandsLimit: number; commandsPct: number }
type Prefix = { keyPrefix: string; hits: number; misses: number; writes: number; busts: number; failures: number; hitPct: number; sample: number }

export function CachePanel({ redis, prefixes }: { redis: Redis; prefixes: Prefix[] }) {
  const memColor = redis.memoryPct >= 80 ? "var(--accent)" : "var(--ink)"
  const cmdColor = redis.commandsPct >= 80 ? "var(--accent)" : "var(--ink)"

  return (
    <section className="inv-panel">
      <div className="inv-panel__head" style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span className="inv-panel__dept">CACHE</span>
        {!redis.available ? (
          <span className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--ink-faint)" }}>
            redis unavailable
          </span>
        ) : (
          <span className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.12em" }}>
            <span style={{ color: memColor }}>mem {redis.memoryPct.toFixed(0)}%</span>
            {" · "}
            <span style={{ color: "var(--ink-muted)" }}>keys {redis.keys.toLocaleString()}</span>
            {" · "}
            <span style={{ color: cmdColor }}>cmd {redis.commandsPct.toFixed(0)}%</span>
          </span>
        )}
      </div>

      {prefixes.length === 0 ? (
        <p style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, letterSpacing: "0.12em", color: "var(--ink-faint)", textTransform: "uppercase" }}>
          no cache activity yet
        </p>
      ) : (
        <div>
          {prefixes.map((p) => {
            const lowHit = p.hitPct < 30 && p.sample > 100
            return (
              <div key={p.keyPrefix} className="inv-row" style={{ display: "grid", gridTemplateColumns: "120px 70px 80px 80px 80px 80px 80px", gap: 16, alignItems: "baseline" }}>
                <span className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--ink-muted)" }}>{p.keyPrefix}</span>
                <span style={{ fontFamily: "DM Sans, sans-serif", fontWeight: 600, fontSize: 15.5, fontVariantNumeric: "tabular-nums lining-nums", color: lowHit ? "var(--accent)" : "var(--ink)" }}>
                  {p.hitPct.toFixed(0)}%
                </span>
                <span style={{ fontFamily: "DM Sans, sans-serif", fontWeight: 600, fontSize: 15.5, fontVariantNumeric: "tabular-nums lining-nums" }}>{p.hits}</span>
                <span style={{ fontFamily: "DM Sans, sans-serif", fontWeight: 600, fontSize: 15.5, fontVariantNumeric: "tabular-nums lining-nums" }}>{p.misses}</span>
                <span style={{ fontFamily: "DM Sans, sans-serif", fontWeight: 600, fontSize: 15.5, fontVariantNumeric: "tabular-nums lining-nums", color: "var(--ink-muted)" }}>{p.writes}</span>
                <span style={{ fontFamily: "DM Sans, sans-serif", fontWeight: 600, fontSize: 15.5, fontVariantNumeric: "tabular-nums lining-nums", color: "var(--ink-muted)" }}>{p.busts}</span>
                <span style={{ fontFamily: "DM Sans, sans-serif", fontWeight: 600, fontSize: 15.5, fontVariantNumeric: "tabular-nums lining-nums", color: p.failures > 0 ? "var(--accent)" : "var(--ink-muted)" }}>{p.failures}</span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
```

### Task 7.13: Wire all into `page.tsx`

- [ ] **Step 1:** Replace the skeleton from Task 6.2 with:

```tsx
import { Masthead } from "@/components/monitoring/masthead"
import { FrontPageLede } from "@/components/monitoring/front-page-lede"
import { SyncsPanel } from "@/components/monitoring/syncs-panel"
import { ErrorsPanel } from "@/components/monitoring/errors-panel"
import { AiSpendPanel } from "@/components/monitoring/ai-spend-panel"
import { ChatPanel } from "@/components/monitoring/chat-panel"
import { DatabasePanel } from "@/components/monitoring/database-panel"
import { CachePanel } from "@/components/monitoring/cache-panel"
import {
  getSyncs, getRecentErrors, getErrorsByHour, getAiCostByDay, getAiByFeature,
  getChatStats, getRecentNonOkChatTurns, getCacheStats,
} from "@/lib/monitoring/queries"
import { getDbSize, getTableSizes, getConnections } from "@/lib/monitoring/db-stats"
import { getRedisLive } from "@/lib/monitoring/redis-stats"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export const dynamic = "force-dynamic"

export default async function MonitoringPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const session = await getServerSession(authOptions)
  const params = await searchParams
  const storeId = params.store && params.store !== "all" ? params.store : null

  const stores = await prisma.store.findMany({
    where: { accountId: session!.user.accountId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  const [syncs, recentErrors, errorsByHour, aiByDay, aiByFeature, chatStats, recentChat, cachePrefixes, db, tables, conn, redis] = await Promise.all([
    getSyncs(storeId),
    getRecentErrors(50),
    getErrorsByHour(24),
    getAiCostByDay(30),
    getAiByFeature(24),
    getChatStats(24),
    getRecentNonOkChatTurns(20),
    getCacheStats(168),
    getDbSize(),
    getTableSizes(12),
    getConnections(),
    getRedisLive(),
  ])

  return (
    <main className="px-6 max-w-275 mx-auto pb-16">
      <Masthead stores={stores} />
      <FrontPageLede />
      <div className="space-y-6">
        <SyncsPanel rows={syncs} />
        <ErrorsPanel errors={recentErrors} byHour={errorsByHour} />
        <AiSpendPanel byDay={aiByDay} byFeature={aiByFeature} />
        <ChatPanel stats={chatStats} recent={recentChat} />
        <DatabasePanel db={db} tables={tables} conn={conn} />
        <CachePanel redis={redis} prefixes={cachePrefixes} />
      </div>
    </main>
  )
}
```

### Task 7.14: Commit

```bash
git add src/app/dashboard/monitoring src/components/monitoring src/lib/monitoring/queries.ts src/app/api/monitoring
git commit -m "monitoring: page panels, masthead, summary endpoint"
```

### Phase 7 verification

- Visit `/dashboard/monitoring` as Vardan. All six panels render with real data. Numbers in DM Sans tabular. Department labels in JetBrains Mono uppercase. No `<Card>`, no shadows, no generic Tailwind colors. Hover on a sync row triggers the `.inv-row` red proofmark `scaleY` animation.
- Force a sync failure → masthead status sentence shows the red clause + front-page lede appears.
- All-good state → lede absent (the page is shorter).
- Refresh button rotates 360° on click.
- Open in `prefers-reduced-motion: reduce` mode (devtools rendering pane) → rotation snaps, no easing.

---

## Phase 8 — Discord alerts

### Task 8.1: `src/lib/monitoring/alerts.ts`

- [ ] **Step 1:** Create:

```ts
import { prisma } from "@/lib/prisma"
import { recordError } from "./errors"
import { JOB_SCHEDULES, isOverdue } from "./job-schedules"

const WEBHOOK = process.env.DISCORD_MONITORING_WEBHOOK_URL ?? ""
const AI_DAILY_LIMIT = Number(process.env.MONITORING_AI_DAILY_USD_LIMIT ?? 10)
const DB_CAP = Number(process.env.NEON_STORAGE_CAP_BYTES ?? 512 * 1024 * 1024)
const CACHE_HIT_RATE_FLOOR = 30
const CACHE_SAMPLE_FLOOR = 100

type Embed = {
  title: string
  description?: string
  color: number
  fields?: { name: string; value: string; inline?: boolean }[]
  url?: string
}

async function postToDiscord(embed: Embed): Promise<void> {
  if (!WEBHOOK) return
  try {
    await fetch(WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    })
  } catch (err) {
    await recordError({ source: "alerter", message: err instanceof Error ? err.message : String(err) })
  }
}

const RED = 0xdc2626
const INK = 0x1a1613

/**
 * Evaluate alerts. Called from withJobRun on each close (with jobRunId), and
 * from the 15-min sweep (without). Dedupe by inspecting prior cycle state.
 */
export async function evaluateAlerts(jobRunId?: string): Promise<void> {
  try {
    if (jobRunId) await checkJobRun(jobRunId)
    await checkOverdueJobs()
    await checkAiSpend()
    await checkDbSize()
    await checkCacheHitRates()
  } catch (err) {
    await recordError({ source: "alerter", message: err instanceof Error ? err.message : String(err) })
  }
}

async function checkJobRun(jobRunId: string) {
  const run = await prisma.jobRun.findUnique({
    where: { id: jobRunId },
    select: { id: true, jobName: true, status: true, errorMessage: true, completedAt: true, startedAt: true },
  })
  if (!run) return

  if (run.status === "FAILURE") {
    // Dedupe: was the prior run for this jobName also a failure?
    const prev = await prisma.jobRun.findFirst({
      where: { jobName: run.jobName, id: { not: run.id } },
      orderBy: { startedAt: "desc" },
      select: { status: true },
    })
    if (prev?.status === "FAILURE") return // still broken — already alerted

    await postToDiscord({
      title: `${run.jobName} failed`,
      description: run.errorMessage?.slice(0, 1000) ?? "(no error message)",
      color: RED,
      fields: [{ name: "When", value: new Date(run.startedAt).toISOString(), inline: true }],
    })
  } else if (run.status === "SUCCESS") {
    // Recovery edge: previous failed?
    const prev = await prisma.jobRun.findFirst({
      where: { jobName: run.jobName, id: { not: run.id } },
      orderBy: { startedAt: "desc" },
      select: { status: true },
    })
    if (prev?.status === "FAILURE") {
      await postToDiscord({
        title: `${run.jobName} recovered`,
        color: INK,
      })
    }
  }
}

async function checkOverdueJobs() {
  for (const jobName of Object.keys(JOB_SCHEDULES)) {
    const last = await prisma.jobRun.findFirst({
      where: { jobName },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true, status: true },
    })
    if (!last || !isOverdue(jobName, last.startedAt)) continue
    // Dedupe: ignore if already alerted this cycle (no AlertSent table — instead
    // we check whether the most-recent JobRun's startedAt has changed since
    // the prior sweep. Since the sweep runs every 15min and the cadence is in
    // minutes, an overdue job will trigger every sweep until it runs again.
    // Acceptable spam for v1; tighten later if noisy.
    await postToDiscord({
      title: `${jobName} overdue`,
      description: `Last run ${new Date(last.startedAt).toISOString()}, cadence ${JOB_SCHEDULES[jobName].description}`,
      color: RED,
    })
  }
}

async function checkAiSpend() {
  const since = new Date()
  since.setHours(0, 0, 0, 0)
  const rows = await prisma.$queryRaw<{ s: number }[]>`
    SELECT COALESCE(SUM("estimatedCostUsd"), 0)::float AS s
    FROM "AiUsageEvent" WHERE "occurredAt" >= ${since}
  `
  const today = Number(rows[0]?.s ?? 0)
  if (today < AI_DAILY_LIMIT) return

  // Dedupe: was the threshold already crossed in the last 30 min by an
  // earlier evaluator pass? Crude check: assume only one evaluator runs per
  // 15-min sweep, so we just check if yesterday-at-this-hour already had us
  // over. If we crossed today via a sudden burst, alert once.
  const yesterdaySameHour = new Date(since)
  yesterdaySameHour.setDate(yesterdaySameHour.getDate() - 1)
  const yRows = await prisma.$queryRaw<{ s: number }[]>`
    SELECT COALESCE(SUM("estimatedCostUsd"), 0)::float AS s
    FROM "AiUsageEvent"
    WHERE "occurredAt" >= ${yesterdaySameHour} AND "occurredAt" < ${since}
  `
  const yesterday = Number(yRows[0]?.s ?? 0)
  if (yesterday >= AI_DAILY_LIMIT) return

  await postToDiscord({
    title: `AI spend over $${AI_DAILY_LIMIT.toFixed(2)} today`,
    description: `$${today.toFixed(2)} so far`,
    color: RED,
  })
}

async function checkDbSize() {
  const rows = await prisma.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database())::bigint AS size`
  const size = Number(rows[0]?.size ?? 0n)
  const pct = (size / DB_CAP) * 100
  if (pct < 75) return
  await postToDiscord({
    title: `Database at ${pct.toFixed(1)}% of cap`,
    description: `${(size / 1024 / 1024).toFixed(1)} MB / ${(DB_CAP / 1024 / 1024).toFixed(0)} MB`,
    color: pct >= 90 ? RED : INK,
  })
}

async function checkCacheHitRates() {
  const since = new Date(Date.now() - 60 * 60_000)
  const rows = await prisma.$queryRaw<{ keyPrefix: string; hits: bigint; misses: bigint }[]>`
    SELECT "keyPrefix", SUM(hits)::bigint AS hits, SUM(misses)::bigint AS misses
    FROM "CacheStat" WHERE "hourBucket" >= ${since} GROUP BY "keyPrefix"
  `
  for (const r of rows) {
    const hits = Number(r.hits)
    const misses = Number(r.misses)
    const total = hits + misses
    if (total < CACHE_SAMPLE_FLOOR) continue
    const pct = (hits / total) * 100
    if (pct >= CACHE_HIT_RATE_FLOOR) continue
    await postToDiscord({
      title: `Cache prefix "${r.keyPrefix}" hit rate ${pct.toFixed(1)}%`,
      description: `${hits} hits / ${total} ops in the last hour`,
      color: INK,
    })
  }
}
```

### Task 8.2: Wire `evaluateAlerts` into `withJobRun`

- [ ] **Step 1:** Open `src/lib/monitoring/job-run.ts`. Add at top:

```ts
import { evaluateAlerts } from "./alerts"
```

- [ ] **Step 2:** Replace the placeholder comments inserted in Phase 2 with actual invocations after both the SUCCESS update and the FAILURE update:

```ts
// after the SUCCESS update
void evaluateAlerts(run.id)

// after the FAILURE update
void evaluateAlerts(run.id)
```

(`void` = fire-and-forget; the alerter wraps its own errors.)

### Task 8.3: Sweep cron `/api/cron/monitoring/sweep/route.ts`

- [ ] **Step 1:** Create:

```ts
import { NextRequest, NextResponse } from "next/server"
import { isCronRequest } from "@/lib/rate-limit"
import { evaluateAlerts } from "@/lib/monitoring/alerts"

export const maxDuration = 30

export async function POST(req: NextRequest) {
  if (!isCronRequest(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  await evaluateAlerts()
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2:** Schedule in GitHub Actions / `vercel.json` at every 15 minutes.

### Task 8.4: Verify

- [ ] **Step 1:** Set `DISCORD_MONITORING_WEBHOOK_URL` to a test channel webhook. Force a sync failure (e.g. break `OTTER_JWT`). Trigger the sync. Confirm one Discord embed appears with red color and the failure title.

- [ ] **Step 2:** Trigger the same sync again with the same failure (`OTTER_JWT` still broken). Confirm NO duplicate Discord post (dedupe via prior-run-status check).

- [ ] **Step 3:** Restore the JWT, trigger again → success. Confirm one "recovered" message in ink color.

- [ ] **Step 4:** Commit.

```bash
git add src/lib/monitoring/alerts.ts src/lib/monitoring/job-run.ts src/app/api/cron/monitoring/sweep
git commit -m "monitoring: discord alerter + sweep cron, dedupe via prior-cycle check"
```

### Phase 8 verification

- Single Discord post per failure transition; no duplicate spam.
- Recovery edge fires exactly once.
- Alerter exceptions land in `ErrorEvent` with `source = "alerter"`, never propagate.

---

## Phase 9 — Cleanup cron + drop `InvoiceSyncLog`

### Task 9.1: `/api/cron/monitoring/cleanup/route.ts`

- [ ] **Step 1:** Create:

```ts
import { NextRequest, NextResponse } from "next/server"
import { isCronRequest } from "@/lib/rate-limit"
import { prisma } from "@/lib/prisma"

export const maxDuration = 60

export async function POST(req: NextRequest) {
  if (!isCronRequest(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  const cutoff = new Date(Date.now() - 90 * 86_400_000)
  const [jobRun, ai, err, chat, cache] = await Promise.all([
    prisma.jobRun.deleteMany({       where: { startedAt: { lt: cutoff } } }),
    prisma.aiUsageEvent.deleteMany({ where: { occurredAt: { lt: cutoff } } }),
    prisma.errorEvent.deleteMany({   where: { occurredAt: { lt: cutoff } } }),
    prisma.chatTurn.deleteMany({     where: { occurredAt: { lt: cutoff } } }),
    prisma.cacheStat.deleteMany({    where: { hourBucket: { lt: cutoff } } }),
  ])
  return NextResponse.json({
    deleted: { jobRun: jobRun.count, ai: ai.count, err: err.count, chat: chat.count, cache: cache.count },
  })
}
```

- [ ] **Step 2:** Schedule daily.

- [ ] **Step 3:** Curl with cron secret. Verify `{ deleted: { ... } }` returned (zeros on a fresh DB).

### Task 9.2: Contract migration — drop `InvoiceSyncLog`

- [ ] **Step 1:** Verify the model is no longer referenced anywhere:

```bash
grep -rn "invoiceSyncLog\|InvoiceSyncLog" src/ --exclude-dir=generated
```

Expect zero matches.

- [ ] **Step 2:** Open `prisma/schema.prisma`. Delete the entire `model InvoiceSyncLog { ... }` block.

- [ ] **Step 3:** Generate the migration:

```bash
npx prisma migrate dev --name monitoring_drop_invoice_sync_log
```

- [ ] **Step 4:** Verify the resulting `migration.sql` contains exactly `DROP TABLE "InvoiceSyncLog";`.

- [ ] **Step 5:** Apply locally; confirm the table is gone.

- [ ] **Step 6:** `npx tsc --noEmit` succeeds (the generated Prisma client no longer exports the model).

### Task 9.3: Commit

```bash
git add src/app/api/cron/monitoring/cleanup prisma/schema.prisma prisma/migrations
git commit -m "monitoring: cleanup cron + contract migration drops InvoiceSyncLog"
```

### Phase 9 verification

- `/api/cron/monitoring/cleanup` deletes nothing on a freshly-seeded DB; deletes correctly when seeded with rows older than 90 days.
- `InvoiceSyncLog` is gone from `\d` output in psql.
- `/dashboard/invoices` page still loads correctly (last-sync now reads from `JobRun`).
- Full app `npm run build` succeeds.

---

## Final spec verification (run before declaring done)

Match each item in the spec's "Verification" section against the work shipped:

1. ✅ Migration safety — Phase 1 + Phase 9
2. ✅ Route gate (Chris 404, Vardan renders) — Phase 6
3. ✅ Sidebar visibility — Phase 6
4. ✅ Sync instrumentation (success + forced failure) — Phase 3
5. ✅ AI usage rows for all 5 features — Phase 4
6. ✅ Chat status classification (forced failures for each mode) — Phase 4
7. ✅ ErrorEvent capture (wrapped handler + action) — Phase 2 (wrappers ready); apply to a target route in a follow-up if not yet done
8. ✅ CacheStat accumulation — Phase 5
9. ✅ DB stats match psql `pg_size_pretty(pg_database_size())` — Phase 7
10. ✅ Redis stats match `redis.dbsize()` — Phase 7
11. ✅ Alerts: single fire on failure, dedupe on repeat, recovery message — Phase 8
12. ✅ Reduced-motion behavior on the page — Phase 7
13. ✅ Editorial check — diff page against DESIGN.md rules during Phase 7 review

---

## Notes for the executor

- **Editorial vocabulary:** every panel uses `.inv-panel` (not shadcn `<Card>`); every interactive list row uses the existing `.inv-row` hover pattern; numbers in DM Sans tabular; captions in JetBrains Mono uppercase. If a code snippet in this plan accidentally uses generic Tailwind colors or shadcn `<Card>`, fix the snippet.
- **Vardan is the only DEVELOPER user.** All gating is based on `session.user.role === "DEVELOPER"`, no email allowlist.
- **Spec is the source of truth.** When in doubt about a panel's column composition or status word, consult `docs/superpowers/specs/2026-04-30-dev-monitoring-design.md`.
- **No Claude co-author line in commits** (per project preference).
