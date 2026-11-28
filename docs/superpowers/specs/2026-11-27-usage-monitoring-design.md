# Usage monitoring: who uses what, and how close to each limit

Date: 2026-11-27. Status: approved by the owner 2026-11-27 ("build it out
and get it live"). Plan: `docs/superpowers/plans/2026-11-27-usage-monitoring.md`.

Mock (desk and phone, five tabs): https://claude.ai/artifact/Pm5K7tqfTHdXB5SoNkGCz6

## Why

The owner cannot see which limits the app is close to, what it uses each
day, or which part of the app uses it. Three outages in three months came
from a limit nobody was watching: Neon data transfer (2026-09-02), Neon
compute (2026-11-26) and Vercel function time at 91% (2026-11-27). The
existing Monitoring pages show database size, R2 size, AI spend and job
runs, but not usage against plan limits and nothing per source.

## Goals

1. One page that answers "is anything close to a limit?" in one sentence.
2. Each day's load split by source: TV screens, dashboard, phone app, crew
   checks, scheduled syncs, Ask.
3. Every outside service the app calls (15 today), with its limits, usage,
   refused calls, bill and when its key ends.
4. A history by day, so a change in usage can be tied to a date.

## Non-goals

- Alerts by email or text. The page first; alerts are a later change.
- Per-user or per-store billing.
- Replacing the Bridge, People, Model, Ingredients or Activity pages.

## Anti-goals

- Recording must not spend what is short. No extra database wake-up, no
  Redis command per request, no measurable rise in Vercel CPU.
- A failure in counting must never fail or slow a request.
- No figure shown as fact when it is an estimate. Estimates are labelled.

## What was checked on 2026-11-27

| Service | Plan | Can its own usage be read by API? |
|---|---|---|
| Vercel | Hobby (team `chopsquads-projects`) | No. Per-route metrics need Pro with Observability Plus (402). Billing charges return 404. |
| Neon | Launch (org `org-broad-frog-17155209`, project `square-frog-55305055`) | Yes: compute seconds, storage, data transfer, daily and hourly. |
| Upstash Redis | Free, 500,000 commands a month | Yes: 47,986 used this month. |
| Resend | Free, 100 a day and 3,000 a month | Yes: 27 this month. |
| Pusher | Free (to confirm) | Open channels by REST (already used by `liveTvs`). Message totals not checked. |
| OpenAI, Gemini | Pay as you go | Already recorded per call in `AiUsageEvent`. |
| GitHub | Public repo | Yes, through the Actions API. |
| Cloudflare R2 | Free allowance: 10 GB stored, 1 million writes and 10 million reads a month (billing page not readable by API, so the plan itself is to confirm) | Yes, through Cloudflare's GraphQL analytics: size and object count by day, operations by type and day. Bucket `chrisneddys` on 2026-11-27: 891 MB in 2,497 objects (9% of 10 GB); November so far about 830 writes and 600 reads. |
| Microsoft 365, Otter, Harri, PredictHQ, Open-Meteo, shop site | n/a | Not checked. Counted by our own calls. |

R2 grew 7 MB a day until 2026-11-22 and about 55 MB a day since. The date
matches the nightly database backup (`db-backup.yml`, one upload of about
48 MB a night, newest 30 kept), so it should level off near 2.2 GB around
2026-12-23. This is read from the timing, not from listing the bucket; the
Days tab will show it either way. The bucket has no public address and the
Cloudflare account has no domains, so R2 is the only Cloudflare usage.

Two existing figures are wrong and are fixed as part of this work:
`redis-stats.ts` assumes 500,000 commands a day (the limit is a month), and
`db-stats.ts` labels a 512 MB cap "Neon free tier" (production is Launch).

## Approaches

1. **Count everything inside the app, written as it happens.** Exact, but a
   Redis command or database write per request, on paths that were just made
   cheap. Rejected: breaks the first anti-goal.
2. **Read only what each service reports.** Free on the hot path, but
   Vercel reports nothing on this plan and no service knows our sources.
   Rejected: cannot meet goal 2, and cannot watch the limit closest to its
   cap.
3. **Count in memory, flush rarely, and use each service's own total where
   it has one.** Picked by the owner ("cheap and accurate").

## Design

### Sources

One function, `sourceOf(pathname, referer)`, in `src/lib/usage/source.ts`:

| Source | Paths |
|---|---|
| tv | `/api/tv/**`, `/tv/**` |
| crew | `/checks/**`, `/api/checks/**` |
| phone | `/m/**` |
| ask | `/api/chat/**`, `/api/ask/**` and the Ask pages |
| sync | `/api/cron/**`, and every script run by GitHub Actions |
| dashboard | `/dashboard/**` and everything else signed in |
| other | anything unmatched (sign-in, static, unknown) |

A server action or API call made from a page takes that page's source from
its referer. The root span does not carry the referer, so `src/proxy.ts`
(whose matcher covers everything but static assets) stamps the source into a
request header and the meter reads that. The mapping has a test listing every route in `src/app`, so a
new route cannot land in "other" unnoticed.

### Counting (`src/lib/usage/meter.ts`)

A map in memory, per running instance, keyed by hour, source and metric:

- `calls`, `wallMs` per request
- `dbQueries` (a Prisma client extension, applied to both clients: the
  shared one in `src/lib/prisma.ts` and Ask's own in
  `src/lib/chat/prisma-chat.ts`)
- `redisCommands` (a thin wrapper around the client from `getRedis()`,
  the one place it is built, counting each command in the four pipeline
  sites; the Upstash host is left out of `out:*` so it is not counted twice)
- `out:<service>` and `out:<service>:refused` for each outside call
  (status 429 or 5xx), by host
- `cpuMs` per instance, from `process.cpuUsage()` between flushes. This is
  the app's own measure of Vercel Active CPU, since Vercel will not report it.
  The total is measured. Its split by source cannot be measured, because one
  instance serves several requests at once, so the split is each source's
  share of time spent in requests and the page labels it "estimated".

How a request gets its source: `instrumentation.ts` registers a small
tracer with one span processor that only counts and exports nothing. Next
emits a root span per request carrying `next.route` and `http.target`, and
a span per `fetch` carrying the host. The processor keeps a map from trace
to source for open requests; the Prisma extension and Redis wrapper look
up the active trace. (This adds `@opentelemetry/api`, today only present as someone else's
dependency at 1.9.1, and `@opentelemetry/sdk-trace-base`. The tracer is
registered in the existing `src/instrumentation.ts`, after the error
recorder that is already there.) Scripts on GitHub Actions have no Next tracer. They set the source to
`sync` once at start and count outside calls through a wrapper on the global
`fetch`. R2 goes through the S3 client, not `fetch`, so it is counted by a
middleware on that client in `src/lib/blob.ts`.

Step 1 of the build is a spike that proves this on a preview deploy and
measures CPU per request before and after. It must also assert that the
fetch span carries the response status, which Next sets but does not
document; refused calls depend on it. (Read in the installed Next 16.4.6
on 2026-11-27: `patch-fetch.js` sets `http.status_code`, `http.url` and
`net.peer.name` on the fetch span, and the root span carries `next.route`
and `http.target`. Reading the source is not the same as seeing it on a
deploy, so the spike still asserts it.) If it costs more than 2%, or the
spans do not carry what the guide says, fall back to an explicit
`metered(source, handler)` wrapper on route handlers and the two layouts.

### Flushing

- On Vercel: when an instance's oldest unflushed count is over 5 minutes
  old, the next request flushes after its response with one Redis command, held
  open by `waitUntil` from `@vercel/functions` (`after()` needs request
  scope, which the span processor does not have)
  (`RPUSH usage:pending <json>`). At most 12 commands an hour per live
  instance, about 9,000 a month for one instance always up, against 450,000
  spare. An instance recycled before flushing loses at most 5 minutes of its
  own counts; the page says counts are within that margin.
- On GitHub Actions: scripts flush once at exit, same command.
- Redis missing, slow or failing: counts are dropped, the request is
  untouched.

### Roll-up (every two hours, on GitHub Actions)

A new step at the end of `otter-hourly-sync.yml`, the one regular job that
already opens the database (every two hours from 10 am to 2 am store time),
so it adds no wake-up. `sync-ticker.yml` only starts other workflows and
never opens the database itself. Nothing is lost between runs: each flush
carries its hour, and counts wait in Redis until drained. So that today's
figures are not two hours old, the page also reads the waiting counts when a
developer opens it (one Redis command per open) and adds them in.

1. Drain `usage:pending` (two commands) and add into `UsageHour`.
2. Read service totals: Neon consumption, Upstash stats, Resend usage,
   R2 size and operations, Pusher open channels, GitHub Actions minutes and
   late starts. Write into `ServiceUsage`.
3. Each service read is independent; one failing is recorded and skipped.

New secrets for that job: a Neon API key for the org, an Upstash management
key, and a Cloudflare API token that can only read account analytics (the
R2 keys the app has today can read and write objects but cannot read
analytics). Resend and Pusher keys exist already.

R2's own total replaces the daily `r2-snapshot.yml` walk of the whole bucket
for size and count. The walk stays for now because it also gives the split
by folder, which Cloudflare does not report.

### Tables (`prisma db push` plus a hand-written migration)

- `UsageHour(hour, source, metric, value)`, unique on the first three.
  About 7 sources x 25 metrics x 24 hours = 4,200 small rows a day at most;
  the retention job rolls hours older than 35 days into `UsageDay`.
- `UsageDay(date, source, metric, value)`.
- `ServiceUsage(capturedAt, service, metric, value)`, one row per metric per
  roll-up.
- `ServiceKey(service, label, endsAt, note)`, edited on the page. Holds no
  secret, only the date.

These are app-wide, not per account: one deployment, one set of limits. The
page stays developer-only, so no `accountId` filter applies. The TV and
store breakdowns join `Screen` and `Store` through `accountId` as usual.

### Limits

`src/lib/usage/limits.ts`: one list of `{ service, metric, limit, period,
plan, source: "plan" | "ours" | "guess" }`. The page shows a limit marked
"guess" as "to confirm". Watch at 70%, Act now at 90%; a key goes to Watch
60 days before it ends. This file is the only place a limit is written;
`redis-stats.ts` and `db-stats.ts` read from it.

### Which figures are exact

| Figure | Where it comes from |
|---|---|
| Neon compute, transfer, size | Neon's own total |
| Redis commands | Upstash's own total; the split by source is our count |
| Emails | Resend's own total |
| R2 size, writes, reads | Cloudflare's own total; the split by source is our count |
| AI spend | `AiUsageEvent`, per call |
| Vercel CPU | Our measure, labelled "measured by the app". The owner can type in Vercel's dashboard figure to see the gap. |
| Vercel requests, outside calls, Pusher messages | Our count |

### The page

`/dashboard/admin/monitoring/usage` and `/m/monitoring/usage`, developer
only, added to `MONITORING_TABS`. Built with the `counter-page` skill:

- Head: answer sentence, the closest limit as the big number with last
  month's value, freshness, status in words.
- Tabs, as links with `?tab=`: Summary (flow of sources into Vercel CPU,
  database, Redis and Pusher; closest four limits; today by hour), Sources
  (six cards; the TV card shows the check-in path), Services (top eight,
  "Show all 15", detail beside), Live (database connections; TVs with a
  socket open, read from Pusher), Days (month grid, per-source breakdown).
- Phone: same five tabs; stacked bars instead of the flow.
- Motion: bars and numbers ease in once. The flowing dashes in the mock are
  kept only with the "Pause live view" control and reduced-motion off, per
  DESIGN.md Motion. The page never refreshes itself; Live has a Refresh
  button.
- One adapter, `src/lib/counter/adapters/monitoring-usage.ts`, exporting
  `getUsageSectionPromises()`; one load for the widest span, sliced per tab
  (`docs/query-rules.md`).

It joins the existing eight Monitoring pages as a ninth. Folding Infra,
Costs and Cache into it is a follow-up, once the owner has used it.

## Build order

1. Spike: tracer and CPU cost on a preview deploy. Decide tracer or wrapper.
2. `source.ts`, `meter.ts`, flush, with tests. Ship dark (counting, no page).
3. Tables, roll-up job, service readers, limits file. Fix the two wrong
   limits.
4. Page, desk and phone, from the mock. Fidelity check for the page.
5. After a week of data: compare our Vercel CPU against Vercel's dashboard
   and state the gap on the page.

## Calls made after the builder check

- Roll-up rides on the Otter sync every two hours, not hourly, to add no
  database wake-up. The page reads waiting counts for freshness.
- Vercel CPU by source is an estimate and labelled so; the total is measured.
- Flush uses `waitUntil`, not `after()`.
- The source reaches the meter through a header set in `src/proxy.ts`.
  (Changed in the plan, 2026-11-27: Next hands every request's headers to
  the registered propagator, so the meter reads `referer` there and the
  proxy is not touched. The header stays as the fallback if the spike
  shows otherwise.)
- Scripts and R2 are counted by their own small wrappers, not the tracer.
- Only `MONITORING_TABS` needs the new entry; the phone list is derived from
  it. The phone page lives under `src/app/(mobile)/m/(counter)/monitoring/`.

## Left to the builder

- Exact metric names and the JSON shape of a flush.
- Whether the roll-up is a script or a `/api/cron` route (a script is
  preferred: no Vercel CPU).
- Icons and the flow drawing's geometry.

## Open questions for the owner

1. Pusher's plan, and whether Vercel stays on Hobby. On Pro, Vercel's own
   per-route figures would replace our CPU measure.
2. Is the repository meant to stay public? Free Actions minutes depend on it.
3. Cloudflare: the read-only analytics token has to be made in the
   Cloudflare dashboard by the account holder and added as a GitHub secret.
   The billing page there also settles whether R2 is on the free allowance.
