# Architectural Design: Multi-Tenant Restaurant Analytics Platform

> Interview-ready system design walkthrough for a production Next.js 15 restaurant management SaaS with external API integrations, AI-powered invoice processing, and real-time analytics.

---

## 1. System Overview (The 30-Second Pitch)

"I built a multi-tenant restaurant management platform that unifies financial data from first-party POS systems and third-party delivery platforms (DoorDash, UberEats, Grubhub), customer ratings, vendor invoices, and daily operational reports into a single analytics dashboard. It syncs data from Otter's analytics API, matches Yelp business listings via fuzzy search, and uses GPT-4o vision to extract structured data from vendor invoice PDFs pulled from Microsoft Graph email."

**Key numbers to mention:**
- 15 Prisma models with compound unique constraints for idempotent syncs
- 5-phase batch sync pipeline with SSE progress streaming
- 3-tier rate limiting (strict / moderate / auth)
- AI-powered invoice extraction with Levenshtein address matching for auto store assignment
- Role-based access control (OWNER / MANAGER) with middleware-enforced routing

---

## 2. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Vercel Edge / CDN                          │
│  (Static assets, ISR-cached pages, edge middleware)           │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────┐
│              Auth Middleware (next-auth + withAuth)            │
│  JWT validation → Role check → Route enforcement              │
│  MANAGER → /manager/*    OWNER → /dashboard/*                 │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────┐
│              Next.js 15 App Router (Server)                   │
│                                                               │
│  ┌─────────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Server Actions   │  │  API Routes  │  │  SSE Streaming │  │
│  │ (CRUD, analytics │  │ (sync, auth, │  │  (sync progress│  │
│  │  mutations)      │  │  webhooks)   │  │   events)      │  │
│  └────────┬────────┘  └──────┬───────┘  └───────┬────────┘  │
│           │                  │                   │            │
│  ┌────────▼──────────────────▼───────────────────▼────────┐  │
│  │              Rate Limiting Middleware                    │  │
│  │  Strict (2/min) │ Moderate (30/min) │ Auth (10/min/IP)  │  │
│  └────────────────────────┬───────────────────────────────┘  │
└───────────────────────────┼──────────────────────────────────┘
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
┌─────────▼──────┐ ┌───────▼───────┐ ┌───────▼──────────────┐
│   PostgreSQL   │ │  External APIs │ │    AI Services        │
│   (Prisma ORM) │ │               │ │                       │
│                │ │ Otter API     │ │ OpenAI GPT-4o Vision  │
│ 15 models      │ │ (financials,  │ │ (invoice PDF → JSON)  │
│ Compound keys  │ │  menu, orders,│ │                       │
│ Cascading      │ │  ratings)     │ │ OpenAI GPT-4o         │
│ deletes        │ │               │ │ (anomaly explanation) │
│                │ │ Yelp API      │ │                       │
│                │ │ (ratings,     │ └───────────────────────┘
│                │ │  fuzzy match) │
│                │ │               │
│                │ │ Microsoft     │
│                │ │ Graph API     │
│                │ │ (email/PDF    │
│                │ │  ingestion)   │
│                │ └───────────────┘
└────────────────┘
```

---

## 3. Key Architectural Decisions (Talk About Trade-offs)

### 3a. Multi-Tenant Data Model with Role-Based Access

**What:** Two roles (OWNER, MANAGER) with completely separate route trees and data visibility. Middleware enforces routing; every server action re-checks ownership.

```
OWNER → /dashboard/*  (sees all their stores, managers, analytics)
MANAGER → /manager/*  (sees only assigned stores, can submit reports)
```

**Data scoping pattern:**
```typescript
// Same function, different queries based on role
const stores = session.user.role === 'OWNER'
  ? await prisma.store.findMany({ where: { ownerId: session.user.id } })
  : await prisma.store.findMany({
      where: { managers: { some: { managerId: session.user.id, isActive: true } } }
    })
```

**Why this design:**
- **Defense in depth** — middleware blocks the route, but every server action independently verifies ownership. If middleware has a bug, the action still rejects unauthorized access.
- **Soft-deactivation** — `StoreManager.isActive` lets you revoke a manager's access without deleting history. Their past reports remain linked.
- **Single table for users** — OWNER and MANAGER share the `User` model with a `role` enum. No separate tables, no JWT role confusion.

**Trade-off:** Two separate route trees (`/dashboard/*` vs `/manager/*`) means some UI duplication. But it's cleaner than littering every component with role checks, and the two personas have genuinely different workflows.

**Interview angle:** "This is similar to how game studios separate player-facing and admin tools — same database, different access layers, defense in depth."

---

### 3b. Five-Phase Batch Sync Pipeline with SSE Streaming

**What:** The Otter sync is a single API route that executes 5 sequential phases, each with its own concurrency model, writing progress events to the client via Server-Sent Events.

```
Phase 1: Daily Summaries   (20% weight) — 1 API call, all stores batched
Phase 2: Menu Categories    (15% weight) — 1 call/day, all stores via groupBy
Phase 3: Menu Items         (30% weight) — 1 call/store/day (API limitation)
Phase 4: Modifiers          (20% weight) — 1 call/store/day (API limitation)
Phase 5: Ratings            (15% weight) — 1 call/store, 21-day lookback
```

**Why different strategies per phase:**
Discovered empirically — Otter's API returns 500 errors when using `store` in `groupBy` for item-level data, but works fine for daily summaries and categories. So phases 1-2 batch all stores in one call, while phases 3-5 fan out per-store.

**The worker pool (`withConcurrency`):**
```typescript
async function withConcurrency<T>(tasks, limit, onProgress) {
  const results = new Array(tasks.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++  // safe — JS is single-threaded
      results[index] = await tasks[index]()
      onProgress?.(++completed, tasks.length)
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()))
  return results
}
```

- `nextIndex++` is atomic in single-threaded JS — no mutex needed
- Results stay ordered via index assignment despite async completion
- Backpressure is automatic — workers don't grab next task until current resolves

**SSE progress streaming:**
```typescript
// Content negotiation — same endpoint, two response modes
if (request.headers.get("accept")?.includes("text/event-stream")) {
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event) => controller.enqueue(`data: ${JSON.stringify(event)}\n\n`)
      await runSync(emit)
      controller.close()
    }
  })
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } })
}
// JSON fallback for cron jobs
const result = await runSync(() => {})
return NextResponse.json(result)
```

**Trade-off:** Running the entire sync in a single 120-second serverless function is simple but has a hard ceiling. With ~5-10 stores it completes in ~30-60 seconds. Beyond ~20 stores, this would need a job queue (Bull, Inngest).

**Interview angle:** "This is like a game server's tick loop — multiple subsystems (physics, AI, networking) processed sequentially within a fixed time budget, with progress reported to clients."

---

### 3c. Idempotent Upserts with Compound Unique Constraints

**What:** Every sync write uses Prisma `upsert` keyed on compound unique constraints, making syncs safely re-runnable.

```typescript
prisma.otterDailySummary.upsert({
  where: {
    storeId_date_platform_paymentMethod: { storeId, date, platform, paymentMethod }
  },
  create: { storeId, date, platform, paymentMethod, ...fields },
  update: fields,  // overwrite with latest
})
```

**Compound keys across models:**
| Model | Unique Key | Purpose |
|-------|-----------|---------|
| `OtterDailySummary` | `(storeId, date, platform, paymentMethod)` | One row per store/day/platform/payment combination |
| `OtterMenuCategory` | `(storeId, date, category)` | One row per store/day/category |
| `OtterMenuItem` | `(storeId, date, category, itemName, isModifier)` | Items vs modifiers separated |
| `OtterRating` | `(storeId, externalReviewId)` | Dedup reviews by external ID |
| `DailyReport` | `(storeId, date, shift)` | One report per store/shift/day |
| `Invoice` | `(emailMessageId)` | Dedup invoices by source email |

**Why upsert over insert-on-conflict-ignore:**
Delivery platforms retroactively adjust financial data (chargebacks, refund corrections). We *want* to overwrite stale values. A 3-day lookback window catches these late adjustments.

**Batch transaction pattern:**
```typescript
for (let i = 0; i < records.length; i += 50) {
  const batch = records.slice(i, i + 50)
  try {
    await prisma.$transaction(batch.map(record => prisma.model.upsert(...)))
    synced += batch.length
  } catch (err) {
    failed += batch.length  // batch isolation — other batches continue
  }
}
```

**Trade-off:** Batches of 50 balance throughput vs transaction duration. 1 = too many round trips. 1000 = long locks, timeout risk. 50 is pragmatic.

**Interview angle:** "This is the same principle as game server state reconciliation — the authoritative source overwrites stale client state, and idempotent operations mean retries are safe."

---

### 3d. AI-Powered Invoice Pipeline (Email → PDF → Structured Data → Store Match)

**What:** A 4-phase pipeline that pulls vendor invoices from email, extracts structured data via GPT-4o vision, fuzzy-matches delivery addresses to stores, and writes to the database.

```
Microsoft Graph API (emails with PDF attachments)
  → GPT-4o Vision (PDF → structured JSON)
    → Levenshtein address matching (delivery address → store)
      → Prisma create with nested line items
```

**Phase 1 — Email Fetching (Microsoft Graph):**
- Azure OAuth2 client credentials flow with token caching (5-min buffer)
- Filters: `hasAttachments eq true`, excludes subjects like "weekly statement", "tracking"
- Lookback: 30 days on first sync, 7 days on subsequent
- Pre-dedup: checks `emailMessageId` in DB before extraction

**Phase 2 — PDF Extraction (GPT-4o Vision):**
- Base64 PDF sent to OpenAI's vision API
- Prompt engineered for restaurant vendor invoices:
  - Vendor-specific SKU patterns (Sysco 7-digit, US Foods 7-8 digit)
  - Category classification (Meat, Poultry, Seafood, Produce, Dairy, etc.)
  - Validates `extendedPrice = quantity x unitPrice`
  - Extracts **delivery address** (not billing) — critical for store matching
- 3 concurrent extractions, 60s timeout each

**Phase 3 — Address Matching (Levenshtein):**
```typescript
normalizeAddress("123 N. Main St., Ste 4B")
  → "123 n main street"  // strip punctuation, expand abbreviations, remove unit

addressSimilarity("123 main street", "123 main st")
  → 0.95  // high similarity after normalization

// Hard fail: street numbers must match exactly
addressSimilarity("123 main street", "456 main street")
  → 0.0   // different street numbers = instant zero
```

| Confidence | Status Assigned |
|-----------|----------------|
| >= 0.85   | `MATCHED` — auto-assigned to store |
| >= 0.70   | `REVIEW` — needs human confirmation |
| < 0.70    | `PENDING` — no match attempted |

**Phase 4 — Database Write:**
- Vendor name normalized via prefix matching ("sysco" → "Sysco")
- Nested create: `Invoice` + `InvoiceLineItem[]` in one Prisma call
- `rawExtractionJson` stored for debugging/auditing
- `emailMessageId` unique constraint catches race conditions

**Trade-off:** GPT-4o vision is expensive (~$0.01-0.05 per invoice) but handles arbitrary vendor layouts. A rules-based PDF parser would need per-vendor templates and break on layout changes. The AI approach scales to any vendor without code changes.

**Interview angle:** "This is a classic ETL pipeline with an AI transformation layer — similar to how game analytics pipelines extract structured events from unstructured telemetry data."

---

### 3e. Three-Tier Rate Limiting

**What:** In-memory rate limiter with three tiers, applied at the API route level.

```typescript
const RATE_LIMIT_TIERS = {
  strict:   { limit: 2,  windowMs: 60_000 },  // Otter/Yelp/Invoice sync
  moderate: { limit: 30, windowMs: 60_000 },  // CRUD, analytics
  auth:     { limit: 10, windowMs: 60_000 },  // Login attempts (keyed by IP)
}
```

**Key design choices:**
- **Cron bypass:** Vercel cron requests include a Bearer token checked with `timingSafeEqual` — prevents timing attacks on the cron secret
- **Cleanup:** Map entries purged every 60 seconds to prevent memory leaks
- **Identification:** User ID from session for authenticated routes, IP for auth routes
- **Headers:** Returns `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`

**Trade-off:** In-memory Map means rate limits don't persist across serverless cold starts or multiple instances. For the current scale (~5-10 stores, single owner), this is fine. At scale, Redis would replace the Map.

**Interview angle:** "Rate limiting external API syncs is critical — if an owner spam-clicks the sync button, you don't want to burn through Otter's API quota or trigger their rate limiter."

---

### 3f. Server Actions vs API Routes (When to Use Which)

**Server Actions** — for mutations and data fetching that don't need streaming:
```typescript
"use server"
export async function createStore(formData: FormData) {
  const session = await getServerSession(authOptions)
  const validated = storeSchema.parse(...)
  const store = await prisma.store.create({ data: validated })
  revalidatePath("/dashboard/stores")
  return { success: true, store }
}
```
- 16 server action files covering CRUD, analytics, recipes, ratings
- Direct Prisma access, no HTTP overhead
- `revalidatePath()` for instant cache invalidation

**API Routes** — for external triggers, streaming, and webhooks:
- `POST /api/otter/sync` — SSE streaming, cron-triggered, 120s max duration
- `POST /api/invoices/sync` — SSE streaming, long-running
- `POST /api/yelp/sync` — batch processing with external API calls
- `GET/POST /api/stores` — used by TanStack Query hooks for client-side caching

**The split:** If the UI calls it directly and doesn't need streaming → server action. If it needs SSE, cron access, or is consumed by React Query → API route.

**Interview angle:** "This is about choosing the right tool — server actions eliminate boilerplate for simple mutations, while API routes handle the cases that need HTTP-level control like streaming and content negotiation."

---

### 3g. Analytics Aggregation: Product Mix Analysis

**What:** Server actions perform complex aggregation in TypeScript rather than SQL, enabling Pareto/ABC analysis, price-volume matrices, and period-over-period comparisons.

**Pareto (ABC) Analysis:**
```
Sort items by revenue descending
A class: items contributing to first 80% of revenue
B class: items contributing to next 15%
C class: remaining 5%
→ "5 items generate 80% of revenue"
```

**Price-Volume Matrix (Boston Matrix variant):**
```
              High Price
                  │
    Puzzles       │      Stars
    (high price,  │  (high price,
     low volume)  │   high volume)
──────────────────┼──────────────────
    Dogs          │    Workhorses
    (low price,   │  (low price,
     low volume)  │   high volume)
                  │
              Low Price
```

**Why aggregate in TypeScript, not SQL:**
- The data comes from two sources (Otter API data in DB + invoice line items) that need to be joined in application logic
- Complex transformations (Pareto bucketing, period-over-period %) are more readable in TypeScript
- Prisma doesn't support window functions or CTEs — raw SQL would lose type safety

**Trade-off:** For large datasets, this should move to SQL materialized views or a data warehouse. At current scale (~50-200 menu items per store), in-memory aggregation is fast enough.

---

## 4. Data Flow Deep-Dive: Daily Report Submission

Walk through a concrete user action to show how layers interact:

```
1. Manager opens /manager/report → middleware checks JWT role === MANAGER
2. DailyReportForm renders with manager's assigned stores (from StoreManager)
3. Manager fills out:
   - Store selector, shift (MORNING/EVENING/BOTH)
   - Starting/ending cash amounts, total sales, cash/card split
   - Prep completion % (0-100) for morning and evening
   - Individual prep task checkboxes (meat, sauce, onions, etc.)
4. Form submission → Zod validates:
   - Percentages 0-100, amounts non-negative
   - Shift enum matches allowed values
5. Server action verifies:
   - Session is valid, user role is MANAGER
   - Manager has active StoreManager record for this store
6. Prisma upsert with unique key (storeId, date, shift):
   - First submission → create
   - Re-submission same shift → update (idempotent)
7. PrepTaskStatus records created/updated for each task
8. revalidatePath('/manager/report') → cache busted
9. Owner's /dashboard analytics reflect new data on next load
```

**Why upsert for reports:** A manager might submit a morning report, then realize they made an error and resubmit. The unique constraint `(storeId, date, shift)` ensures only one report per shift, and the upsert overwrites cleanly.

---

## 5. External Integration Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Otter API                              │
│  POST metrics_explorer                                   │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ Daily Summary │  │ Menu Items   │  │ Ratings       │ │
│  │ (financials)  │  │ (categories, │  │ (reviews,     │ │
│  │              │  │  items, mods) │  │  star ratings) │ │
│  └──────────────┘  └──────────────┘  └───────────────┘ │
│                                                          │
│  Auth: JWT with auto-refresh (decode exp, 1hr buffer)   │
│  Retry: 3 attempts, exponential backoff on 403           │
│  Timeout: 30s per request                                │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                  Data Transform Layer                    │
│                                                          │
│  Flatten rows: [{key, value}, ...] → {key: value, ...}  │
│  Map Otter UUIDs → internal store IDs                    │
│  Split FP/3P metrics by platform prefix                  │
│  Normalize dates to UTC midnight                         │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│               PostgreSQL (via Prisma)                    │
│                                                          │
│  OtterDailySummary  (storeId, date, platform, payment)  │
│  OtterMenuCategory  (storeId, date, category)           │
│  OtterMenuItem      (storeId, date, category, item)     │
│  OtterRating        (storeId, externalReviewId)         │
└─────────────────────────────────────────────────────────┘
```

**JWT lifecycle:**
```
1. Check OTTER_JWT env var (static, for CI/scripts)
2. Check cached JWT (in-memory, decoded exp with 1-hour buffer)
3. If expired → POST to manager.tryotter.com/api/users/sign_in
4. Cache new JWT + decoded expiration
```

**Yelp fuzzy matching scoring:**
```
score = (nameSimilarity × 0.60)
      + (addressSimilarity × 0.30)
      + (phoneExactMatch × 0.20)
      + (exactNameMatch × 0.10)

threshold: 0.50 minimum
cooldown: 24 hours per store
```

---

## 6. State Management: Client-Side Architecture

```
┌─────────────────────────────────────────────────┐
│            React Query (TanStack Query v5)       │
│                                                   │
│  Defaults:                                        │
│    staleTime: 5 min    (balance freshness/calls)  │
│    gcTime: 10 min      (prevent memory leaks)     │
│    retry: 2            (resilience)               │
│    refetchOnFocus: off (no surprise refreshes)    │
│    refetchOnMount: on  (fresh data on navigate)   │
│                                                   │
│  Patterns:                                        │
│  ┌────────────────────────────────────────────┐  │
│  │ Conditional fetching                        │  │
│  │ enabled: storeCount > 0                     │  │
│  │ → No wasted API calls when no stores exist  │  │
│  └────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────┐  │
│  │ Optimistic updates                          │  │
│  │ setQueryData(['stores'], old => [..., new]) │  │
│  │ → Instant UI, then invalidate to sync       │  │
│  └────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────┐  │
│  │ Smart retry                                 │  │
│  │ if (error.status === 404) return false      │  │
│  │ → Don't retry on "not found"                │  │
│  └────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────┐  │
│  │ Placeholder data                            │  │
│  │ placeholderData: defaultAnalytics           │  │
│  │ → Show zeros instead of loading skeleton    │  │
│  └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

**Why React Query over Zustand/Redux:**
The app is primarily server-driven — data originates from the database, not from user interactions. React Query is purpose-built for server state caching. There's no complex client-side state (no drag-and-drop reordering, no real-time collaboration) that would need a client state manager.

---

## 7. Security Architecture

```
Layer 1: Middleware        → JWT validation, role-based route blocking
Layer 2: Rate Limiting     → Per-tier limits, timing-safe cron bypass
Layer 3: Server Actions    → Session re-check, ownership verification
Layer 4: Input Validation  → Zod schemas on every mutation
Layer 5: Database          → Unique constraints, cascading deletes, FK enforcement
Layer 6: Secrets           → Env vars only, no hardcoded credentials
```

**Defense in depth example (creating a store):**
1. Middleware checks JWT exists → blocks unauthenticated
2. Rate limiter checks moderate tier (30/min) → blocks abuse
3. Server action checks `session.user.role === 'OWNER'` → blocks managers
4. Zod validates `name.min(1)` → blocks empty names
5. Prisma creates with `ownerId: session.user.id` → scoped to owner

**Auth specifics:**
- bcryptjs with 10 salt rounds for password hashing
- JWT strategy (not database sessions) — 8-hour maxAge
- Session extends with `id` and `role` fields via next-auth callbacks
- Credentials provider (email/password), no OAuth

---

## 8. How I'd Explain This in 5 Minutes

> "I designed a multi-tenant restaurant analytics platform that solves a real problem — restaurant owners with multiple locations need a single view of their business across POS systems, delivery platforms, vendor costs, and daily operations.
>
> The key architectural decisions were:
>
> 1. **A batch sync pipeline with phase-specific concurrency** — daily financials batch all stores in one API call, but menu items require per-store calls due to API limitations. A worker pool pattern with configurable concurrency handles both, and SSE streaming gives real-time progress to the UI.
>
> 2. **Idempotent upserts with compound unique constraints** — every sync is safely re-runnable. A 3-day lookback catches late-arriving platform adjustments. Batch isolation means one failed batch doesn't block the rest.
>
> 3. **AI-powered invoice ingestion** — GPT-4o vision extracts structured data from arbitrary vendor PDF layouts, then Levenshtein address matching auto-assigns invoices to stores with confidence scoring and human review for edge cases.
>
> 4. **Role-based access with defense in depth** — middleware enforces routing, server actions re-verify ownership, rate limiting prevents abuse, and Zod validates every input. Five layers, any one of which can catch a bad request.
>
> 5. **Server actions for mutations, API routes for streaming** — this split eliminates boilerplate for simple CRUD while keeping HTTP-level control for long-running operations.
>
> The platform serves restaurant owners managing ~5-10 locations, with analytics spanning financial summaries, product mix analysis (Pareto/ABC), customer ratings, and operational KPIs — all from a single dashboard."

---

## 9. Anticipated Interview Questions

### System Design

**Q: "What would you change if scaling to 1,000 stores?"**
A: Three things. First, move syncs to a job queue (Inngest or Bull) — the 120-second serverless limit won't work. Second, replace in-memory rate limiting with Redis. Third, add materialized views or a read replica for analytics queries — the current approach aggregates in TypeScript, which won't scale with data volume.

**Q: "Why PostgreSQL over MongoDB?"**
A: The data is deeply relational — stores have managers (many-to-many), invoices have line items, daily summaries key on 4-column compound keys. Unique constraints are critical for idempotency. MongoDB would make compound uniqueness and referential integrity much harder to enforce.

**Q: "How do you handle partial sync failures?"**
A: Three levels of isolation. Phases are sequential but independent — daily data already written survives if items fail. Within a phase, each batch of 50 is independent — one batch failing doesn't block others. And upserts mean re-running the entire sync just overwrites with fresh data. The SSE stream reports exactly which phase failed.

**Q: "Why not WebSockets for real-time updates?"**
A: The app doesn't have real-time collaboration — nobody needs to see another user's changes instantly. React Query's 5-minute stale time and refetch-on-mount give adequate freshness. SSE is used only for long-running sync progress, which is request-scoped and doesn't need a persistent connection.

### Code-Level

**Q: "Why is `nextIndex++` safe without a mutex in the worker pool?"**
A: JavaScript is single-threaded. `await` yields to the event loop, but the increment is synchronous. Between any two `await` points, only one worker is executing. No two workers can read the same index.

**Q: "Why store `rawExtractionJson` on invoices?"**
A: Debugging and auditability. If GPT-4o misreads a line item, I can compare the raw extraction to the original PDF without re-running (expensive) extraction. It also enables reprocessing if the prompt improves.

**Q: "Why Levenshtein for address matching instead of a geocoding API?"**
A: Geocoding adds latency and cost per invoice. Vendor invoices use the store's delivery address, which is usually very close to what's in the database — just formatting differences like "St" vs "Street". Levenshtein with normalization and street number hard-fail handles 90%+ of cases. The `REVIEW` status catches edge cases for human confirmation.

**Q: "Why batches of 50 for DB writes?"**
A: Prisma generates one SQL statement per upsert in `$transaction`. 1 = too many round trips. 1000 = long transactions, lock contention, timeout risk. 50 keeps each transaction fast while being much more efficient than row-by-row.

### Behavioral

**Q: "What was the hardest technical problem?"**
A: Reverse-engineering the Otter API. There's no public documentation. I had to discover which `groupBy` keys work with which datasets through trial and error — for example, `store` in `groupBy` works for daily summaries and categories but causes 500 errors for item-level data. The time zone issue was another gotcha: `reference_time_local_without_tz` is local time *encoded as a UTC epoch*, so you use `getUTCHours()` to extract the local hour. Applying timezone conversion would double-convert and give wrong results.

**Q: "What would you build with one more week?"**
A: Connect the recipe model to invoice line items for automatic food cost calculation. The data is already there — recipes define ingredient quantities, invoices have unit prices, and ingredient aliases handle normalization (e.g., "BEEF GRND 80/20 10LB" → "ground beef"). The missing piece is the matching logic and a cost dashboard.

**Q: "What's your testing strategy?"**
A: Zod validation is the first line of defense — every input is schema-validated. Unique constraints are database-level tests against duplicates. The address matcher has clear mathematical properties that are easy to unit test. For integration testing, I'd prioritize the sync pipeline (mock the Otter API, verify upserts) and the invoice extraction (snapshot tests against known PDF outputs).

---

## 10. Gaming Industry Parallels (For Riot Specifically)

| Restaurant Platform Concept | Gaming Equivalent |
|---|---|
| Batch sync pipeline with phases | Game server tick loop (physics → AI → net) |
| Worker pool with concurrency limit | Thread pool for async tasks |
| Idempotent upserts | Server-authoritative state reconciliation |
| SSE progress streaming | Client-side loading screen with progress |
| Role-based access (OWNER/MANAGER) | Player vs admin permissions |
| 3-day lookback for late adjustments | Lag compensation / rollback netcode |
| Compound unique constraints | Entity identity (no duplicate entities) |
| Rate limiting tiers | API throttling / anti-cheat rate limits |
| Levenshtein fuzzy matching | Fuzzy input matching / autocomplete |
| GPT-4o invoice extraction | ML-based content moderation pipeline |
| Multi-store tenant isolation | Per-shard / per-region data isolation |
| React Query stale time | Client-side state cache TTL |
| Vendor normalization aliases | Item/champion name normalization across locales |
| Pareto/ABC product analysis | Player engagement segmentation (whales/dolphins/minnows) |
