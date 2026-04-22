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
| 2026-02-22 | Channel-level breakdown + menu category sync, KPI cards, platform insights charts, full dashboard rebuild against Otter data, **Prisma v7 + Next.js 16 upgrade** with pg adapter + SSL config. | 9.0 |
| 2026-02-23 | Analytics split into dedicated page, compact dashboard layout, date-range preset off-by-one fix, **Otter API timezone bugs** (multiple), **multi-UUID store grouping** + order counts, Menu Performance + Product Mix pages, Vercel cron timeout fix. | 9.0 |
| 2026-02-24 | GitHub Actions cron for 6-hour Otter sync, **Otter JWT auto-refresh** w/ Cloudflare bot-protection bypass (browser headers), **full invoice OCR system** w/ SKU extraction + vendor normalization + IFS support, product-usage page w/ Recipe/RecipeIngredient/IngredientAlias models, Overview + Costs + Vendors tabs, **AI integration** (insights panel, demand forecast, recipe suggestions), ingredient drilldown sheet w/ variance breakdown, UTC-vs-PST bug fix. | 13.0 |
| 2026-02-26 | Busiest-hours chart w/ live today view + timezone handling, R365 recipe import, operations page split, recipe calculation bug fixes + coverage warnings. | 5.0 |
| 2026-02-28 | Sidebar hydration-mismatch debugging + client-only render fix. | 1.5 |
| 2026-03-09 | **Switched Otter JWT refresh to Playwright** after sign-in flow change broke headless fetch; prod lib URL fix; Vercel build script exclusion. | 4.0 |
| 2026-03-19 | **Security hardening and rate limiting across every API route**, attack-surface reduction (removed unused `/api/health`). | 5.0 |
| 2026-03-25 | Replaced `gh` CLI with GitHub REST API for encrypted secret rotation (libsodium), dev-dependency cleanup. | 2.5 |
| 2026-04-18 | **P&L dashboard** w/ fixed costs + commission rates + store-edit form wiring, **invoice extraction hardening** (sanity checks + pack-size fields), **invoice PDF persistence to Vercel Blob** w/ side-by-side viewer, JWT auto-redeploy + 30d seed window, architecture cheat-sheet + interview guide. | 12.0 |
| 2026-04-19 | Otter orders sync workflow, invoice sync cron every 6h, editorial-topbar design system rolled across loading states and store pages, owner settings hub + 404 catchers, canonical-ingredient dedupe by (vendor, sku), **hybrid recipe costing** (phase 1 manual + phase 2 invoice auto-derive), **phase 3 modifier-aware COGS** via `OtterSubItemMapping`. | 13.0 |
| 2026-04-20 | Owner-facing menu catalog w/ recipe breakdown, closed Otter SKU mapping gaps across menu, menu page UX rework (sortable catalog + deep-dive route + performance insights), **full menu performance pass** (composite `(storeId, date)` index, request-scoped `React.cache`, memoization, dynamic imports, virtualized table, hover-prefetch, revalidateTag wiring), orders backfill infra + sync-button 95% hang fix, COGS honors manual canonical cost in dated lookups, **P&L "Financial Edition" redesign** w/ waterfall scale + full-range summation fixes + Statement matrix deductions styling, hero KPI additions (net sales, invoice spend, food cost %), home-page store comparison. | 10.0 |

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
- Estimates cover 99 commits across 12 working days, plus research, debugging, API reverse-engineering, and design iteration that don't appear as commits.
- Notably heavy items: reverse-engineering the private Otter metrics API; Otter JWT auto-refresh with Cloudflare bot-protection bypass and Playwright fallback; invoice OCR pipeline with SKU / vendor / IFS handling; Prisma v7 + Next.js 16 migration; full menu-page performance pass; P&L waterfall + Statement matrix.
- Payment terms: _[net 15 / net 30 / on receipt — fill in]_
- Payment method: _[Venmo / Zelle / check / ACH — fill in]_
