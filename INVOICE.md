# INVOICE

**Invoice #:** 2026-001
**Date Issued:** 2026-04-20
**Billing Period:** 2026-02-21 — 2026-04-20

---

## From
**Chris Neddy**
chris@chrisneddys.com

## Bill To
_[Client name / business address]_

---

## Services Rendered
Full-stack engineering for the Chris Neddy's restaurant dashboard — Otter API integration and all downstream features built on top of it (analytics, invoices, recipes, menu performance, P&L). Scope includes reverse-engineering the private Otter metrics API, authentication automation (JWT auto-refresh w/ Cloudflare bypass), OCR invoice pipeline, recipe costing engine, menu catalog, and P&L dashboard.

**Rate:** $35.00 / hour

---

## Line Items

| Date | Scope of Work | Hours |
|------|---------------|------:|
| 2026-02-21 | Reverse-engineered Otter metrics API (private, undocumented), designed `OtterStore` / `OtterDailySummary` schema, first working sync endpoint + analytics server action + sync button. | 4.0 |
| 2026-02-22 | Otter sync v2 — channel-level breakdown + menu category sync, schema additions. | 2.0 |
| 2026-02-22 | Analytics components library — KPI cards, platform insights, charts, tables. | 2.5 |
| 2026-02-22 | Dashboard + store analytics page rebuild against Otter data. | 2.0 |
| 2026-02-22 | Prisma v7 + Next.js 16 upgrade — pg adapter, explicit SSL config, seed-script path fix, PrismaClient instantiation fix. | 2.5 |
| 2026-02-23 | Analytics split into dedicated page, compact dashboard layout, date-range preset off-by-one fix, Otter API timezone bugs (multiple), multi-UUID store grouping + order counts, Menu Performance + Product Mix pages, Vercel cron timeout fix. | 9.0 |
| 2026-02-24 | GitHub Actions cron for 6h Otter sync + Vercel cron cleanup. | 1.5 |
| 2026-02-24 | Otter JWT auto-refresh — login API, Cloudflare bot-protection bypass (browser headers), static JWT fallback workflow. | 3.0 |
| 2026-02-24 | Invoice sync system — SKU extraction, vendor normalization, IFS support, top-products UI. | 3.5 |
| 2026-02-24 | Product usage page — `Recipe` / `RecipeIngredient` / `IngredientAlias` models, Overview + Costs + Vendors tabs, recipe manager sheet, ingredient drilldown w/ variance. | 3.0 |
| 2026-02-24 | AI integration (insights panel, demand forecast, recipe suggestions) + UTC-vs-PST bug fix + invoice polish. | 2.0 |
| 2026-02-26 | Busiest-hours chart w/ live today view + timezone handling, R365 recipe import, operations page split, recipe calculation bug fixes + coverage warnings. | 5.0 |
| 2026-02-28 | Sidebar hydration-mismatch debugging + client-only render fix. | 1.5 |
| 2026-03-09 | Switched Otter JWT refresh to Playwright after sign-in flow change broke headless fetch; prod lib URL fix; Vercel build script exclusion. | 4.0 |
| 2026-03-19 | Security hardening and rate limiting across every API route, attack-surface reduction (removed unused `/api/health`). | 5.0 |
| 2026-03-25 | Replaced `gh` CLI with GitHub REST API for encrypted secret rotation (libsodium), dev-dependency cleanup. | 2.5 |
| 2026-04-18 | P&L dashboard — fixed costs + commission rates + store-edit form wiring + nav links. | 4.0 |
| 2026-04-18 | Invoice extraction hardening — sanity checks + pack-size fields. | 2.5 |
| 2026-04-18 | Invoice PDF persistence to Vercel Blob + side-by-side viewer. | 3.5 |
| 2026-04-18 | JWT auto-redeploy + 30d seed-window widening + architecture cheat-sheet. | 2.0 |
| 2026-04-19 | Otter orders sync workflow + invoice sync cron every 6h. | 2.0 |
| 2026-04-19 | Editorial topbar design rolled across loading states and store pages. | 2.0 |
| 2026-04-19 | Owner settings hub + editorial 404 catchers. | 1.5 |
| 2026-04-19 | Canonical-ingredient dedupe by (vendor, sku) + batched pending dashboard work. | 1.5 |
| 2026-04-19 | Hybrid recipe costing — phase 1 manual + phase 2 invoice auto-derive + phase 3 modifier-aware COGS via `OtterSubItemMapping`. | 6.0 |
| 2026-04-20 | Menu catalog — owner-facing view w/ recipe breakdown, closed Otter SKU mapping gaps. | 2.5 |
| 2026-04-20 | Menu UX rework — sortable catalog, deep-dive route, performance insights. | 2.0 |
| 2026-04-20 | Menu performance pass — composite `(storeId, date)` index, `React.cache`, memoization, dynamic imports, virtualized table, hover-prefetch, revalidateTag. | 3.0 |
| 2026-04-20 | P&L "Financial Edition" redesign — waterfall fixes, Statement matrix, hero KPI additions (net sales / invoice spend / food cost %), home-page store comparison. | 2.5 |

---

## Summary

| | |
|---|--:|
| **Total Hours** | **88.0** |
| **Rate** | $35.00 / hr |
| **Subtotal** | $3,080.00 |
| **Total Due** | **$3,080.00** |

---

## Notes
- Line items split by discrete area of work so scope is legible at a glance.
- Notable bodies of work: reverse-engineering the private Otter metrics API; Otter JWT auto-refresh with Cloudflare bot-protection bypass (later hardened to Playwright); invoice OCR pipeline with SKU / vendor / IFS handling; Prisma v7 + Next.js 16 migration; hybrid recipe costing engine (phases 1–3); full menu-page performance pass; P&L "Financial Edition" redesign.
- Payment terms: _[net 15 / net 30 / on receipt — fill in]_
- Payment method: _[Venmo / Zelle / check / ACH — fill in]_
