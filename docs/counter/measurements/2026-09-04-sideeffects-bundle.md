# 2026-09-04 — the barrel becomes shakeable, and the bundle gate goes green

## What was wrong

`npm run bundle:check` was failing: **51 of 114 routes over budget**, every
`/m/**` route at ~710 KB uncompressed against its 683.6 KB budget. Attribution
(chunk fingerprinting against `.next/diagnostics/route-bundle-stats.json`):
one 71 KB chunk — `AppShell` + `MTabs` + `DateControl` + `Calendar`, i.e. BOTH
surfaces' shells — sat in the first load of **107 of 114 routes** and was
referenced by the served HTML (verified on `/m/pnl`). Phone routes downloaded
the desk shell they never render; `/login`, which imports two components
(`Logo`, `Wordmark`), carried the whole thing.

The mechanism: `package.json` declared no `sideEffects`, so the bundler had to
assume any module re-exported by the 79-export `@/components/counter` client
barrel might run import-time side effects — importing one export shipped all
of them. Neither `experimental.optimizePackageImports` on the local barrel nor
Turbopack's automatic barrel handling changed a byte (both were tried and
measured; byte-identical output).

## The fix

```json
"sideEffects": ["**/*.css"]
```

in `package.json` — one line. No source file changed. The flip side, recorded
in DESIGN.md §Speed: a future module whose IMPORT must run (a polyfill, a
registration) has to be listed there, or an optimized build may drop it. The
only bare non-CSS import in `src/` today is `import "server-only"`, which is a
build-time export condition, not a runtime side effect.

Budgets in `scripts/check-bundle-size.ts` were re-tightened to the new
baseline + ~5% (auth 800→600 KB, mobile 700→680 KB, desk 1600→750 KB, chat
1750→750 KB, AI routes 1250→1230 KB, default 1500→600 KB), so the win cannot
silently erode. The old budget comment blaming framer-motion in the
login/signup forms was wrong twice over: those editorial forms are dead code
(nothing imports them since the Counter auth rebuild), and `/login` carries no
framer-motion at all.

## Environment and method

- Worktree at `f1fb1e5d` (isolated from concurrent WIP in the main checkout),
  production build (`next build`, Turbopack), `next start -p 3101`,
  `SERVICE_SHUTDOWN_AT=""`, dev Neon database, WSL2 / Node 20.20.
- `perf:sweep` per DESIGN.md: 3 desk runs + 3 phone runs (`PERF_CPU=4`)
  before and after, per-route **median of 3**; raw JSON in
  `tmp-perf/wt-before-*` / `tmp-perf/wt-after2-*` (uncommitted).
- Lighthouse 12.8.2 (npx, Playwright chromium, `--headless=new`), 3 runs per
  page per phase, medians: `/login` and `/m` mobile preset, `/dashboard`
  desktop preset, session cookie via `--extra-headers`.
- One measurement was thrown away: an earlier "after" sweep ran against a
  `next start` whose in-memory manifests predated the rebuild (`pkill -f
  'next start'` does NOT kill the `next-server` process). It reported a
  too-good −75 % wire JS. Sweeps only count against a server whose served
  chunk refs all exist on disk.

## Results (medians)

Bundle gate (first-load JS per route, `bundle:check`):

| route | before | after | Δ gz |
|---|---|---|---|
| `/m` | 731.8 KB / 231.1 gz | 601.2 KB / 187.7 gz | −43.4 KB |
| `/m/pnl` | 709.4 / 224.1 | 591.3 / 184.6 | −39.5 KB |
| `/dashboard` | 733.8 / 231.7 | 654.6 / 205.1 | −26.6 KB |
| `/login` | 691.9 / 215.7 | 556.8 / 167.6 | −48.1 KB |
| `/m/ask` | 1232.5 / 351.8 | 1102.7 / 308.3 | −43.5 KB |
| gate | **51 over** | **0 over** (tighter budgets) | |

`perf:sweep`, median across routes (n=53 desk / 55 phone):

| | desk before → after | phone before → after |
|---|---|---|
| TTFB | 7 → 7 ms | 9 → 8 ms |
| stream | 87 → 88 ms | 94 → 88 ms |
| LCP | 404 → 396 ms | 388 → 380 ms |
| CLS | 0 → 0 | 0 → 0 |
| blocking (TBT) | 0 → 0 ms | 0 → 0 ms |
| wire JS | 372 → 384 KB | 228 → 199 KB |
| wire total | 571 → 585 KB | 422 → 391 KB |
| requests | 76 → 75 | 48 → 46 |

The desk wire numbers deserve their sentence: the rail prefetches ~40 routes,
and the old union chunk was accidentally prefetch-efficient (one fat chunk,
maximal reuse). Tree-shaken per-route chunks trade ~+12 KB of background
prefetch for −26 KB gz on every cold first load. The phone, which prefetches
five tabs, wins both ways (−29 KB wire).

Lighthouse (median of 3):

| page | score | FCP | LCP | TBT | CLS | weight |
|---|---|---|---|---|---|---|
| `/login` (mobile) | 0.88 → 0.91 | 1659 → 1660 | 3754 → 3446 | 8 → 7 | 0 → 0 | 442 → 397 KB |
| `/dashboard` (desktop) | 0.97 → 0.98 | 367 → 368 | 1203 → 1147 | 0 → 0 | 0 → 0 | 627 → 635 KB |
| `/m` (mobile) | 0.85 → 0.87 | 1508 → 1509 | 4286 → 4003 | 18 → 22 | 0 → 0 | 464 → 430 KB |

## What was checked and deliberately not changed

Per DESIGN.md's do-not-redo list, re-confirmed still true in the baseline:
CLS ≈ 0 product-wide, blocking time 0 at 4× CPU on every route, server times
healthy (worst stream 310 ms, `/dashboard/decisions`). The remaining LCP on
the phone pages is font-paint (116 KB of fonts per screen, already minimal)
and Lighthouse's simulated 4G — not JavaScript.

## Verification

`vitest` 3315 passed / 8 skipped; `npm run tokens` clean;
`tsc --noEmit --incremental false` clean; `next build` clean;
`bundle:check` all 114 under (tightened) budget; fidelity suite run against
the changed build (see PR/commit notes for the run's result); all 108
route/surface pairs return 200 with real paint in the after sweeps.
