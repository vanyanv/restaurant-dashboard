# Pantry Ledger — Design

**Date:** 2026-08-17
**Status:** approved (design); increment 1 shipped 2026-08-18 (`0c7c12a`); increments 2–4 unstarted
**Visual spec:** https://claude.ai/code/artifact/2d28a9f5-1957-42e0-90e3-f50303159fb1 — an interactive mock built on live production data. It is the authority on layout, copy, and interaction; this document is the authority on data and scope.

---

## Problem

`/dashboard/ingredients` is built for the data-hygiene job (match, price, merge) but the owner's job is money. Measured on the live page at 1440×900:

| Symptom | Measurement |
|---|---|
| Admin queues above the fold | 750px (auto-match 356 + review inbox 394) on a 900px viewport — **zero ingredients on the first screen** |
| Sort order | Alphabetical. Ground beef (**31.9% of spend**) renders identically to Mustard Packets |
| Page height | 3,220px |
| Non-food in the grid | 31 of 76 rows (41%) for 8.5% of spend |
| Prices shown as `$0.00` | 3 tiles (sub-cent values through `toFixed(2)`) |

Meanwhile the same 76 rows are rendered again at `/dashboard/ingredients/prices` as a ledger, and price movement is reported a third time at `/dashboard/operations/product-usage?view=vendors` on **raw invoice product names** rather than canonical ingredients. The three disagree.

## Data findings that drive the design

All from production, 90 days to 2026-08-17.

- **$171,199** purchased across 76 canonical ingredients. Top 5 = **70.4%**. Top 12 food rows = **91.4% of food spend**.
- **22 of 75** ingredients with invoice history have **more than one SKU**. Nine of the twelve top-spend rows do.
- `lamb potato fry ss 1/4 stealth` merges **4 SKUs across 3 products** — Lamb Weston Stealth ($38.00, Feb–Apr), a Vitco "XLF Beef" fry ($33.12, May–Jun), and Simplot ($28.00 → $46.75, Jun–Aug). Its headline `+67%` is mostly a **product switch**, not inflation. Comparing prices across a SKU change compares different things.
- House Sauce (`Other`) and its cup (no category) total **$30,567**, and both sit inside the rail's `OTHER 26` bucket. Grouping by product name rather than stored category surfaces **Sauce & Condiment as the #2 station at 18.4%**.
- The review queue is **31 groups / $4,133**. The top three are the **same vendor and same SKU** (Vitco 15726), split by capitalisation, worth **$2,972**. The other 26 are $891 combined.
- **212 of 212 invoices have a PDF.** Provenance is complete and reachable at `/dashboard/invoices/[id]`.

## Decisions

1. **The Pantry owns price movement**, on canonical ingredients. (User decision, 2026-08-17.)
2. **Drill-down is an inline expanding row**, one open at a time. (User decision.)
3. **Trends are computed within a single SKU.** A SKU change breaks the series rather than producing a slope. Multi-SKU ingredients are flagged in the row.
4. **Provenance links out to `/dashboard/invoices/[id]` in a new tab.** No second invoice renderer is built — that page already has review reasons, line-math checks and the PDF.
5. **Stations are resolved by product name first, stored category second**, because the stored categories are wrong for 18% of spend.
6. **Default view is 12 rows**, with the hidden remainder named explicitly. No silent truncation.
7. **Red means money moving against you** and nothing else: a price rise worth ≥ $250/quarter. Not selection, not "unpriced".
8. **`listCanonicalIngredients()` is not modified.** It is consumed by mobile (`src/app/(mobile)/m/ingredients/page.tsx`) and two recipe surfaces that do not need spend or SKU aggregation. The ledger gets its own loader.

## Scope — increments

Each increment ships on its own and deletes nothing that the next one has not replaced.

| # | Increment | Deletes anything? |
|---|---|---|
| **1** | **Pantry ledger**: SKU-aware trend, 90-day spend, stations, ledger view with inline drill-down and invoice links | No |
| 2 | Collapse review inbox to a panel; move the auto-match decision log to `admin/monitoring/ingredient-audit` (already DEVELOPER-only) | Moves, no delete |
| 3 | Merge `/ingredients/prices` into the ledger; retire the Product Usage → Vendors price table; drop the `operations/costs` and `operations/vendors` nav entries (both are bare `redirect()` calls) | Yes |
| 4 | Matcher: a new SKU matching an existing canonical enters the review queue instead of merging silently. Group the queue on `(vendor, sku)` rather than raw product name | No |

**This document covers increment 1.** Increments 2–4 get their own plans.

## Out of scope

- Stock-count and waste history in the drill-down. The database holds 4 stock counts, 10 lines and **0 inventory adjustments**; those panels would be empty.
- Renaming ingredients. `chrsned bag plas tshirt logo ptsbchrisneddy` needs an owner-editable display name, which is its own change.
- `Fuel Surcharge` is a canonical ingredient with 146 invoice lines across 88 dates. It is a delivery fee, not an ingredient, and should be excluded from the pantry — tracked separately.

## Non-goals for increment 1

No page is deleted, no nav entry is removed, and Product Usage is untouched. The tile grid remains reachable so the change is reversible by toggle rather than by revert.
