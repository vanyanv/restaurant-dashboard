# Dev Monitoring — control-room page for Vardan

**Date:** 2026-04-30
**Scope:** New `/dashboard/monitoring` route, dev-only. New Prisma models. Instrumentation wrappers across existing syncs and AI call sites. Discord webhook alerter.
**Status:** Approved design

---

## Goal

Vardan (the dev / codebase owner) needs one page that surfaces every operational concern of the dashboard: sync-job health, error log, AI spend, chat health, DB storage, Upstash cache stats. The dashboard is single-store today and headed to three stores; everything must scale to per-store slicing without restructuring. The page must be calm at rest and visibly red when something has actually failed — same editorial vocabulary as the rest of `/dashboard/*`, not a SaaS dashboard reskin.

Chris (the OWNER) does not see this page. Vardan gets a new `DEVELOPER` role and a sidebar entry rendered only for him.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Add a `DEVELOPER` value to Prisma `Role` enum; gate the route at layout level with `notFound()` (not `redirect()`). | Email allowlists drift; a role plays cleanly with the existing OWNER pattern. `notFound()` keeps the route from leaking to non-devs. |
| 2 | One central `JobRun` table replaces `InvoiceSyncLog` and is written by every sync via a `withJobRun()` wrapper. | One queryable shape. New integrations (Harri, R365) plug in by calling the wrapper. |
| 3 | One `AiUsageEvent` table written by a `recordAiUsage()` helper called after every OpenAI / Gemini response, including the three call sites that currently drop their token counts. | A single query answers "what's my AI spend this month" across all features. |
| 4 | One `ErrorEvent` table for non-sync errors, written by `withApiHandler` / `withServerAction` wrappers + `instrumentation.ts` backstop for unhandled rejections. | Captures `/api/chat` 500s, server-action throws, etc. — the things `console.error` swallows today. |
| 5 | `ChatTurn` table stores user message + assistant reply (each truncated to 4KB), plus `status` / `finishReason` / `errorMessage` / `toolErrors` for failure-mode classification. No embeddings in v1. | Lets us see what's being asked, debug bad responses, and detect failure modes. Embeddings can be added later with one `ALTER TABLE`. |
| 6 | One `CacheStat` table aggregates Upstash hits / misses / writes / busts / failures by `(hourBucket, keyPrefix)`. Live memory / key-count / commands queried directly from Upstash on page load. | Per-event logging would explode (caches do thousands of ops per request). Hourly aggregation is ~36KB/day. |
| 7 | 90-day retention across all five new tables; one nightly `/api/cron/monitoring/cleanup` deletes older rows. | Bounds storage. Monitoring tables stay under ~25MB peak combined. |
| 8 | Alerts post to a Discord webhook via `DISCORD_MONITORING_WEBHOOK_URL`. Rules hardcoded in `src/lib/monitoring/alerts.ts`. Dedupe by checking the previous cycle's state — no `AlertSent` table. | YAGNI: zero alert config UI, zero new tables for v1. The dedupe logic is a one-row lookup. |
| 9 | Page is single-column; six `.inv-panel` departments stacked under a masthead. No tile row, no status badges. | Editorial system mandate; control-room calm. Status lives in the masthead sentence + per-row folio recolor. |
| 10 | Failure surfacing uses a "front-page lede" block that exists only when something is broken. When everything is fine, the block is absent — page literally shrinks. | Visual silence is the OK signal. Earn-the-red rule applied to a whole page zone. |

## Storage budget (3 stores, 90-day window)

| Table | Daily writes | Bytes/row | 90-day peak |
|---|---|---|---|
| `JobRun` | ~30 | ~500B | ~1.4MB |
| `AiUsageEvent` | ~150 | ~200B | ~3MB |
| `ErrorEvent` | <10 nominal | ~400B | <500KB |
| `ChatTurn` | ~100 turns | ~1.2KB | ~11MB |
| `CacheStat` | ~240 (10 prefixes × 24h) | ~150B | ~3MB |
| **Total** | | | **~19MB** |

Negligible relative to the existing `OtterOrder` curve (~700MB/year at 3 stores), which is the actual storage gating factor.

## Schema

```prisma
enum Role {
  OWNER
  DEVELOPER  // NEW
}

enum JobStatus { RUNNING SUCCESS FAILURE PARTIAL }

model JobRun {
  id           String    @id @default(cuid())
  jobName      String                          // "otter.metrics.sync", "invoices.email.sync", ...
  storeId      String?
  triggeredBy  String                          // "cron" | "manual" | "webhook" | "github-actions"
  startedAt    DateTime  @default(now())
  completedAt  DateTime?
  durationMs   Int?
  status       JobStatus @default(RUNNING)
  rowsWritten  Int?
  metadata     Json?                           // tiny structured extras: { dateRange, emailsScanned, ... }
  errorMessage String?
  errorStack   String?
  store        Store?    @relation(fields: [storeId], references: [id])

  @@index([jobName, startedAt(sort: Desc)])
  @@index([status, startedAt(sort: Desc)])
}

model AiUsageEvent {
  id               String   @id @default(cuid())
  occurredAt       DateTime @default(now())
  feature          String   // "chat" | "pnl-insights" | "invoice-ocr" | "usage-demand" | "usage-weekly" | "usage-insights"
  provider         String   // "openai" | "google"
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
  source     String   // "api" | "server-action" | "cron" | "client" | "alerter" | "cache"
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
  userMessage      String   @db.Text     // truncated to 4KB on write
  assistantMessage String?  @db.Text     // truncated to 4KB on write
  toolsUsed        String[]
  aiUsageEventId   String?
  status           String   @default("OK")  // OK | ERROR | REFUSED | EMPTY | TRUNCATED | TOOL_FAILED | RATE_LIMITED
  finishReason     String?
  errorMessage     String?
  toolErrors       Json?
  feedback         String?  // null | "up" | "down" — column reserved, no UI in v1

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

`InvoiceSyncLog` is dropped in the same migration. The invoice email sync writes equivalent fields into `JobRun.metadata` (`emailsScanned`, `invoicesCreated`, `triggeredBy`).

## Instrumentation

### `withJobRun(jobName, opts, fn)` — every sync

```ts
// src/lib/monitoring/job-run.ts
export async function withJobRun<T>(
  jobName: string,
  opts: { storeId?: string; triggeredBy: string; metadata?: Record<string, unknown> },
  fn: (ctx: { jobRunId: string; addRows: (n: number) => void }) => Promise<T>,
): Promise<T>
```

Writes a `RUNNING` row at start; updates to `SUCCESS` or `FAILURE` at finish with duration + rows + error. Fires `evaluateAlerts(jobRunId)` on close.

Call sites (one wrap per file):
- `src/app/api/otter/sync/route.ts`
- `src/lib/otter-orders-sync.ts`
- `src/lib/hourly-sync.ts`
- `src/app/api/invoices/sync/route.ts` *(replaces existing `InvoiceSyncLog` writes)*
- `src/app/api/yelp/sync/route.ts`
- `src/app/api/cron/cogs/sweep/route.ts`
- `src/app/api/cron/cogs/stores/route.ts`

### `recordAiUsage(event)` — every AI response

```ts
// src/lib/monitoring/ai-usage.ts
const PRICING_PER_MTOK = {
  "gpt-4.1-mini":     { in: 0.40, cachedIn: 0.10, out: 1.60 },
  "gpt-4o-mini":      { in: 0.15, cachedIn: 0.075, out: 0.60 },
  "gemini-2.5-flash": { in: 0.30, cachedIn: 0.075, out: 2.50 },
} as const

export async function recordAiUsage(e: AiUsageInput): Promise<string>  // returns event id
```

Pricing-table miss → log warning, write row with `estimatedCostUsd = 0`. Never throws.

Call sites (one line after each API response):
- `src/app/api/chat/route.ts` *(also creates the `ChatTurn` row, FK'd via `aiUsageEventId`)*
- `src/lib/openai-insights.ts`
- `src/lib/gemini-invoice.ts` *(currently drops `usageMetadata` — backfill)*
- 3 calls in `src/app/actions/product-usage-actions.ts` *(currently drop counts — backfill)*

### Error capture

- `withApiHandler(handler)` and `withServerAction(action)` wrappers in `src/lib/monitoring/errors.ts`. Catch → write `ErrorEvent` → re-throw.
- `instrumentation.ts` `register()` hook attaches `onUncaughtException` / `onUnhandledRejection` as a Node-side backstop.
- Client-side errors are out of scope for v1 (Sentry-shaped problem).

### Cache instrumentation

`src/lib/cache/cached.ts` and `bustTags()` bump in-process counters per `keyPrefix`. A flusher (every Nth call OR a 10-min `/api/cron/monitoring/cache-flush` endpoint, whichever comes first) upserts into `CacheStat` with the `(hourBucket, keyPrefix)` unique key. Cache read/write failures additionally write an `ErrorEvent` with `source = "cache"`.

## The page

Route: **`/dashboard/monitoring`**. Server component for the shell + historicals; small client islands for the live tiles + inline drilldowns.

### Page craft (Late-Edition Ledger applied)

**Scene sentence:** Vardan glances at this page once before bed. The page is silent and proud when everything is in order — like a finished broadsheet ready for press. When something has actually broken, exactly one thing on the page is allowed to scream red.

### Composition

Single column, three zones:

1. **Masthead** — Fraunces display title `Monitoring` (`opsz 144, SOFT 30`); JetBrains Mono folio strip beneath: `MON · 30 APR 2026 · 00:42 PT · sha 6dc112e · last refresh 23s ago · ↻`. To the right: a `.toolbar-btn` segmented store filter (`All · Chris Neddy's`), persisted in the URL (`?store=...`). Below the folio: one editorial status sentence in DM Sans body, `var(--ink-muted)` at rest, only the failing clause turning `var(--accent)`.
   - All-good: *"All five syncs current. No errors in the last 4 hours. AI spend $2.40 today, on baseline. Database 17%. Cache 67% hit."*
   - Degraded: *"otter.orders.sync overdue 2 hours. 3 errors logged today. AI spend +43% over 7-day baseline."*

2. **Front-page lede (conditional)** — present only when one or more concerns are in `FAILURE`. Separated from the masthead by `.perforation`. Headline-Fraunces sentence naming the most severe failure, one body sentence with last-success time + next-attempt time, an inline click-target opening the relevant panel's drilldown. **When everything is fine, this zone is absent — not a green badge, not "All systems operational." Absent.**

3. **Six `.inv-panel` departments stacked**, each headed by a JetBrains Mono `.inv-panel__dept` label. No icons next to labels.

### Status language without warning colors

The system gives one accent. Three-tier "OK / degrading / failed" is encoded in shape and word, not color:

- **OK at rest** → no marker, no checkmark, no badge. Number sits in `var(--ink)`.
- **Degrading** → mono suffix in `var(--ink-muted)`: `· slow`, `· partial`, `· +43%`.
- **Failed** → leading timestamp folio recolors from `var(--ink-faint)` to `var(--accent)`; status word in the row turns `var(--accent)`. Earns its proofmark.

### Sparklines

Inline figures, not boxed charts. 64–96px wide, 16px tall, no axes, no fill, `var(--ink-muted)` 1px stroke. Terminal point inherits `var(--ink)` at rest, `var(--accent)` only when latest value >50% above 7-day baseline. Hover drops 1px hairline at cursor-x; the inline number to the left of the spark swaps to that day's value. No tooltip box, no legend.

Used in: AI Spend head (24-day daily-cost), Errors head (24-hour count), Chat head (7-day failure-rate), Syncs head (24-hour completed-runs).

### Tables

Every row reuses `.inv-row` — red 4px `scaleY(0→1)` proofmark on hover, warm-red wash, total recolors to `var(--accent)`, `inset 3px 0 0 var(--accent)` focus ring. No new component shape.

Columns set with `display: grid` per existing pattern. Status words and key prefixes in JetBrains Mono `10px / 0.12em`; numbers in DM Sans `600 / 15.5px tabular-nums lining-nums`; vendor-equivalent fields (job names, error messages, table names, cache prefixes) in Fraunces `500 / 17px`.

Store column collapses when the page-wide filter is set to a single store.

### Drilldowns

Inline drawer below the row (~280px push-down). Hairline-divided. No modal, no overlay, no scrim, no portal. Closes by clicking the row again, pressing Esc, or scrolling past. Same drilldown grammar as orders/invoices elsewhere in the dashboard.

### Live behavior

- Masthead `↻` rotates 360° over 600ms `cubic-bezier(0.2, 0.7, 0.2, 1)` while refresh is in flight.
- Live tiles (Redis memory / keys / commands; DB size / connections) refresh silently every 60s via TanStack Query against `/api/monitoring/summary`. New value tweens (numeric, not fade) over 280ms. Cross-threshold transitions color over the same 280ms.
- Sparkline hover: 1px hairline at cursor-x; value swap in leading number.
- All animation paths respect `prefers-reduced-motion: reduce`.

### Per-panel briefs

| Panel | Head | Body |
|---|---|---|
| `SYNCS` | dept · 24h completed-runs spark · `· 1 overdue` when present | `.inv-row` per known job. Cols: `last-run` (mono, red on fail) · `job name` (Fraunces 17) · `· status` (mono, red on fail) · `rows` · `dur` · `next expected` (mono, red when overdue past 1.5× cadence). Drilldown: last 30 runs. |
| `ERRORS` | dept · 24h count · 24h spark · `· filter` mono link revealing source chips | Virtualized list, last 50. Cols: `time` (mono, red) · `source` (mono ink-muted) · `route or action` (Fraunces 17) · `message` (DM Sans, single-line truncate). Drilldown: full stack + metadata. Empty: one `--ink-faint` mono line. |
| `AI SPEND` | dept · today's $ · 24-day spark · `· +43%` suffix when above baseline | Per-feature `.inv-row`s. Cols: `feature` (Fraunces 17) · `provider · model` (mono) · `calls 24h` · `tokens in / out` · `cost 24h` · `cost 30d`. Below a `.perforation`: 7-day cost-by-day mini-table. Drilldown: last 50 calls of that feature. |
| `CHAT` | dept · 24h turn count · 7-day failure-rate spark · `· 3 failures` when present | Status-distribution rule (1px-tall horizontal bar segmented by status, ink at varying opacity except `ERROR`/`TOOL_FAILED` in `--accent`. No legend; tooltip names segments.). Below: virtualized list of recent non-OK turns. OK majority is silent. Drilldown: full user/assistant message + captured error + linked AiUsageEvent cost. |
| `DATABASE` | dept · `87 MB / 512 MB · 17%` (red past 75%) | Single hairline-ruled bar (ink fill, accent past 75%, accent-dark past 90%). Per-table list, `.inv-row` per table. Cols: `table` (Fraunces 17) · `bytes` · share-bar (ink-muted, no color shift) · `rows` (mono ink-muted). Bottom row: `connections active`. No pie, no donut. |
| `CACHE` | dept · `mem 4% · keys 4,212 · cmd 25%` (segments turn red individually past their thresholds) | Per-prefix `.inv-row`s. Cols: `prefix` (mono) · `hit %` (red when <30% with sample >100) · `hits` · `misses` · `writes` · `busts` · `failures` (red when nonzero). |

### Editorial cuts (deliberately omitted)

- No hero-metric tile row.
- No icons next to department labels.
- No "All systems operational" badge.
- No per-panel timeframe toggles.
- No skeleton loaders.
- No chart legends.
- No empty-state illustrations.
- No status badges, dots, or pills.
- No modals for drilldowns.
- No per-panel filter chips above every panel.
- No `↑ 12%` arrow icons; use number color + `· +43%` suffix.

### Anti-AI-slop matrix

| Reflex avoided | Used instead |
|---|---|
| Status tiles with big numbers + small labels | Single masthead sentence |
| Identical card grid | Single-column stacked panels (system default) |
| Side-stripe colored borders | Failure expressed in timestamp folio + status word |
| Gradient accents | Single solid `var(--accent)` for state only |
| Glassmorphism | Existing `rgba(255,253,247,0.72)` panel ground over the grain |
| "Monitoring → dark mode" | Light cream paper (system mandate; scene justifies) |
| Modal-first drilldowns | Inline drawer |
| Green ✓ / yellow ⚠ / red ✗ trio | One accent; three-tier status via shape and word |
| Lucide-icon department labels | Mono uppercase department tag, no icon |

## Alerts (Discord)

`src/lib/monitoring/alerts.ts` exports `evaluateAlerts(jobRunId?: string)`. Called from `withJobRun` on close and from a 15-min sweep cron.

Hardcoded rules:
1. `JobRun.status === FAILURE`.
2. Job overdue past 1.5× its known cadence (cadences in a static `JOB_SCHEDULES` map).
3. Daily AI spend > `MONITORING_AI_DAILY_USD_LIMIT` (default `10`).
4. DB usage > 75% of `NEON_STORAGE_CAP_BYTES` (default `512 * 1024 * 1024`).
5. Upstash memory > 80% of cap, OR commands > 80% of daily allowance.
6. Cache hit rate < 30% on a prefix with >100 ops in the last hour.

**Dedupe without a new table:** each rule has a stable `alertKey` (`sync.failure.<jobName>`, `ai.daily-overspend`, `db.high-water`, etc.). Before firing, check the prior cycle's data:
- For `sync.failure.<jobName>`: was the previous `JobRun` for this `jobName` also `FAILURE`? If yes → skip.
- For threshold rules: was the threshold already breached in the prior 30 min? If yes → skip.

A "recovered" message fires once on the cycle the condition flips back.

Discord embeds use color `0xdc2626` (red) for failures, `0x1a1613` (ink) for recoveries. Fields: `last success`, `error message`, `next attempt`. Title links to `/dashboard/monitoring#sync-{jobName}` (or relevant anchor).

Alerter wraps every Discord POST in try/catch. Errors go to `ErrorEvent` with `source = "alerter"`; never propagate. Missed alerts > crashed sync.

## DEVELOPER role + sidebar gating

- Migration `add-developer-role`: appends `DEVELOPER` to `Role` enum.
- Vardan's user record set to `DEVELOPER` via prod psql one-liner (documented in migration README; not seeded).
- `src/app/dashboard/monitoring/layout.tsx` — server component. `if (session?.user.role !== "DEVELOPER") notFound()`.
- `src/components/app-sidebar.tsx` — adds `Monitoring` entry (icon `Activity` from lucide; placement: end of "Back of House" group). Render gated on `session.user.role === "DEVELOPER"` so Chris doesn't see the entry.
- No middleware change. Layout-level gate matches the rest of the dashboard's role-check pattern.

## Files

```
prisma/
  migrations/<ts>-add-developer-role-and-monitoring/
    migration.sql                              ← NEW: enum + 5 tables + drop InvoiceSyncLog
  schema.prisma                                ← MODIFY: enum, 5 models, drop InvoiceSyncLog

src/lib/monitoring/
  job-run.ts                                   ← NEW: withJobRun()
  ai-usage.ts                                  ← NEW: recordAiUsage() + PRICING_PER_MTOK
  errors.ts                                    ← NEW: withApiHandler, withServerAction
  cache-stats.ts                               ← NEW: in-process counters + flusher
  alerts.ts                                    ← NEW: evaluateAlerts() + rules + Discord poster
  db-stats.ts                                  ← NEW: pg_database_size / pg_total_relation_size queries
  redis-stats.ts                               ← NEW: Upstash dbsize / info wrappers
  job-schedules.ts                             ← NEW: JOB_SCHEDULES static map
  queries.ts                                   ← NEW: Prisma queries powering the page panels

src/lib/cache/
  cached.ts                                    ← MODIFY: bump counters; route failures to ErrorEvent
  redis.ts                                     ← (unchanged)

instrumentation.ts                              ← MODIFY (or NEW): register Node-side error backstop

src/app/dashboard/monitoring/
  layout.tsx                                   ← NEW: DEVELOPER gate (notFound)
  page.tsx                                     ← NEW: server component composing panels

src/components/monitoring/
  masthead.tsx                                 ← NEW: title, folio, status sentence, store filter, refresh
  front-page-lede.tsx                          ← NEW: conditional failure block
  syncs-panel.tsx                              ← NEW
  errors-panel.tsx                             ← NEW
  ai-spend-panel.tsx                           ← NEW
  chat-panel.tsx                               ← NEW
  database-panel.tsx                           ← NEW
  cache-panel.tsx                              ← NEW
  inline-spark.tsx                             ← NEW: 64–96px sparkline component
  drilldown-drawer.tsx                         ← NEW: inline expansion below a row

src/app/api/monitoring/
  summary/route.ts                             ← NEW: live tile data (DEVELOPER-gated)

src/app/api/cron/monitoring/
  sweep/route.ts                               ← NEW: 15-min alert evaluator
  cleanup/route.ts                             ← NEW: nightly 90-day delete
  cache-flush/route.ts                         ← NEW: 10-min CacheStat upsert

src/components/app-sidebar.tsx                  ← MODIFY: conditional Monitoring nav item

src/app/api/chat/route.ts                       ← MODIFY: write ChatTurn + recordAiUsage; classify status
src/app/api/otter/sync/route.ts                 ← MODIFY: wrap in withJobRun
src/lib/otter-orders-sync.ts                    ← MODIFY: wrap in withJobRun
src/lib/hourly-sync.ts                          ← MODIFY: wrap in withJobRun
src/app/api/invoices/sync/route.ts              ← MODIFY: wrap in withJobRun (drops InvoiceSyncLog writes)
src/app/api/yelp/sync/route.ts                  ← MODIFY: wrap in withJobRun
src/app/api/cron/cogs/sweep/route.ts            ← MODIFY: wrap in withJobRun
src/app/api/cron/cogs/stores/route.ts           ← MODIFY: wrap in withJobRun
src/app/api/cron/otter/hourly/route.ts          ← MODIFY: wrap in withJobRun
src/lib/openai-insights.ts                      ← MODIFY: recordAiUsage after response
src/lib/gemini-invoice.ts                       ← MODIFY: pull usageMetadata + recordAiUsage
src/app/actions/product-usage-actions.ts        ← MODIFY: recordAiUsage on each of 3 calls

vercel.json                                     ← (unchanged; crons run via GitHub Actions matrix)
```

## Env

| Var | Default | Purpose |
|---|---|---|
| `DISCORD_MONITORING_WEBHOOK_URL` | (required for alerts) | Discord webhook destination |
| `MONITORING_AI_DAILY_USD_LIMIT` | `10` | Threshold for AI spend alert |
| `NEON_STORAGE_CAP_BYTES` | `536870912` (512MB free tier) | Threshold base for DB storage panel + alert |
| `UPSTASH_DAILY_COMMAND_LIMIT` | `500000` (free tier) | Threshold base for Upstash command-rate alert |

## Verification

End-to-end checks before merge:

1. **Migration safety.** Run `npx prisma migrate dev --name add-developer-role-and-monitoring` against a local DB seeded with current prod-like state. Verify `InvoiceSyncLog` is dropped without error and Vardan's user can be promoted to `DEVELOPER` via psql.
2. **Route gate.** Sign in as Chris (OWNER) → hit `/dashboard/monitoring` → expect a 404 (Next's not-found). Sign in as Vardan (DEVELOPER) → expect the page to render.
3. **Sidebar.** Same two sessions: confirm Monitoring entry only appears for Vardan.
4. **Sync instrumentation.** Trigger each sync (manual button + cron path) and verify a `JobRun` row is written with `status = SUCCESS`. Force a failure (e.g. invalid `OTTER_JWT`) and verify `status = FAILURE` + `errorMessage` populated.
5. **AI usage.** Send one message in `/dashboard/chat`, run one P&L insight, OCR one invoice, run one product-usage action. Confirm an `AiUsageEvent` row exists for each, with non-zero `inputTokens` / `outputTokens` and a non-zero `estimatedCostUsd`.
6. **Chat status classification.** Force each failure mode where possible: kill the OpenAI key (ERROR), send a deliberately long prompt (TRUNCATED via `finish_reason = length`), make a tool throw (TOOL_FAILED). Confirm `ChatTurn.status` reflects each.
7. **Error capture.** Throw inside a wrapped API handler and a wrapped server action. Confirm `ErrorEvent` rows.
8. **Cache stats.** Hit a cached endpoint repeatedly to drive hits/misses. Confirm `CacheStat` row for the current `(hourBucket, keyPrefix)` accumulates over a few minutes.
9. **DB stats.** Render the page; confirm DB-size bar matches `psql -c "SELECT pg_size_pretty(pg_database_size(current_database()));"`.
10. **Redis stats.** Render the page; confirm key count matches `await redis.dbsize()` from a one-shot REPL.
11. **Alerts.** Force a `JobRun` failure → confirm one Discord post. Trigger another failure on the same job in the next cycle → confirm dedupe (no second post). Wait for recovery → confirm one recovery post.
12. **Reduced motion.** Toggle OS-level `prefers-reduced-motion: reduce` and verify refresh-icon snap, instant tween swaps, no hover sparkline easing.
13. **Editorial check.** Diff the page against `DESIGN.md` rules: no shadows, no `rounded-xl`, no generic Tailwind colors, every number in DM Sans tabular, every department label in JetBrains Mono uppercase, accent appears only on hover/state/failure.
