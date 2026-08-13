# Owner Engagement Tracking — Design

**Date:** 2026-08-13
**Status:** Approved, pending implementation plan
**Scope:** Project 1 of 2. Project 2 (polish audit across all 8 monitoring tabs) is
deliberately out of scope and gets its own spec.

---

## Problem

The developer monitoring section (`/dashboard/admin/monitoring`, DEVELOPER-gated)
knows a great deal about the machine — job runs, AI spend, errors, cache, DB size,
ML evaluations — and almost nothing about the human. The People tab derives live
presence and login history from `LoginEvent`, which answers "did Chris sign in"
but not "did he do anything once he was in."

The question this design answers is engagement: **is the owner actually using the
dashboard?** How often, for how long, on which days, and what was he looking at
when he was last here.

## Non-goals

- Tracking mutations or business actions (invoice uploads, proposal approvals,
  recipe edits). Page views only.
- Product analytics framing ("which features earn their keep"). The ranked-routes
  panel is a secondary band, not the headline.
- Funnel analysis, friction detection, bounce classification.
- Any visual rework of monitoring tabs other than the People tab and a single new
  Bridge tile.

## Success criteria

1. After a week of real use, the People tab answers — without interpretation —
   when the owner was last active, how many sessions he had, how long they ran,
   which days he was absent, and what page he was on last.
2. No page view is recorded for a DEVELOPER-role session in production.
3. A failure anywhere in the tracking path is invisible to the person being
   tracked: no error toast, no blocked navigation, no slowed render.
4. The panels render correctly against an empty table (the state they will be in
   for their first days in production).

---

## Architecture

### Data model

One new Prisma model. It follows the existing telemetry convention in this schema
(`LoginEvent`, `ErrorEvent`, `AiUsageEvent`): a bare `userId` string with no
foreign-key relation, so a user deletion never cascades away audit history.

```prisma
/// One page view by an authenticated non-DEVELOPER user, written best-effort
/// from the client on navigation and on page hide. `path` is what was visited;
/// `route` is that path with dynamic segments normalized, so aggregate counts
/// group across detail pages. `dwellMs` is null when the flush never landed
/// (browser killed the tab, beacon dropped).
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

**Why two path columns.** Without `route`, every invoice detail page is its own
bucket and any "most visited" ranking fragments into noise. Without `path`, the
session timeline cannot say *which* invoice was open. Aggregate on `route`,
display `path`.

**Why no session table.** Sessions are derived at query time from the ordered view
stream using an inactivity gap. Storing them would add a write-time dependency and
a second source of truth for something a pure function computes in milliseconds
over a few thousand rows.

**Why no `surface` column.** A `/m/*` prefix already identifies mobile. Derived in
the query layer.

### Write path

**Client:** `src/components/telemetry/page-view-tracker.tsx` — a client component
rendering `null`, mounted in `src/app/dashboard/layout.tsx` and
`src/app/(mobile)/m/layout.tsx`. Both layouts already resolve the session, so each
passes `enabled={session?.user.role !== "DEVELOPER"}`; when false the tracker does
not mount and issues no requests.

State lives in a ref: `{ path, enteredAt, flushed }`.

- On `usePathname()` change: flush the *previous* entry with
  `dwellMs = now - enteredAt`, then start a new entry.
- On `pagehide`, and on `visibilitychange` transitioning to hidden: flush the
  current entry.
- Flush uses `navigator.sendBeacon` when available (it survives unload), falling
  back to `fetch(url, { method: "POST", keepalive: true })`.
- The `flushed` flag makes flush idempotent per entry, so a `pagehide` immediately
  followed by unmount writes once, not twice.
- A mount guard absorbs React strict-mode's double effect invocation in dev.

**Server:** `POST /api/telemetry/page-view`.

The route mirrors `recordLoginEvent`'s discipline: **it never throws and always
responds 204**, whether or not it wrote a row. Tracking failure must never become
the user's problem, and must never generate error-event noise of its own.

It no-ops (204, no write) when any of these hold:

| Condition | Rationale |
|---|---|
| No session | Unauthenticated noise |
| `role === "DEVELOPER"` | Developer browsing is excluded by decision |
| `path` outside `/dashboard` or `/m` | Only app surfaces are tracked |
| zod parse failure | Malformed or hostile body |
| Any thrown error | Caught, logged to console, swallowed |

Validation and sanitization on the accepted path:

- Body: `{ path: string, enteredAt: number (epoch ms), dwellMs: number | null }`,
  parsed with zod v4 (already a project dependency).
- `path` truncated to 200 characters.
- `dwellMs` clamped to `[0, 4h]`. A tab left open across a weekend is not ten
  hours of engagement, and the clamp is what keeps the headline "total minutes"
  number honest.
- `enteredAt` more than 5 minutes in the future or more than 24 hours in the past
  falls back to server `now()`. The client supplies this value, so it is treated
  as a hint rather than a fact.
- `route` is computed server-side via `normalizeRoute(path)`. Never trusted from
  the client.

**Local development escape hatch.** Because the developer role is excluded, the
developer cannot exercise this feature by using it. `TRACK_DEVELOPER_PAGE_VIEWS=1`
in `.env.local` makes the route accept DEVELOPER views. It is never set in
production, and the client-side `enabled` prop honors it too so the tracker
actually mounts locally.

**Accepted risk:** no rate limiting on the endpoint. Writes are bounded by human
navigation — one per page change plus one per hide. A runaway client loop could
generate write volume; the mitigation if that ever appears is a per-user
per-minute cap, not built now.

### Query layer — `src/lib/monitoring/engagement.ts`

Two pure functions carry the real logic and are tested without a database:

- **`normalizeRoute(path): string`** — collapses dynamic segments against a known
  list of dynamic bases (orders, invoices, pnl, and their `/m` equivalents),
  falling back to a pattern match for cuid/uuid/numeric segments. Returns e.g.
  `/dashboard/orders/[id]`.
- **`groupIntoSessions(orderedViews, gapMs = 30 * 60_000): Session[]`** — a new
  session starts when the gap between one view's end and the next view's
  `enteredAt` exceeds `gapMs`. Returns `{ startedAt, endedAt, durationMs,
  pageCount, entryPath, exitPath, views }`.

Prisma-backed queries built on those:

| Function | Returns |
|---|---|
| `getEngagementSummary(days)` | Per user: last seen, last path, session count, total minutes, active days, current consecutive-day streak |
| `getSessions(userId, limit)` | Derived sessions, newest first |
| `getSessionTimeline(userId, sessionStart)` | Ordered views within one session, with per-page dwell |
| `getActiveDays(days)` | Per-day view counts for the heatmap strip |
| `getTopRoutes(days)` | Ranked routes with visit count and median dwell |

### UI

**People tab** (`src/app/dashboard/admin/monitoring/people/page.tsx`) becomes the
engagement page, top to bottom:

1. `PresenceList` — kept as-is, who is online now
2. `EngagementSummary` — per-user cards: last seen, last path, sessions today,
   total minutes, active-day streak
3. `ActivityCalendar` — 90-day active-day heatmap strip
4. `SessionsTable` — rows expand to reveal the ordered page timeline with dwell
5. `TopRoutesPanel` — ranked routes, count, median dwell
6. `LoginHistoryTable` — kept, moves to the bottom

**Bridge index** (`src/app/dashboard/admin/monitoring/page.tsx`) gains one tile:
*"Chris — last seen 14m ago on /pnl · 2 sessions today"*, linking to the People
tab. This is the only Bridge change in this project.

**Styling.** Editorial tokens only, via the existing
`src/components/monitoring/styles.ts` and `monitoring.css` — `--ink`,
`--ink-muted`, `--paper`, `--hairline`, `--accent`. No generic Tailwind color
utilities on dashboard routes (CLAUDE.md tripwire #1). Numbers render in DM Sans
500–600 with tabular lining numerals; captions and paths in JetBrains Mono
(tripwire #2). Panels are `.inv-panel`, not shadcn `<Card>` (tripwire #4).

**Empty states.** Every panel renders editorial "no data yet" copy against an
empty table. This is the state they will be in for their first days in production,
so it is a first-class case, not an afterthought.

### Migration and retention

Schema change applies via `prisma db push` plus a hand-written
`prisma/manual-migrations/2026-08-13_page_view.sql`. **Never `prisma migrate dev`**
— it would reset the Neon production database.

`prisma.pageView.deleteMany({ where: { enteredAt: { lt: cutoff } } })` joins the
existing 90-day sweep in `src/app/api/cron/monitoring/cleanup/route.ts`, and
`pageView` is added to that route's returned `deleted` counts.

Volume estimate: one active owner at a few hundred views per day is roughly
20–30k rows at 90-day retention. Negligible for Neon; no rollup table needed.

---

## Error handling

| Failure | Behavior |
|---|---|
| Beacon dropped / tab killed | The entry's `dwellMs` stays null. Queries treat null dwell as "unknown", excluded from duration sums rather than counted as zero. |
| API route throws | Caught, `console.error`, 204 returned. No `ErrorEvent` written — tracking must not generate the noise it is meant to help you read. |
| Clock skew or hostile `enteredAt` | Falls back to server time outside the ±window. |
| Empty `PageView` table | Panels render editorial empty states. |
| User deleted | Rows persist (no FK). Summary shows the raw `userId` when no user record resolves. |

## Testing

Unit tests, no database:

- `normalizeRoute` — dynamic bases, cuid/uuid/numeric segments, mobile paths,
  already-normalized input, trailing slashes, query strings.
- `groupIntoSessions` — exact gap boundary on both sides, single view, empty
  input, null `dwellMs`, views spanning midnight.

Contract tests with mocked Prisma (per `docs/refactor-playbook.md`):

- `POST /api/telemetry/page-view` — each no-op branch asserts *no write occurred*,
  not merely a 204; the happy path asserts the persisted row's shape; the clamp
  and the `enteredAt` fallback assert their corrected values.

Manual verification: set `TRACK_DEVELOPER_PAGE_VIEWS=1` locally, navigate several
dashboard pages, confirm rows land with plausible dwell values and that the People
tab renders them.

---

## Open decisions deferred

- Rate limiting on the telemetry endpoint (see accepted risk above).
- Whether `getTopRoutes` should eventually feed a product-insight view. Out of
  scope; the engagement framing leads here by decision.
