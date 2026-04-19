# Architecture Cheat Sheet

> Quick reference for talking through architectural choices. See `architecture-interview-guide.md` for deep-dive details.

---

## The Pitch (30 seconds)

Multi-tenant restaurant analytics platform. Unifies POS financials, delivery platform data (DoorDash/UberEats/Grubhub), Yelp ratings, vendor invoices, and daily ops reports into one dashboard. Syncs from Otter API, matches Yelp via fuzzy search, uses GPT-4o vision to extract invoices from email.

---

## 7 Key Decisions & Why

| # | Decision | Why | Trade-off |
|---|----------|-----|-----------|
| 1 | **Separate route trees by role** (`/dashboard/*` owner, `/manager/*` manager) | Cleaner than role checks in every component; defense in depth — middleware + server action both verify | Some UI duplication, but the two personas have different workflows |
| 2 | **5-phase batch sync with SSE** | Otter API behaves differently per data type — summaries batch all stores, items need per-store calls (discovered empirically) | Runs in a single 120s serverless function; would need a job queue past ~20 stores |
| 3 | **Idempotent upserts on compound unique keys** | Delivery platforms retroactively adjust data (chargebacks, refunds); upsert overwrites stale values safely. 3-day lookback catches late corrections | Slightly more complex than insert-ignore, but correctness matters more |
| 4 | **AI invoice pipeline** (Email → GPT-4o Vision → Levenshtein match → DB) | Handles arbitrary vendor PDF layouts without per-vendor templates; scales to new vendors with zero code changes | ~$0.01-0.05/invoice AI cost; worth it vs. maintaining brittle parsers |
| 5 | **3-tier rate limiting** (strict 2/min, moderate 30/min, auth 10/min) | Prevents burning external API quotas on spam clicks; timing-safe cron bypass | In-memory Map resets on cold start; Redis at scale |
| 6 | **Server actions for CRUD, API routes for streaming** | Server actions = no HTTP overhead, direct Prisma; API routes = SSE, cron access, React Query consumption | Clear split: needs streaming? → API route. Everything else → server action |
| 7 | **TypeScript aggregation over SQL** | Data from two sources (Otter + invoices) joined in app logic; Pareto/ABC analysis more readable in TS; Prisma lacks window functions | Would need materialized views at larger data volumes |

---

## Security (6 Layers)

```
Middleware → Rate Limiter → Server Action → Zod → Prisma → Env Vars
(JWT/role)   (per-tier)    (ownership)    (input) (constraints) (secrets)
```

Any single layer can block a bad request independently.

---

## Scaling Answers (If Asked)

| At current scale (~5-10 stores) | At 1,000+ stores |
|---|---|
| Single serverless function sync | Job queue (Inngest/Bull) |
| In-memory rate limiter | Redis |
| TypeScript aggregation | Materialized views / data warehouse |
| Single DB | Read replica for analytics |

---

## Hard Problems Worth Mentioning

- **Otter API has no docs** — reverse-engineered which `groupBy` keys work per dataset through trial and error
- **Timezone gotcha** — `reference_time_local_without_tz` is local time encoded as UTC epoch; must use `getUTCHours()`, not apply tz conversion
- **Address matching** — Levenshtein with normalization + street number hard-fail covers 90%+ of cases; confidence tiers (MATCHED/REVIEW/PENDING) handle the rest

---

## Stack in One Line

Next.js 15 + React 19 + TypeScript + Prisma/PostgreSQL + next-auth + shadcn/ui + TanStack Query + OpenAI GPT-4o
