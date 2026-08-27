# PPR on the Counter routes — measured, and reverted

**Verdict: not adopted.** `experimental.ppr` / the route-level `experimental_ppr`
opt-in described in the Task 7 brief does not exist on the Next.js version this
repo runs (16.3.2) — it was removed in 16.0.0. The only surviving mechanism,
`cacheComponents: true`, is a single global switch with no per-directory
scoping, and turning it on fails the production build immediately, in more
than a dozen places that have nothing to do with the Counter routes. There is
no way to give the four gated surfaces a static shell "incrementally" on this
Next version. `next.config.ts` is unchanged from before this task.

## Method

Production build (`npm run build` + `npm start` on port 3100), authenticated
as the e2e user, `curl -w '%{time_starttransfer}'` against each route, 6
requests per route, first request discarded (cold-cache/compile warm-up),
median of the remaining 5 reported. All requests from `localhost`, so the
numbers isolate server-side work and are only meaningful compared to each
other, not as an absolute figure a real client would see over the network.

Same four gated surfaces as Task 1's fidelity capture: overview, orders, an
order record, pnl.

## Step 1 — baseline (before any change)

| route | TTFB median (ms) | samples (ms, warm) |
|---|---|---|
| `/dashboard` | 110.8 | 104.0, 110.0, 110.8, 111.9, 113.5 |
| `/dashboard/orders` | 104.0 | 97.0, 101.7, 104.0, 104.6, 107.1 |
| `/dashboard/orders/[id]` | 97.9 | 95.1, 96.7, 97.9, 101.9, 102.6 |
| `/dashboard/pnl` | 101.4 | 98.8, 101.1, 101.4, 103.1, 103.3 |

Build output at this point: `/dashboard`, `/dashboard/orders`,
`/dashboard/orders/[id]`, `/dashboard/pnl` all print `ƒ` (fully dynamic).

## Step 2 — attempting to enable PPR

Two things were tried, both reverted, neither kept:

**a) `experimental: { ppr: "incremental" }` in `next.config.ts`.** This is
exactly what the brief and the design doc (§F) describe, and it is what
`ExperimentalPPRConfig`'s type still permits in `next.config.ts`'s TypeScript
types. It is dead at runtime:

```
Build error occurred
[Error: `experimental.ppr` has been merged into `cacheComponents`. The
Partial Prerendering feature is still available, but is now enabled via
`cacheComponents`. Please update your next.config.ts accordingly.]
```

**b) `export const experimental_ppr = true` on the two Counter layouts**
(`src/app/dashboard/(counter)/layout.tsx`,
`src/app/(mobile)/m/(counter)/layout.tsx`), with (a) removed. This is the
route-segment config Next 15's incremental PPR used to key its per-route
opt-in on. On 16.3.2 it is silently inert — the build succeeds, every Counter
route still prints `ƒ`, nothing changed. (Next's own version-16 upgrade guide
confirms this was removed outright: "Next.js 16 removes the experimental
Partial Prerendering (PPR) flag and configuration options, including the
route level segment `experimental_ppr`.")

**c) `cacheComponents: true`**, the only mechanism that is actually live in
16.3.2 and does implement PPR. This is a single project-wide flag — there is
no directory or route-group scoping for it, "incremental" or otherwise.
Turning it on (with no other changes) fails `npm run build` immediately, and
not on a Counter route:

```
./src/app/dashboard/(editorial)/admin/monitoring/ml/page.tsx
Error: Route segment config "dynamic" is not compatible with `nextConfig.cacheComponents`. Please remove it.

./src/app/dashboard/(editorial)/admin/monitoring/people/page.tsx
Error: Route segment config "dynamic" is not compatible with `nextConfig.cacheComponents`. Please remove it.

./src/app/shutdown/page.tsx
Error: Route segment config "dynamic" is not compatible with `nextConfig.cacheComponents`. Please remove it.

./src/app/signup/[token]/page.tsx
Error: Route segment config "dynamic" is not compatible with `nextConfig.cacheComponents`. Please remove it.

./src/app/(mobile)/m/monitoring/page.tsx
Error: Route segment config "revalidate" is not compatible with `nextConfig.cacheComponents`. Please remove it.

./src/app/dashboard/(editorial)/admin/monitoring/page.tsx
Error: Route segment config "revalidate" is not compatible with `nextConfig.cacheComponents`. Please remove it.

./src/app/api/auth/[...nextauth]/route.ts
Error: Route segment config "runtime" is not compatible with `nextConfig.cacheComponents`. Please remove it.
```

Nine routes fail before the build ever reaches the four gated ones — two
`admin/monitoring` editorial pages (desk and phone), `/shutdown`,
`/signup/[token]`, `/m/monitoring`, and the NextAuth route handler itself
(`runtime = "nodejs"`, load-bearing per its own comment: it prevents Edge
runtime issues with the credentials provider). `dynamic`, `revalidate`, and
`runtime` route-segment configs are simply illegal under `cacheComponents`
project-wide. Making the app buildable under it is a real migration —
`instant = false` on every one of the ~19 still-editorial pages plus these
utility routes, then converting each one off its route-segment config, per
Next's own "Migrating to Cache Components" guide — not a Counter-scoped change,
and explicitly out of scope for this task.

**No Step 3 measurement exists.** There is no buildable "PPR enabled, Counter
routes only, editorial routes untouched" state to measure on Next 16.3.2. The
premise of Task 7's Step 2 — an incremental, per-route PPR opt-in — describes
a mechanism from Next 15 canaries that this app's installed Next version does
not have.

## The `useSearchParams()` question, investigated anyway

Task 7 specifically asked whether `useSearchParams()` running in the
layout-level client shells (`AppShell`, `PhoneShell`) would de-opt PPR's
static shell even if it could be turned on. It would, for two independent,
compounding reasons — worth recording because either one alone kills the
benefit:

1. **`useSearchParams()` itself.** `AppShell`
   (`src/components/counter/shell/app-shell.tsx:107`) and `PhoneShell`
   (`src/components/counter/shell/phone-shell.tsx:63`) both call it directly,
   and both are mounted straight from their layout
   (`src/app/dashboard/(counter)/layout.tsx`,
   `src/app/(mobile)/m/(counter)/layout.tsx`) with **no `<Suspense>` boundary**
   anywhere between the route root and that call. Under Cache Components' PPR
   model a dynamic API used outside Suspense forces the entire enclosing
   prerender to bail to fully dynamic — there is nothing left to serve as a
   static shell once that happens.

2. **The layout's own `getServerSession(authOptions)` call.** Both Counter
   layouts call this directly in the server component body, unguarded by any
   Suspense boundary of their own (a segment cannot wrap itself). NextAuth's
   `getServerSession` reads cookies, which is exactly the class of dynamic API
   PPR requires to be deferred behind Suspense or cached with `"use cache"` to
   avoid blocking the shell. Since this executes in the layout — the segment
   that sits above every one of the four gated routes — it would force the
   *entire* subtree dynamic on its own, independent of (1).

Either forcing function is sufficient by itself. Together they mean the
layout, as built by Tasks 1–6, has zero static surface to give PPR — the
"strongest version of what this document is about" (design doc §F) would in
practice buy nothing here without first restructuring the layout to push the
session read and the URL-driven chrome behind their own Suspense boundaries,
which is a separate, larger piece of work than "flip a config flag."

## Decision

Reverted. `next.config.ts` is unchanged. The two `experimental_ppr` exports
added to the Counter layouts during this investigation were removed; the tree
matches the pre-Task-7 baseline exactly (`git diff` against `f55041b` on these
files is empty). This is treated as the intended outcome per the design doc:
*"an experimental flag carried for its name rather than its effect is a cost,
not a feature."* Carrying the flag here would have been worse than that —
enabling it does not even reach the "worthless" (`ƒ` everywhere anyway) state
gracefully; the actually-live mechanism (`cacheComponents`) breaks the whole
app's build.

## Gates run after reverting

| gate | result |
|---|---|
| `npm test` | 250 files, 3080 passed, 8 skipped |
| `npm run tokens` | clean |
| `npx tsc --noEmit` | clean |
| `npm run build` | clean; all Counter routes `ƒ`, unchanged from before |
| `npm run fidelity` | 25 passed, 98 skipped |
| `npx playwright test e2e/` | 38 passed, 98 skipped, 0 failed |
