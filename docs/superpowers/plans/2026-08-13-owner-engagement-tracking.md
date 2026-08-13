# Owner Engagement Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record page views for non-DEVELOPER users and turn the monitoring People tab into an engagement page that answers "is the owner actually using this dashboard, how often, for how long, and what was he looking at last."

**Architecture:** A client component mounted in the dashboard and mobile layouts watches `usePathname()` and POSTs each completed page view to a best-effort API sink that writes one `PageView` row. All aggregation (sessions, streaks, rankings) is derived at query time by pure functions over the raw view stream — no session table, no rollups.

**Tech Stack:** Next.js 15 App Router, React 19, Prisma 7 / Postgres (Neon), zod v4, vitest.

**Spec:** `docs/superpowers/specs/2026-08-13-owner-engagement-tracking-design.md`

## Global Constraints

- **Branch:** all work lands on `feat/owner-engagement-tracking` (already created; spec committed at 843ffb6).
- **Commits:** do NOT add a `Co-Authored-By: Claude` trailer. Project preference.
- **Migrations:** apply schema with `npx prisma db push` plus a hand-written file in `prisma/manual-migrations/`. **NEVER `prisma migrate dev`** — it would reset the Neon production database.
- **Test runner:** `npm test` (vitest). Config includes `tests/**/*.test.ts` only, `environment: "node"`. There is **no jsdom and no React testing library** — do not write `.tsx` tests or add test infra for them. UI tasks are verified manually.
- **Editorial design tokens only on `/dashboard/*`:** `--ink`, `--ink-muted`, `--ink-faint`, `--paper`, `--hairline`, `--hairline-bold`, `--accent`, `--ink-ledger`. Never `bg-sky-*`, `text-emerald-*`, or any generic Tailwind color utility.
- **Typography:** import `monoLabel`, `number`, `fraunces17`, `dmBody` from `src/components/monitoring/styles.ts`. Numbers use `number` (DM Sans 600, tabular-nums). Captions/paths/labels use `monoLabel` (JetBrains Mono). Prose and panel titles use `fraunces17` with `fontStyle: "italic"`.
- **Panels are `<section className="inv-panel">`**, never shadcn `<Card>`.
- **List rows use `className="inv-row"`** for the red accent-bar hover pattern.
- **The telemetry route never throws and always returns 204.** It must never write an `ErrorEvent` — tracking must not pollute the monitoring it feeds.
- **Session gap constant:** 30 minutes. **Max dwell clamp:** 4 hours. **Retention:** 90 days.

---

## File Structure

**Create:**
- `src/lib/monitoring/page-view.ts` — pure write-path helpers: route normalization, path allowlist, dwell clamp, timestamp sanitization
- `src/app/api/telemetry/page-view/route.ts` — the best-effort sink
- `src/components/telemetry/page-view-tracker.tsx` — client beacon, renders null
- `src/lib/monitoring/engagement.ts` — pure session grouping + Prisma-backed engagement queries
- `src/components/monitoring/people/engagement-summary.tsx`
- `src/components/monitoring/people/activity-calendar.tsx`
- `src/components/monitoring/people/sessions-table.tsx` (client — expandable rows)
- `src/components/monitoring/people/top-routes-panel.tsx`
- `src/components/monitoring/bridge/engagement-tile.tsx`
- `prisma/manual-migrations/2026-08-13_page_view.sql`
- `tests/lib/page-view.test.ts`
- `tests/lib/engagement-sessions.test.ts`
- `tests/api/telemetry-page-view.test.ts`

**Modify:**
- `prisma/schema.prisma` — add `PageView` model
- `src/app/dashboard/layout.tsx` — mount tracker
- `src/app/(mobile)/m/layout.tsx` — mount tracker
- `src/app/api/cron/monitoring/cleanup/route.ts` — add 90-day `pageView` sweep
- `src/app/dashboard/admin/monitoring/people/page.tsx` — rebuild as engagement page
- `src/app/dashboard/admin/monitoring/page.tsx` — add engagement tile

**Task order rationale:** pure helpers first (Task 1), then the model they write into (Task 2), then the sink (Task 3), then the client that feeds it (Task 4) — at which point data starts accumulating and the read side (Tasks 5–8) can be built against real rows.

---

### Task 1: Write-path pure helpers

**Files:**
- Create: `src/lib/monitoring/page-view.ts`
- Test: `tests/lib/page-view.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `normalizeRoute(path: string): string`
  - `isTrackablePath(path: string): boolean`
  - `clampDwell(ms: number | null | undefined): number | null`
  - `resolveEnteredAt(clientEpochMs: number, nowMs: number): Date`
  - `MAX_DWELL_MS: number`
  - `MAX_PATH_LEN: number`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/page-view.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  normalizeRoute,
  isTrackablePath,
  clampDwell,
  resolveEnteredAt,
  MAX_DWELL_MS,
} from "@/lib/monitoring/page-view"

describe("normalizeRoute", () => {
  it("leaves static paths alone", () => {
    expect(normalizeRoute("/dashboard")).toBe("/dashboard")
    expect(normalizeRoute("/dashboard/orders")).toBe("/dashboard/orders")
    expect(normalizeRoute("/dashboard/menu-profit")).toBe("/dashboard/menu-profit")
  })

  it("collapses the id segment after a known dynamic base", () => {
    expect(normalizeRoute("/dashboard/orders/clx8f2abcdefghijklmnopq")).toBe(
      "/dashboard/orders/[id]",
    )
    expect(normalizeRoute("/m/invoices/inv-not-a-cuid")).toBe("/m/invoices/[id]")
  })

  it("uses a period placeholder for pnl", () => {
    expect(normalizeRoute("/dashboard/pnl/2026-08")).toBe("/dashboard/pnl/[period]")
  })

  it("keeps sub-paths after the collapsed segment", () => {
    expect(normalizeRoute("/dashboard/orders/clx8f2abcdefghijklmnopq/items")).toBe(
      "/dashboard/orders/[id]/items",
    )
  })

  it("strips query string, hash and trailing slash", () => {
    expect(normalizeRoute("/dashboard/invoices/abc123?tab=lines")).toBe(
      "/dashboard/invoices/[id]",
    )
    expect(normalizeRoute("/dashboard/orders/")).toBe("/dashboard/orders")
    expect(normalizeRoute("/dashboard#top")).toBe("/dashboard")
  })

  it("collapses id-shaped segments outside known bases", () => {
    expect(normalizeRoute("/dashboard/stores/12345")).toBe("/dashboard/stores/[id]")
    expect(
      normalizeRoute("/dashboard/stores/3f2504e0-4f89-11d3-9a0c-0305e82c3301"),
    ).toBe("/dashboard/stores/[id]")
  })

  it("is idempotent on already-normalized input", () => {
    expect(normalizeRoute("/dashboard/orders/[id]")).toBe("/dashboard/orders/[id]")
  })
})

describe("isTrackablePath", () => {
  it("accepts dashboard and mobile surfaces", () => {
    expect(isTrackablePath("/dashboard")).toBe(true)
    expect(isTrackablePath("/dashboard/pnl")).toBe(true)
    expect(isTrackablePath("/m")).toBe(true)
    expect(isTrackablePath("/m/orders")).toBe(true)
  })

  it("rejects everything else", () => {
    expect(isTrackablePath("/login")).toBe(false)
    expect(isTrackablePath("/api/telemetry/page-view")).toBe(false)
    expect(isTrackablePath("/")).toBe(false)
    expect(isTrackablePath("/mobile-marketing")).toBe(false)
  })
})

describe("clampDwell", () => {
  it("passes through a normal duration", () => {
    expect(clampDwell(4200)).toBe(4200)
  })

  it("returns null for null, undefined and non-finite input", () => {
    expect(clampDwell(null)).toBeNull()
    expect(clampDwell(undefined)).toBeNull()
    expect(clampDwell(NaN)).toBeNull()
    expect(clampDwell(Infinity)).toBeNull()
  })

  it("floors negatives at zero", () => {
    expect(clampDwell(-500)).toBe(0)
  })

  it("caps a weekend-long tab at the max", () => {
    expect(clampDwell(72 * 60 * 60 * 1000)).toBe(MAX_DWELL_MS)
  })

  it("rounds fractional milliseconds", () => {
    expect(clampDwell(1234.6)).toBe(1235)
  })
})

describe("resolveEnteredAt", () => {
  const now = 1_770_000_000_000

  it("trusts a plausible client timestamp", () => {
    expect(resolveEnteredAt(now - 30_000, now).getTime()).toBe(now - 30_000)
  })

  it("falls back to now when the client clock is in the future", () => {
    expect(resolveEnteredAt(now + 10 * 60_000, now).getTime()).toBe(now)
  })

  it("falls back to now when the timestamp is older than a day", () => {
    expect(resolveEnteredAt(now - 48 * 60 * 60_000, now).getTime()).toBe(now)
  })

  it("falls back to now for non-finite input", () => {
    expect(resolveEnteredAt(NaN, now).getTime()).toBe(now)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/page-view.test.ts`
Expected: FAIL — cannot resolve `@/lib/monitoring/page-view`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/monitoring/page-view.ts`:

```ts
/**
 * Pure helpers for the page-view write path. No Prisma, no session — these
 * are the parts worth testing without a database, and the parts the API
 * route must not trust the client to have done.
 */

export const MAX_DWELL_MS = 4 * 60 * 60 * 1000
export const MAX_PATH_LEN = 200

const FUTURE_SKEW_MS = 5 * 60 * 1000
const PAST_SKEW_MS = 24 * 60 * 60 * 1000

/** Route bases whose next segment is dynamic, with the placeholder to use.
 * Needed because not every id is id-shaped — a P&L period is `2026-08`. */
const DYNAMIC_BASES: ReadonlyArray<readonly [string, string]> = [
  ["/dashboard/orders", "[id]"],
  ["/dashboard/invoices", "[id]"],
  ["/dashboard/pnl", "[period]"],
  ["/m/orders", "[id]"],
  ["/m/invoices", "[id]"],
  ["/m/pnl", "[period]"],
]

/** cuid, uuid, or a bare integer. */
const ID_SEGMENT =
  /^(c[a-z0-9]{20,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)$/i

/** Strip query, hash and trailing slash. */
function bare(path: string): string {
  const cut = path.split(/[?#]/)[0] ?? ""
  if (cut.length > 1 && cut.endsWith("/")) return cut.slice(0, -1)
  return cut
}

/**
 * Collapse dynamic segments so visit counts group across detail pages.
 * `/dashboard/orders/clx.../items` -> `/dashboard/orders/[id]/items`.
 */
export function normalizeRoute(path: string): string {
  const clean = bare(path)
  for (const [base, placeholder] of DYNAMIC_BASES) {
    if (clean.startsWith(base + "/")) {
      const rest = clean.slice(base.length + 1).split("/")
      rest[0] = placeholder
      return [base, ...rest].join("/").slice(0, MAX_PATH_LEN)
    }
  }
  return clean
    .split("/")
    .map((seg) => (ID_SEGMENT.test(seg) ? "[id]" : seg))
    .join("/")
    .slice(0, MAX_PATH_LEN)
}

/** Only app surfaces are tracked. Guards against a hostile body naming
 * an arbitrary path, and against tracking auth or marketing routes. */
export function isTrackablePath(path: string): boolean {
  const clean = bare(path)
  return (
    clean === "/dashboard" ||
    clean.startsWith("/dashboard/") ||
    clean === "/m" ||
    clean.startsWith("/m/")
  )
}

/** A tab left open all weekend is not engagement. Null means "unknown",
 * which query code excludes from sums rather than counting as zero. */
export function clampDwell(ms: number | null | undefined): number | null {
  if (ms == null || !Number.isFinite(ms)) return null
  if (ms < 0) return 0
  return Math.min(Math.round(ms), MAX_DWELL_MS)
}

/** The client supplies this, so it is a hint, not a fact. */
export function resolveEnteredAt(clientEpochMs: number, nowMs: number): Date {
  if (!Number.isFinite(clientEpochMs)) return new Date(nowMs)
  if (clientEpochMs > nowMs + FUTURE_SKEW_MS) return new Date(nowMs)
  if (clientEpochMs < nowMs - PAST_SKEW_MS) return new Date(nowMs)
  return new Date(clientEpochMs)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/page-view.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/monitoring/page-view.ts tests/lib/page-view.test.ts
git commit -m "feat(monitoring): page-view write-path helpers — route normalization, dwell clamp"
```

---

### Task 2: PageView model, migration, and 90-day retention

**Files:**
- Modify: `prisma/schema.prisma` (append after the `LoginEvent` model, around line 1283)
- Create: `prisma/manual-migrations/2026-08-13_page_view.sql`
- Modify: `src/app/api/cron/monitoring/cleanup/route.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `prisma.pageView` with fields `{ id, userId, path, route, enteredAt, dwellMs }`

- [ ] **Step 1: Add the model to the schema**

Append to `prisma/schema.prisma`, immediately after the `LoginEvent` model:

```prisma
/// One page view by an authenticated non-DEVELOPER user, written best-effort
/// from the client on navigation and on page hide. `path` is what was visited;
/// `route` is that path with dynamic segments collapsed, so visit counts group
/// across detail pages instead of fragmenting one-per-record. `dwellMs` is null
/// when the flush never landed (tab killed, beacon dropped) — query code treats
/// null as unknown, not zero. No FK on userId: audit history outlives users,
/// matching LoginEvent / ErrorEvent / AiUsageEvent.
model PageView {
  id        String   @id @default(cuid())
  userId    String
  path      String
  route     String
  enteredAt DateTime
  dwellMs   Int?

  @@index([userId, enteredAt(sort: Desc)])
  @@index([route, enteredAt(sort: Desc)])
  @@index([enteredAt(sort: Desc)])
}
```

- [ ] **Step 2: Write the manual migration**

Create `prisma/manual-migrations/2026-08-13_page_view.sql`:

```sql
-- Owner engagement tracking: raw page-view stream.
-- Applied to production with `prisma db push`; this file is the auditable record.
-- See docs/superpowers/specs/2026-08-13-owner-engagement-tracking-design.md

CREATE TABLE IF NOT EXISTS "PageView" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "path"      TEXT NOT NULL,
  "route"     TEXT NOT NULL,
  "enteredAt" TIMESTAMP(3) NOT NULL,
  "dwellMs"   INTEGER,
  CONSTRAINT "PageView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PageView_userId_enteredAt_idx"
  ON "PageView" ("userId", "enteredAt" DESC);
CREATE INDEX IF NOT EXISTS "PageView_route_enteredAt_idx"
  ON "PageView" ("route", "enteredAt" DESC);
CREATE INDEX IF NOT EXISTS "PageView_enteredAt_idx"
  ON "PageView" ("enteredAt" DESC);
```

- [ ] **Step 3: Apply the schema and regenerate the client**

Run: `npx prisma db push && npx prisma generate`
Expected: `PageView` created, client regenerated. **Do not run `prisma migrate dev`.**

- [ ] **Step 4: Add the retention sweep**

In `src/app/api/cron/monitoring/cleanup/route.ts`, add `pageView` to the parallel
`deleteMany` batch and to the returned counts. The destructuring array and the
`Promise.all` array must stay index-aligned:

```ts
    const [jobRun, ai, err, cache, snapshot, vercel, login, r2, pageView] = await Promise.all([
      prisma.jobRun.deleteMany({ where: { startedAt: { lt: cutoff } } }),
      prisma.aiUsageEvent.deleteMany({ where: { occurredAt: { lt: cutoff } } }),
      prisma.errorEvent.deleteMany({ where: { occurredAt: { lt: cutoff } } }),
      prisma.cacheStat.deleteMany({ where: { hourBucket: { lt: cutoff } } }),
      prisma.dbSnapshot.deleteMany({ where: { date: { lt: cutoff } } }),
      prisma.vercelUsageSnapshot.deleteMany({ where: { capturedAt: { lt: cutoff } } }),
      prisma.loginEvent.deleteMany({ where: { createdAt: { lt: cutoff } } }),
      prisma.r2BucketSnapshot.deleteMany({ where: { capturedAt: { lt: cutoff } } }),
      prisma.pageView.deleteMany({ where: { enteredAt: { lt: cutoff } } }),
    ])
```

And in the response body, after `r2BucketSnapshot: r2.count,`:

```ts
        pageView: pageView.count,
```

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors. If `prisma.pageView` is unknown, Step 3's `prisma generate` did not run.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/manual-migrations/2026-08-13_page_view.sql src/app/api/cron/monitoring/cleanup/route.ts
git commit -m "feat(monitoring): PageView model with 90-day retention sweep"
```

---

### Task 3: The telemetry sink

**Files:**
- Create: `src/app/api/telemetry/page-view/route.ts`
- Test: `tests/api/telemetry-page-view.test.ts`

**Interfaces:**
- Consumes: `normalizeRoute`, `isTrackablePath`, `clampDwell`, `resolveEnteredAt`, `MAX_PATH_LEN` from `@/lib/monitoring/page-view`; `prisma.pageView.create`
- Produces: `POST` handler at `/api/telemetry/page-view`. Accepts `{ path: string, enteredAt: number, dwellMs: number | null }`. Always responds 204.

- [ ] **Step 1: Write the failing test**

Create `tests/api/telemetry-page-view.test.ts`:

```ts
// The sink must be silent in both directions: it never rejects a caller with an
// error status, and it never writes a row it should not have. Every no-op case
// therefore asserts `create` was NOT called — a 204 alone proves nothing here.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: { pageView: { create: vi.fn() } },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { POST } from "@/app/api/telemetry/page-view/route"
import { MAX_DWELL_MS } from "@/lib/monitoring/page-view"

const mockedSession = vi.mocked(getServerSession)
const create = vi.mocked(prisma.pageView.create)

const session = (role: "OWNER" | "DEVELOPER" | "MANAGER" = "OWNER") => ({
  user: { id: "u1", accountId: "acct-A", role },
})

function req(body: unknown): Request {
  return new Request("http://test.local/api/telemetry/page-view", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const validBody = {
  path: "/dashboard/pnl",
  enteredAt: Date.now() - 5000,
  dwellMs: 5000,
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.TRACK_DEVELOPER_PAGE_VIEWS
  create.mockResolvedValue({} as never)
})

describe("POST /api/telemetry/page-view — no-op cases", () => {
  it("writes nothing when there is no session", async () => {
    mockedSession.mockResolvedValue(null as never)
    const res = await POST(req(validBody))
    expect(res.status).toBe(204)
    expect(create).not.toHaveBeenCalled()
  })

  it("writes nothing for a DEVELOPER session", async () => {
    mockedSession.mockResolvedValue(session("DEVELOPER") as never)
    const res = await POST(req(validBody))
    expect(res.status).toBe(204)
    expect(create).not.toHaveBeenCalled()
  })

  it("writes nothing for a path outside the app surfaces", async () => {
    mockedSession.mockResolvedValue(session() as never)
    const res = await POST(req({ ...validBody, path: "/login" }))
    expect(res.status).toBe(204)
    expect(create).not.toHaveBeenCalled()
  })

  it("writes nothing for a malformed body", async () => {
    mockedSession.mockResolvedValue(session() as never)
    const res = await POST(req({ path: 42 }))
    expect(res.status).toBe(204)
    expect(create).not.toHaveBeenCalled()
  })

  it("writes nothing for an unparseable body", async () => {
    mockedSession.mockResolvedValue(session() as never)
    const bad = new Request("http://test.local/api/telemetry/page-view", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    })
    const res = await POST(bad)
    expect(res.status).toBe(204)
    expect(create).not.toHaveBeenCalled()
  })

  it("still returns 204 when the database write throws", async () => {
    mockedSession.mockResolvedValue(session() as never)
    create.mockRejectedValue(new Error("connection lost"))
    const res = await POST(req(validBody))
    expect(res.status).toBe(204)
  })
})

describe("POST /api/telemetry/page-view — accepted writes", () => {
  beforeEach(() => {
    mockedSession.mockResolvedValue(session() as never)
  })

  it("persists the row with a server-computed route", async () => {
    const enteredAt = Date.now() - 5000
    await POST(req({ path: "/dashboard/orders/clx8f2abcdefghijklmnopq", enteredAt, dwellMs: 5000 }))
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0]).toMatchObject({
      data: {
        userId: "u1",
        path: "/dashboard/orders/clx8f2abcdefghijklmnopq",
        route: "/dashboard/orders/[id]",
        dwellMs: 5000,
      },
    })
    const written = create.mock.calls[0]![0].data as unknown as { enteredAt: Date }
    expect(written.enteredAt.getTime()).toBe(enteredAt)
  })

  it("clamps an implausibly long dwell", async () => {
    await POST(req({ ...validBody, dwellMs: 72 * 60 * 60 * 1000 }))
    expect(create.mock.calls[0]![0].data).toMatchObject({ dwellMs: MAX_DWELL_MS })
  })

  it("accepts a null dwell", async () => {
    await POST(req({ ...validBody, dwellMs: null }))
    expect(create.mock.calls[0]![0].data).toMatchObject({ dwellMs: null })
  })

  it("substitutes server time for a future client clock", async () => {
    const before = Date.now()
    await POST(req({ ...validBody, enteredAt: Date.now() + 10 * 60_000 }))
    const written = create.mock.calls[0]![0].data as unknown as { enteredAt: Date }
    expect(written.enteredAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(written.enteredAt.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it("truncates an over-long path", async () => {
    const long = "/dashboard/" + "a".repeat(500)
    await POST(req({ ...validBody, path: long }))
    const written = create.mock.calls[0]![0].data as unknown as { path: string }
    expect(written.path.length).toBeLessThanOrEqual(200)
  })

  it("writes for a DEVELOPER when the local escape hatch is set", async () => {
    process.env.TRACK_DEVELOPER_PAGE_VIEWS = "1"
    mockedSession.mockResolvedValue(session("DEVELOPER") as never)
    const res = await POST(req(validBody))
    expect(res.status).toBe(204)
    expect(create).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/api/telemetry-page-view.test.ts`
Expected: FAIL — cannot resolve `@/app/api/telemetry/page-view/route`.

- [ ] **Step 3: Write minimal implementation**

Create `src/app/api/telemetry/page-view/route.ts`:

```ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { z } from "zod"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  clampDwell,
  isTrackablePath,
  normalizeRoute,
  resolveEnteredAt,
  MAX_PATH_LEN,
} from "@/lib/monitoring/page-view"

export const dynamic = "force-dynamic"

const bodySchema = z.object({
  path: z.string().min(1),
  enteredAt: z.number(),
  dwellMs: z.number().nullable().optional(),
})

/** Always 204. A no-op and a successful write are indistinguishable to the
 * caller by design: this endpoint must never surface a failure to the person
 * being tracked, and must never emit an ErrorEvent of its own — that would
 * pollute the very monitoring stream it exists to feed. */
const NO_CONTENT = () => new NextResponse(null, { status: 204 })

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions)
    const userId = session?.user?.id
    if (!userId) return NO_CONTENT()

    // Developer browsing is excluded by decision. The local escape hatch
    // exists because the developer otherwise cannot exercise this path.
    if (
      session.user.role === "DEVELOPER" &&
      process.env.TRACK_DEVELOPER_PAGE_VIEWS !== "1"
    ) {
      return NO_CONTENT()
    }

    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) return NO_CONTENT()

    const { path, enteredAt, dwellMs } = parsed.data
    if (!isTrackablePath(path)) return NO_CONTENT()

    await prisma.pageView.create({
      data: {
        userId,
        path: path.split(/[?#]/)[0]!.slice(0, MAX_PATH_LEN),
        route: normalizeRoute(path),
        enteredAt: resolveEnteredAt(enteredAt, Date.now()),
        dwellMs: clampDwell(dwellMs ?? null),
      },
    })
  } catch (err) {
    console.error("[page-view] dropped", err)
  }
  return NO_CONTENT()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/api/telemetry-page-view.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/telemetry/page-view/route.ts tests/api/telemetry-page-view.test.ts
git commit -m "feat(monitoring): best-effort page-view sink that never throws"
```

---

### Task 4: Client beacon and layout mounts

**Files:**
- Create: `src/components/telemetry/page-view-tracker.tsx`
- Modify: `src/app/dashboard/layout.tsx`
- Modify: `src/app/(mobile)/m/layout.tsx`

**Interfaces:**
- Consumes: `POST /api/telemetry/page-view`
- Produces: `<PageViewTracker enabled={boolean} />` — a client component rendering `null`

There is no jsdom in this project, so this task is verified by exercising the real
app against the real endpoint rather than by unit test.

- [ ] **Step 1: Write the tracker**

Create `src/components/telemetry/page-view-tracker.tsx`:

```tsx
"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"

const ENDPOINT = "/api/telemetry/page-view"

type Entry = { path: string; enteredAt: number; flushed: boolean }

/**
 * Records what the user actually looked at, and for how long.
 *
 * Deliberately client-side rather than middleware: middleware fires on RSC
 * prefetches, so <Link> hover would inflate visit counts with pages nobody
 * opened, and it could not measure dwell at all. Dwell is the whole point —
 * "opened /pnl 40 times" and "opened /pnl 40 times and bounced in 2s" are
 * opposite findings.
 */
export function PageViewTracker({ enabled }: { enabled: boolean }) {
  const pathname = usePathname()
  const current = useRef<Entry | null>(null)

  useEffect(() => {
    if (!enabled || !pathname) return

    flush(current.current)
    current.current = { path: pathname, enteredAt: Date.now(), flushed: false }

    const onHide = () => {
      if (document.visibilityState === "hidden") flush(current.current)
    }
    const onPageHide = () => flush(current.current)

    document.addEventListener("visibilitychange", onHide)
    window.addEventListener("pagehide", onPageHide)
    return () => {
      document.removeEventListener("visibilitychange", onHide)
      window.removeEventListener("pagehide", onPageHide)
    }
  }, [pathname, enabled])

  return null
}

/** Idempotent per entry: pagehide followed by unmount must write once, and
 * React strict-mode's double effect must not double-count. */
function flush(entry: Entry | null): void {
  if (!entry || entry.flushed) return
  entry.flushed = true

  const payload = JSON.stringify({
    path: entry.path,
    enteredAt: entry.enteredAt,
    dwellMs: Date.now() - entry.enteredAt,
  })

  try {
    // sendBeacon survives unload; fetch+keepalive is the fallback.
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: "application/json" }))
      return
    }
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Tracking must never break navigation.
  }
}
```

- [ ] **Step 2: Mount it in the dashboard layout**

In `src/app/dashboard/layout.tsx`, add the import beside the other component imports:

```tsx
import { PageViewTracker } from "@/components/telemetry/page-view-tracker"
```

Add this line just after `const session = await getServerSession(authOptions)`:

```tsx
  const trackViews =
    session?.user?.id != null &&
    (session.user.role !== "DEVELOPER" ||
      process.env.TRACK_DEVELOPER_PAGE_VIEWS === "1")
```

Then render the tracker as the first child inside `<ChatDrawerProvider>`:

```tsx
      <ChatDrawerProvider>
        <PageViewTracker enabled={trackViews} />
```

- [ ] **Step 3: Mount it in the mobile layout**

In `src/app/(mobile)/m/layout.tsx`, add the import beside the other component
imports:

```tsx
import { PageViewTracker } from "@/components/telemetry/page-view-tracker"
```

Add this immediately after `const session = await getServerSession(authOptions)`:

```tsx
  const trackViews =
    session?.user?.id != null &&
    (session.user.role !== "DEVELOPER" ||
      process.env.TRACK_DEVELOPER_PAGE_VIEWS === "1")
```

Then render the tracker as the first child of the returned root `<div>`, before
the welcome marquee and tab bar:

```tsx
      <PageViewTracker enabled={trackViews} />
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Verify end to end against a real browser**

Add `TRACK_DEVELOPER_PAGE_VIEWS=1` to `.env.local`, then:

```bash
npm run dev
```

Sign in, visit `/dashboard`, then `/dashboard/pnl`, then an invoice detail page,
waiting a few seconds on each. Then confirm rows landed:

```bash
npx prisma studio
```

Expected in `PageView`: one row per page left, `dwellMs` roughly matching the
seconds you waited, `route` collapsed on the detail page (`/dashboard/invoices/[id]`)
while `path` keeps the real id. Confirm no duplicate rows per navigation.

- [ ] **Step 6: Commit**

```bash
git add src/components/telemetry/page-view-tracker.tsx "src/app/dashboard/layout.tsx" "src/app/(mobile)/m/layout.tsx"
git commit -m "feat(monitoring): client page-view beacon mounted on dashboard and mobile"
```

---

### Task 5: Session grouping

**Files:**
- Create: `src/lib/monitoring/engagement.ts`
- Test: `tests/lib/engagement-sessions.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `SESSION_GAP_MS: number`
  - `type ViewRow = { path: string; route: string; enteredAt: Date; dwellMs: number | null }`
  - `type Session = { startedAt: Date; endedAt: Date; durationMs: number; pageCount: number; entryPath: string; exitPath: string; views: ViewRow[] }`
  - `groupIntoSessions(views: ViewRow[], gapMs?: number): Session[]`
  - `countStreak(days: string[], todayKey: string): number`
  - `dayKey(d: Date): string`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/engagement-sessions.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  groupIntoSessions,
  countStreak,
  dayKey,
  SESSION_GAP_MS,
  type ViewRow,
} from "@/lib/monitoring/engagement"

const base = new Date("2026-08-10T14:00:00.000Z").getTime()

function view(offsetMs: number, dwellMs: number | null, path = "/dashboard"): ViewRow {
  return { path, route: path, enteredAt: new Date(base + offsetMs), dwellMs }
}

describe("groupIntoSessions", () => {
  it("returns nothing for no views", () => {
    expect(groupIntoSessions([])).toEqual([])
  })

  it("treats a single view as one session", () => {
    const [s, ...rest] = groupIntoSessions([view(0, 30_000, "/dashboard/pnl")])
    expect(rest).toHaveLength(0)
    expect(s.pageCount).toBe(1)
    expect(s.durationMs).toBe(30_000)
    expect(s.entryPath).toBe("/dashboard/pnl")
    expect(s.exitPath).toBe("/dashboard/pnl")
  })

  it("keeps views in one session when the gap is exactly the threshold", () => {
    const views = [view(0, 1000), view(1000 + SESSION_GAP_MS, 1000)]
    expect(groupIntoSessions(views)).toHaveLength(1)
  })

  it("splits when the gap exceeds the threshold", () => {
    const views = [view(0, 1000), view(1000 + SESSION_GAP_MS + 1, 1000)]
    const sessions = groupIntoSessions(views)
    expect(sessions).toHaveLength(2)
    expect(sessions[0].pageCount).toBe(1)
    expect(sessions[1].pageCount).toBe(1)
  })

  it("carries entry and exit paths across a multi-page session", () => {
    const views = [
      view(0, 5_000, "/dashboard"),
      view(5_000, 10_000, "/dashboard/pnl"),
      view(15_000, 2_000, "/dashboard/orders"),
    ]
    const [s] = groupIntoSessions(views)
    expect(s.pageCount).toBe(3)
    expect(s.entryPath).toBe("/dashboard")
    expect(s.exitPath).toBe("/dashboard/orders")
    expect(s.durationMs).toBe(17_000)
  })

  it("treats a null dwell as zero when closing a session", () => {
    const [s] = groupIntoSessions([view(0, 5_000), view(5_000, null)])
    expect(s.endedAt.getTime()).toBe(base + 5_000)
    expect(s.durationMs).toBe(5_000)
  })

  it("sorts unordered input before grouping", () => {
    const views = [view(10_000, 1_000, "/b"), view(0, 1_000, "/a")]
    const [s] = groupIntoSessions(views)
    expect(s.entryPath).toBe("/a")
    expect(s.exitPath).toBe("/b")
  })

  it("does not split a session that spans midnight", () => {
    const late = new Date("2026-08-10T23:55:00.000Z").getTime()
    const views: ViewRow[] = [
      { path: "/a", route: "/a", enteredAt: new Date(late), dwellMs: 60_000 },
      { path: "/b", route: "/b", enteredAt: new Date(late + 10 * 60_000), dwellMs: 60_000 },
    ]
    expect(groupIntoSessions(views)).toHaveLength(1)
  })
})

describe("countStreak", () => {
  it("counts consecutive days ending today", () => {
    expect(countStreak(["2026-08-13", "2026-08-12", "2026-08-11"], "2026-08-13")).toBe(3)
  })

  it("still counts a streak that ended yesterday", () => {
    expect(countStreak(["2026-08-12", "2026-08-11"], "2026-08-13")).toBe(2)
  })

  it("is zero when the most recent day is older than yesterday", () => {
    expect(countStreak(["2026-08-01"], "2026-08-13")).toBe(0)
  })

  it("stops at the first missing day", () => {
    expect(countStreak(["2026-08-13", "2026-08-11", "2026-08-10"], "2026-08-13")).toBe(1)
  })

  it("is zero for no active days", () => {
    expect(countStreak([], "2026-08-13")).toBe(0)
  })
})

describe("dayKey", () => {
  it("formats a local date as YYYY-MM-DD", () => {
    expect(dayKey(new Date(2026, 7, 3))).toBe("2026-08-03")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/engagement-sessions.test.ts`
Expected: FAIL — cannot resolve `@/lib/monitoring/engagement`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/monitoring/engagement.ts` with the pure layer only (queries land in Task 6):

```ts
/**
 * Engagement derivation over the raw PageView stream.
 *
 * Sessions are computed here rather than stored: a pure function over a few
 * thousand ordered rows is cheap, and storing them would create a second
 * source of truth that drifts from the views it summarizes.
 */

export const SESSION_GAP_MS = 30 * 60 * 1000

export type ViewRow = {
  path: string
  route: string
  enteredAt: Date
  dwellMs: number | null
}

export type Session = {
  startedAt: Date
  endedAt: Date
  durationMs: number
  pageCount: number
  entryPath: string
  exitPath: string
  views: ViewRow[]
}

/** A session ends when the gap between one view's end and the next view's
 * start EXCEEDS gapMs. Exactly gapMs keeps them together. */
export function groupIntoSessions(
  views: ViewRow[],
  gapMs: number = SESSION_GAP_MS,
): Session[] {
  if (views.length === 0) return []

  const ordered = [...views].sort(
    (a, b) => a.enteredAt.getTime() - b.enteredAt.getTime(),
  )

  const groups: ViewRow[][] = [[ordered[0]!]]
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]!
    const cur = ordered[i]!
    const prevEnd = prev.enteredAt.getTime() + (prev.dwellMs ?? 0)
    if (cur.enteredAt.getTime() - prevEnd > gapMs) {
      groups.push([cur])
    } else {
      groups[groups.length - 1]!.push(cur)
    }
  }

  return groups.map((group) => {
    const first = group[0]!
    const last = group[group.length - 1]!
    const startedAt = first.enteredAt
    const endedAt = new Date(last.enteredAt.getTime() + (last.dwellMs ?? 0))
    return {
      startedAt,
      endedAt,
      durationMs: endedAt.getTime() - startedAt.getTime(),
      pageCount: group.length,
      entryPath: first.path,
      exitPath: last.path,
      views: group,
    }
  })
}

/** Local-time YYYY-MM-DD. Days are what a human means by "was he here". */
export function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function shiftDay(key: string, deltaDays: number): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number]
  return dayKey(new Date(y, m - 1, d + deltaDays))
}

/** Consecutive active days ending today or yesterday. Yesterday still counts
 * so the number does not read as broken every morning before he logs in. */
export function countStreak(days: string[], todayKey: string): number {
  if (days.length === 0) return 0
  const active = new Set(days)
  let cursor = todayKey
  if (!active.has(cursor)) {
    cursor = shiftDay(todayKey, -1)
    if (!active.has(cursor)) return 0
  }
  let streak = 0
  while (active.has(cursor)) {
    streak++
    cursor = shiftDay(cursor, -1)
  }
  return streak
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/engagement-sessions.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/monitoring/engagement.ts tests/lib/engagement-sessions.test.ts
git commit -m "feat(monitoring): derive sessions and streaks from the page-view stream"
```

---

### Task 6: Engagement queries

**Files:**
- Modify: `src/lib/monitoring/engagement.ts` (append to the file created in Task 5)

**Interfaces:**
- Consumes: `groupIntoSessions`, `countStreak`, `dayKey`, `ViewRow`, `Session` from Task 5; `prisma.pageView.findMany`, `prisma.user.findMany`
- Produces:
  - `type EngagementSummaryRow = { userId: string; name: string; email: string; lastSeenAt: Date | null; lastPath: string | null; sessionCount: number; sessionsToday: number; totalMs: number; activeDays: number; currentStreak: number }`
  - `type ActiveDay = { date: string; views: number }`
  - `type TopRoute = { route: string; visits: number; medianDwellMs: number | null }`
  - `type EngagementData = { summary: EngagementSummaryRow[]; sessionsByUser: Record<string, Session[]>; activeDays: ActiveDay[]; topRoutes: TopRoute[] }`
  - `getEngagementData(days?: number): Promise<EngagementData>`
  - `getEngagementHeadline(): Promise<{ name: string; lastSeenAt: Date; lastPath: string; sessionsToday: number } | null>`

**Deviation from the spec, deliberate.** The spec names five separate query
functions (`getEngagementSummary`, `getSessions`, `getSessionTimeline`,
`getActiveDays`, `getTopRoutes`). This plan collapses them into one
`getEngagementData(days)` returning all four derived views, plus a narrow
`getEngagementHeadline()` for the Bridge tile.

Reason: all five read the same window of the same table, so as separate exports
the People page would scan those rows four times over for aggregation that is
pure-function work on data already in memory. The session timeline is not a
query at all — it is `session.views`, already present on every grouped session.
The spec's five *views* all survive; only the call surface changed. Everything
below the fetch is still pure and still covered by the Task 5 tests.

- [ ] **Step 1: Append the query layer**

Add to the end of `src/lib/monitoring/engagement.ts`:

```ts
import { prisma } from "@/lib/prisma"

export type EngagementSummaryRow = {
  userId: string
  name: string
  email: string
  lastSeenAt: Date | null
  lastPath: string | null
  sessionCount: number
  sessionsToday: number
  totalMs: number
  activeDays: number
  currentStreak: number
}

export type ActiveDay = { date: string; views: number }

export type TopRoute = { route: string; visits: number; medianDwellMs: number | null }

export type EngagementData = {
  summary: EngagementSummaryRow[]
  sessionsByUser: Record<string, Session[]>
  activeDays: ActiveDay[]
  topRoutes: TopRoute[]
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!
}

/** One windowed read; everything below is derived in memory. At a few hundred
 * views a day this window is a few thousand rows. */
export async function getEngagementData(days = 30): Promise<EngagementData> {
  const cutoff = new Date(Date.now() - days * 86_400_000)
  const rows = await prisma.pageView.findMany({
    where: { enteredAt: { gte: cutoff } },
    orderBy: { enteredAt: "asc" },
    select: {
      userId: true,
      path: true,
      route: true,
      enteredAt: true,
      dwellMs: true,
    },
  })

  if (rows.length === 0) {
    return { summary: [], sessionsByUser: {}, activeDays: [], topRoutes: [] }
  }

  const byUser = new Map<string, ViewRow[]>()
  const dayCounts = new Map<string, number>()
  const routeDwells = new Map<string, number[]>()
  const routeVisits = new Map<string, number>()

  for (const r of rows) {
    const list = byUser.get(r.userId)
    if (list) list.push(r)
    else byUser.set(r.userId, [r])

    const key = dayKey(r.enteredAt)
    dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1)

    routeVisits.set(r.route, (routeVisits.get(r.route) ?? 0) + 1)
    if (r.dwellMs != null) {
      const dwells = routeDwells.get(r.route)
      if (dwells) dwells.push(r.dwellMs)
      else routeDwells.set(r.route, [r.dwellMs])
    }
  }

  const users = await prisma.user.findMany({
    where: { id: { in: [...byUser.keys()] } },
    select: { id: true, name: true, email: true },
  })
  const userById = new Map(users.map((u) => [u.id, u]))

  const today = dayKey(new Date())
  const sessionsByUser: Record<string, Session[]> = {}
  const summary: EngagementSummaryRow[] = []

  for (const [userId, views] of byUser) {
    const sessions = groupIntoSessions(views)
    sessionsByUser[userId] = [...sessions].reverse() // newest first for display
    const activeDayKeys = [...new Set(views.map((v) => dayKey(v.enteredAt)))]
    const last = views[views.length - 1]
    const u = userById.get(userId)
    summary.push({
      userId,
      name: u?.name ?? "Unknown user",
      email: u?.email ?? userId,
      lastSeenAt: last?.enteredAt ?? null,
      lastPath: last?.path ?? null,
      sessionCount: sessions.length,
      sessionsToday: sessions.filter((s) => dayKey(s.startedAt) === today).length,
      totalMs: sessions.reduce((sum, s) => sum + s.durationMs, 0),
      activeDays: activeDayKeys.length,
      currentStreak: countStreak(activeDayKeys, today),
    })
  }

  summary.sort(
    (a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0),
  )

  const activeDays: ActiveDay[] = [...dayCounts.entries()]
    .map(([date, views]) => ({ date, views }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const topRoutes: TopRoute[] = [...routeVisits.entries()]
    .map(([route, visits]) => ({
      route,
      visits,
      medianDwellMs: median(routeDwells.get(route) ?? []),
    }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 15)

  return { summary, sessionsByUser, activeDays, topRoutes }
}

/** Cheap read for the Bridge tile — the index page must not pay for a
 * 30-day scan just to say "last seen 14m ago". */
export async function getEngagementHeadline(): Promise<{
  name: string
  lastSeenAt: Date
  lastPath: string
  sessionsToday: number
} | null> {
  const latest = await prisma.pageView.findFirst({
    orderBy: { enteredAt: "desc" },
    select: { userId: true, path: true, enteredAt: true },
  })
  if (!latest) return null

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  const [user, todayViews] = await Promise.all([
    prisma.user.findUnique({
      where: { id: latest.userId },
      select: { name: true },
    }),
    prisma.pageView.findMany({
      where: { userId: latest.userId, enteredAt: { gte: startOfToday } },
      orderBy: { enteredAt: "asc" },
      select: { path: true, route: true, enteredAt: true, dwellMs: true },
    }),
  ])

  return {
    name: user?.name ?? "Unknown user",
    lastSeenAt: latest.enteredAt,
    lastPath: latest.path,
    sessionsToday: groupIntoSessions(todayViews).length,
  }
}
```

- [ ] **Step 2: Verify the existing pure-function tests still pass**

Run: `npm test -- tests/lib/engagement-sessions.test.ts`
Expected: PASS. Importing Prisma into this module must not break the pure tests;
if it does, the import is being evaluated at module scope in a way that needs a
`vi.mock("@/lib/prisma")` added to the test file — add it and re-run.

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/monitoring/engagement.ts
git commit -m "feat(monitoring): engagement queries over one windowed page-view read"
```

---

### Task 7: People tab rebuild

**Files:**
- Create: `src/components/monitoring/people/engagement-summary.tsx`
- Create: `src/components/monitoring/people/activity-calendar.tsx`
- Create: `src/components/monitoring/people/sessions-table.tsx`
- Create: `src/components/monitoring/people/top-routes-panel.tsx`
- Modify: `src/app/dashboard/admin/monitoring/people/page.tsx`

**Interfaces:**
- Consumes: `getEngagementData`, and the types `EngagementSummaryRow`, `ActiveDay`, `TopRoute`, `Session` from `@/lib/monitoring/engagement`
- Produces: four panel components, each accepting exactly the type named above

Match the existing panel idiom in `src/components/monitoring/people/login-history-table.tsx`:
`<section className="inv-panel">`, a `RegisterMark` + italic Fraunces title row, a
mono count on the right, and an italic Fraunces empty state.

- [ ] **Step 1: Create a shared duration formatter and the summary panel**

Create `src/components/monitoring/people/engagement-summary.tsx`:

```tsx
import { fraunces17, monoLabel, dmBody, number } from "../styles"
import { RegisterMark } from "../register-mark"
import { SYSTEM_INK } from "../system-color"
import type { EngagementSummaryRow } from "@/lib/monitoring/engagement"

export function fmtDuration(ms: number): string {
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  return `${hours}h ${mins % 60}m`
}

export function fmtAgo(d: Date): string {
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function EngagementSummary({ rows }: { rows: EngagementSummaryRow[] }) {
  return (
    <section className="inv-panel" style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <RegisterMark color={SYSTEM_INK.auth} size={8} />
        <span style={{ ...fraunces17, fontStyle: "italic", color: "var(--ink)" }}>
          Engagement
        </span>
        <span
          style={{
            ...monoLabel,
            color: "var(--ink-faint)",
            letterSpacing: "0.16em",
            marginLeft: "auto",
          }}
        >
          last 30 days
        </span>
      </div>

      {rows.length === 0 ? (
        <p
          style={{
            ...fraunces17,
            fontStyle: "italic",
            color: "var(--ink-muted)",
            marginTop: 12,
          }}
        >
          No page views recorded yet. Data begins accumulating once a
          non-developer signs in.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
          {rows.map((r) => (
            <div
              key={r.userId}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr repeat(4, minmax(90px, auto))",
                gap: 16,
                alignItems: "baseline",
                paddingBottom: 12,
                borderBottom: "1px solid var(--hairline)",
              }}
            >
              <div>
                <div style={{ ...dmBody, color: "var(--ink)" }}>{r.name}</div>
                <div style={{ ...monoLabel, color: "var(--ink-faint)", marginTop: 3 }}>
                  {r.lastSeenAt
                    ? `${fmtAgo(r.lastSeenAt)} · ${r.lastPath ?? "—"}`
                    : "never seen"}
                </div>
              </div>
              <Stat label="sessions" value={String(r.sessionCount)} />
              <Stat label="today" value={String(r.sessionsToday)} />
              <Stat label="time" value={fmtDuration(r.totalMs)} />
              <Stat
                label="streak"
                value={`${r.currentStreak}d`}
                accent={r.currentStreak === 0}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ ...number, color: accent ? "var(--accent)" : "var(--ink)" }}>
        {value}
      </div>
      <div style={{ ...monoLabel, color: "var(--ink-faint)", marginTop: 3 }}>
        {label}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create the activity calendar**

Create `src/components/monitoring/people/activity-calendar.tsx`:

```tsx
import { fraunces17, monoLabel } from "../styles"
import { RegisterMark } from "../register-mark"
import { SYSTEM_INK } from "../system-color"
import type { ActiveDay } from "@/lib/monitoring/engagement"

/** 90 cells, oldest to newest. Absent days are the point of this strip —
 * a gap is the signal, so empty cells stay visible rather than collapsing. */
export function ActivityCalendar({ days }: { days: ActiveDay[] }) {
  const byDate = new Map(days.map((d) => [d.date, d.views]))
  const max = Math.max(1, ...days.map((d) => d.views))

  const cells: Array<{ date: string; views: number }> = []
  const today = new Date()
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`
    cells.push({ date: key, views: byDate.get(key) ?? 0 })
  }

  return (
    <section className="inv-panel" style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <RegisterMark color={SYSTEM_INK.auth} size={8} />
        <span style={{ ...fraunces17, fontStyle: "italic", color: "var(--ink)" }}>
          Active days
        </span>
        <span
          style={{
            ...monoLabel,
            color: "var(--ink-faint)",
            letterSpacing: "0.16em",
            marginLeft: "auto",
          }}
        >
          {days.length} of 90
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(30, 1fr)",
          gap: 3,
          marginTop: 14,
        }}
      >
        {cells.map((c) => (
          <div
            key={c.date}
            title={`${c.date} — ${c.views} views`}
            style={{
              aspectRatio: "1",
              borderRadius: 2,
              border: "1px solid var(--hairline)",
              background:
                c.views === 0
                  ? "transparent"
                  : `rgba(220, 38, 38, ${0.12 + 0.68 * (c.views / max)})`,
            }}
          />
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Create the sessions table**

Create `src/components/monitoring/people/sessions-table.tsx`:

```tsx
"use client"

import { useState } from "react"
import { fraunces17, monoLabel, dmBody, number } from "../styles"
import { RegisterMark } from "../register-mark"
import { SYSTEM_INK } from "../system-color"
import type { Session } from "@/lib/monitoring/engagement"
import { fmtDuration } from "./engagement-summary"

export function SessionsTable({
  sessions,
  userName,
}: {
  sessions: Session[]
  userName: string
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null)

  return (
    <section className="inv-panel" style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <RegisterMark color={SYSTEM_INK.auth} size={8} />
        <span style={{ ...fraunces17, fontStyle: "italic", color: "var(--ink)" }}>
          Sessions — {userName}
        </span>
        <span
          style={{
            ...monoLabel,
            color: "var(--ink-faint)",
            letterSpacing: "0.16em",
            marginLeft: "auto",
          }}
        >
          {sessions.length} sessions
        </span>
      </div>

      {sessions.length === 0 ? (
        <p
          style={{
            ...fraunces17,
            fontStyle: "italic",
            color: "var(--ink-muted)",
            marginTop: 12,
          }}
        >
          No sessions in this window.
        </p>
      ) : (
        <ul style={{ margin: "12px 0 0 0", padding: 0, listStyle: "none" }}>
          {sessions.map((s, i) => (
            <li key={s.startedAt.toISOString()}>
              <button
                type="button"
                className="inv-row"
                onClick={() => setOpenIdx(openIdx === i ? null : i)}
                aria-expanded={openIdx === i}
                style={{
                  width: "100%",
                  display: "grid",
                  gridTemplateColumns: "150px 90px 70px 1fr",
                  alignItems: "baseline",
                  gap: 12,
                  padding: "9px 4px",
                  background: "none",
                  border: "none",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span style={{ ...monoLabel, color: "var(--ink-faint)" }}>
                  {fmtStamp(s.startedAt)}
                </span>
                <span style={{ ...number, fontSize: 13 }}>
                  {fmtDuration(s.durationMs)}
                </span>
                <span style={{ ...number, fontSize: 13, color: "var(--ink-muted)" }}>
                  {s.pageCount}p
                </span>
                <span style={{ ...monoLabel, color: "var(--ink-muted)" }}>
                  {s.entryPath} → {s.exitPath}
                </span>
              </button>

              {openIdx === i && (
                <ol
                  style={{
                    margin: "2px 0 10px 0",
                    padding: "8px 0 8px 18px",
                    listStyle: "none",
                    borderLeft: "2px solid var(--hairline-bold)",
                  }}
                >
                  {s.views.map((v, vi) => (
                    <li
                      key={`${v.enteredAt.toISOString()}-${vi}`}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "70px 1fr 70px",
                        gap: 12,
                        padding: "4px 0",
                      }}
                    >
                      <span style={{ ...monoLabel, color: "var(--ink-faint)" }}>
                        {fmtClock(v.enteredAt)}
                      </span>
                      <span style={{ ...dmBody, color: "var(--ink)" }}>{v.path}</span>
                      <span
                        style={{
                          ...monoLabel,
                          color: "var(--ink-muted)",
                          textAlign: "right",
                        }}
                      >
                        {v.dwellMs == null ? "—" : `${Math.round(v.dwellMs / 1000)}s`}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function fmtStamp(d: Date): string {
  const date = new Date(d)
  const month = date.toLocaleString(undefined, { month: "short" })
  return `${month} ${String(date.getDate()).padStart(2, "0")} · ${fmtClock(date)}`
}

function fmtClock(d: Date): string {
  const date = new Date(d)
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`
}
```

- [ ] **Step 4: Create the top routes panel**

Create `src/components/monitoring/people/top-routes-panel.tsx`:

```tsx
import { fraunces17, monoLabel, number } from "../styles"
import { RegisterMark } from "../register-mark"
import { SYSTEM_INK } from "../system-color"
import type { TopRoute } from "@/lib/monitoring/engagement"

export function TopRoutesPanel({ routes }: { routes: TopRoute[] }) {
  const max = Math.max(1, ...routes.map((r) => r.visits))

  return (
    <section className="inv-panel" style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <RegisterMark color={SYSTEM_INK.auth} size={8} />
        <span style={{ ...fraunces17, fontStyle: "italic", color: "var(--ink)" }}>
          Most visited
        </span>
        <span
          style={{
            ...monoLabel,
            color: "var(--ink-faint)",
            letterSpacing: "0.16em",
            marginLeft: "auto",
          }}
        >
          visits · median dwell
        </span>
      </div>

      {routes.length === 0 ? (
        <p
          style={{
            ...fraunces17,
            fontStyle: "italic",
            color: "var(--ink-muted)",
            marginTop: 12,
          }}
        >
          No page views recorded yet.
        </p>
      ) : (
        <ul style={{ margin: "12px 0 0 0", padding: 0, listStyle: "none" }}>
          {routes.map((r) => (
            <li
              key={r.route}
              className="inv-row"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 60px 70px",
                alignItems: "baseline",
                gap: 12,
                padding: "8px 4px",
              }}
            >
              <span style={{ position: "relative", ...monoLabel, color: "var(--ink)" }}>
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    inset: "-3px auto -3px 0",
                    width: `${(r.visits / max) * 100}%`,
                    background: "rgba(220, 38, 38, 0.07)",
                    zIndex: 0,
                  }}
                />
                <span style={{ position: "relative" }}>{r.route}</span>
              </span>
              <span style={{ ...number, fontSize: 13, textAlign: "right" }}>
                {r.visits}
              </span>
              <span
                style={{ ...monoLabel, color: "var(--ink-muted)", textAlign: "right" }}
              >
                {r.medianDwellMs == null
                  ? "—"
                  : `${Math.round(r.medianDwellMs / 1000)}s`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 5: Rewrite the People page**

Replace `src/app/dashboard/admin/monitoring/people/page.tsx` entirely:

```tsx
import { PresenceList } from "@/components/monitoring/people/presence-list"
import { LoginHistoryTable } from "@/components/monitoring/people/login-history-table"
import { EngagementSummary } from "@/components/monitoring/people/engagement-summary"
import { ActivityCalendar } from "@/components/monitoring/people/activity-calendar"
import { SessionsTable } from "@/components/monitoring/people/sessions-table"
import { TopRoutesPanel } from "@/components/monitoring/people/top-routes-panel"
import { getLivePresence, getLoginHistory } from "@/lib/monitoring/login-audit"
import { getEngagementData } from "@/lib/monitoring/engagement"

export const dynamic = "force-dynamic"

export default async function PeoplePage() {
  const [presence, history, engagement] = await Promise.all([
    getLivePresence(),
    getLoginHistory(100),
    getEngagementData(30),
  ])

  // Sessions are shown for the most recently active user — with one operator
  // that is always the right one, and a per-user picker would be furniture.
  const primary = engagement.summary[0]

  return (
    <div className="flex flex-col gap-6">
      <PresenceList users={presence} />
      <EngagementSummary rows={engagement.summary} />
      <ActivityCalendar days={engagement.activeDays} />
      {primary && (
        <SessionsTable
          sessions={engagement.sessionsByUser[primary.userId] ?? []}
          userName={primary.name}
        />
      )}
      <TopRoutesPanel routes={engagement.topRoutes} />
      <LoginHistoryTable rows={history} />
    </div>
  )
}
```

- [ ] **Step 6: Verify types compile and the suite is green**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors, all tests pass.

- [ ] **Step 7: Verify the page renders, empty and populated**

Run `npm run dev`, sign in as the developer, and open
`/dashboard/admin/monitoring/people`.

Expected: every panel renders. With an empty `PageView` table the three new
panels show their italic empty-state copy rather than crashing or rendering
blank frames. With `TRACK_DEVELOPER_PAGE_VIEWS=1` set and a few pages visited,
the summary shows a session, the calendar shows today's cell filled, the
sessions table expands to a page timeline, and Most Visited ranks routes.

- [ ] **Step 8: Commit**

```bash
git add src/components/monitoring/people src/app/dashboard/admin/monitoring/people/page.tsx
git commit -m "feat(monitoring): People tab becomes an engagement page"
```

---

### Task 8: Bridge engagement tile

**Files:**
- Create: `src/components/monitoring/bridge/engagement-tile.tsx`
- Modify: `src/app/dashboard/admin/monitoring/page.tsx`

**Interfaces:**
- Consumes: `getEngagementHeadline` from `@/lib/monitoring/engagement`; `fmtAgo` from `@/components/monitoring/people/engagement-summary`
- Produces: `<EngagementTile headline={...} />`

- [ ] **Step 1: Create the tile**

Create `src/components/monitoring/bridge/engagement-tile.tsx`:

```tsx
import Link from "next/link"
import { fraunces17, monoLabel, dmBody, number } from "../styles"
import { RegisterMark } from "../register-mark"
import { SYSTEM_INK } from "../system-color"
import { fmtAgo } from "../people/engagement-summary"

type Headline = {
  name: string
  lastSeenAt: Date
  lastPath: string
  sessionsToday: number
} | null

export function EngagementTile({ headline }: { headline: Headline }) {
  return (
    <Link
      href="/dashboard/admin/monitoring/people"
      className="inv-panel"
      style={{
        display: "block",
        padding: "14px 18px",
        textDecoration: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <RegisterMark color={SYSTEM_INK.auth} size={8} />
        <span style={{ ...fraunces17, fontStyle: "italic", color: "var(--ink)" }}>
          Owner activity
        </span>
        <span
          style={{
            ...monoLabel,
            color: "var(--ink-faint)",
            letterSpacing: "0.16em",
            marginLeft: "auto",
          }}
        >
          people →
        </span>
      </div>

      {headline == null ? (
        <p style={{ ...dmBody, color: "var(--ink-muted)", marginTop: 8 }}>
          No page views recorded yet.
        </p>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            marginTop: 8,
            flexWrap: "wrap",
          }}
        >
          <span style={{ ...dmBody, color: "var(--ink)" }}>{headline.name}</span>
          <span style={{ ...monoLabel, color: "var(--ink-faint)" }}>
            last seen {fmtAgo(headline.lastSeenAt)} on {headline.lastPath}
          </span>
          <span style={{ ...number, fontSize: 13, marginLeft: "auto" }}>
            {headline.sessionsToday}
          </span>
          <span style={{ ...monoLabel, color: "var(--ink-faint)" }}>
            sessions today
          </span>
        </div>
      )}
    </Link>
  )
}
```

- [ ] **Step 2: Wire it into the Bridge page**

In `src/app/dashboard/admin/monitoring/page.tsx`, add the imports:

```tsx
import { EngagementTile } from "@/components/monitoring/bridge/engagement-tile"
import { getEngagementHeadline } from "@/lib/monitoring/engagement"
```

Replace the data fetch so the destructuring and the array stay index-aligned:

```tsx
  const [statuses, errorsByHour, aiByHour, loginsByHour, events, headline] =
    await Promise.all([
      getAllSystemStatus(),
      getErrorsByHour(24),
      getAiCostByHour(24),
      getLoginsByHour(24),
      getBridgeEvents(10),
      getEngagementHeadline(),
    ])
```

Then render the tile directly after the health strip:

```tsx
    <div className="flex flex-col gap-3">
      <SystemHealthStrip statuses={statuses} />
      <EngagementTile headline={headline} />
      <Last24hActivity
```

- [ ] **Step 3: Verify types compile and the suite is green**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors, all tests pass.

- [ ] **Step 4: Verify the tile renders**

Run `npm run dev` and open `/dashboard/admin/monitoring`.
Expected: the tile appears under the health strip, shows the empty-state line
against an empty table, and links through to the People tab.

- [ ] **Step 5: Run lint and the full suite before finishing**

Run: `npx next lint && npm test && npx tsc --noEmit`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/monitoring/bridge/engagement-tile.tsx src/app/dashboard/admin/monitoring/page.tsx
git commit -m "feat(monitoring): owner activity tile on the monitoring bridge"
```

---

## Post-implementation notes

- **`.env.local`:** leave `TRACK_DEVELOPER_PAGE_VIEWS=1` set locally if you want to
  keep seeing your own views. Do **not** add it to Vercel — production must
  exclude developer browsing.
- **The panels will look sparse for several days.** That is expected: the table
  starts empty and the engagement question needs a week of real use before it has
  an answer. Resist tuning the layout against thin data.
- **Deferred by decision (from the spec):** rate limiting on the telemetry
  endpoint, and any product-insight framing of `getTopRoutes`.
- **Project 2** — the polish audit across all 8 monitoring tabs — is still
  unwritten and should get its own spec once this data is live.
