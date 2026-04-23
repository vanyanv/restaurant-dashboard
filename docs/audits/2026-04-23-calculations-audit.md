# Calculations & Invoices Audit — 2026-04-23

Read-only sweep across every calculation domain (invoices, unit conversion, recipe cost, COGS materialization, Otter sales, P&L aggregation, ingredient matching). Every finding is tagged **CRITICAL** (material dollar impact), **WARNING** (unexplained drift or stale-but-live), or **INFO** (rounding noise — aggregated, not listed). No data was mutated.

## Executive summary

| Domain | Critical | Warning | Info |
| --- | ---: | ---: | ---: |
| invoices | 3 | 54 | 0 |
| unit-conversion | 0 | 0 | 0 |
| recipe-cost | 0 | 0 | 0 |
| cogs-materialization | 0 | 1 | 0 |
| otter-sales | 0 | 8 | 0 |
| pnl-aggregation | 0 | 1 | 0 |
| ingredient-matching | 0 | 0 | 0 |
| **Total** | **3** | **64** | **0** |

## invoices

### line_arithmetic

**CRITICAL (3)**

- Sysco Los Angeles, Inc. 945831303 line 2 "Beef Ground Bulk 75/25 CHUB" — 15 × $4.51 = $67.60, got $4,098.22
- Premier Meats & Crystal Bay 2232461 line 1 "GROUND BEEF FINE GRND 73/27 CREEKSTONE" — 8 × $4.60 = $36.80, got $2,242.59
- Individual FoodService H04728-00 line 7 "Syrup Hi-C Fruit Punch Flashin" — 1 × $124.68 = $124.68, got $0.00

### header_vs_lines

**WARNING (38)**

- Bear State Kitchen 1076 — header $3,398.20 vs Σlines+tax $3,373.20 (Δ $25.00)
- Sysco 945788718 — header $3,060.11 vs Σlines+tax $3,050.11 (Δ $10.00)
- Sysco Los Angeles, Inc. 945831303 — header $6,422.52 vs Σlines+tax $6,412.52 (Δ $10.00)
- Sysco 945798750 — header $3,154.42 vs Σlines+tax $3,144.42 (Δ $10.00)
- Sysco Los Angeles, Inc. 945819855 — header $3,075.46 vs Σlines+tax $3,065.46 (Δ $10.00)
- Sysco 945828794 — header $1,985.26 vs Σlines+tax $1,975.26 (Δ $10.00)
- Sysco Los Angeles, Inc. 945807489 — header $1,654.83 vs Σlines+tax $1,644.83 (Δ $10.00)
- Sysco Los Angeles, Inc. 945809694 — header $1,897.47 vs Σlines+tax $1,887.47 (Δ $10.00)
- Sysco 945777245 — header $1,444.14 vs Σlines+tax $1,434.14 (Δ $10.00)
- Sysco 945763808 — header $2,095.38 vs Σlines+tax $2,085.38 (Δ $10.00)
- Sysco 945828794 — header $1,985.26 vs Σlines+tax $1,975.26 (Δ $10.00)
- Sysco 945786246 — header $1,713.83 vs Σlines+tax $1,703.83 (Δ $10.00)
- Sysco 945761642 — header $2,979.74 vs Σlines+tax $2,970.79 (Δ $8.95)
- Sysco Los Angeles, Inc. 945741472 — header $2,116.40 vs Σlines+tax $2,107.45 (Δ $8.95)
- Sysco Los Angeles, Inc. 945736383 — header $2,244.39 vs Σlines+tax $2,235.44 (Δ $8.95)
- …and 23 more (see JSON)

### canonical_cost_freshness

**WARNING (16)**

- bag t-shirt white 12x7x22 17mic with warning — canonical has no costPerRecipeUnit but latest invoice derives $0.04/each
- fuel surcharge — canonical has matched invoice lines but no recipeUnit set (blocks cost derivation)
- ketchup vol-pack heinz — canonical has matched invoice lines but no recipeUnit set (blocks cost derivation)
- sys cls mayonnaise banquet xhv duty — canonical has matched invoice lines but no recipeUnit set (blocks cost derivation)
- sugar packet — canonical has matched invoice lines but no recipeUnit set (blocks cost derivation)
- bleach 6% epa registered — canonical has matched invoice lines but no recipeUnit set (blocks cost derivation)
- hellmann mayonnaise extra heavy — canonical has matched invoice lines but no recipeUnit set (blocks cost derivation)
- syrup pibb xtra — canonical has matched invoice lines but no recipeUnit set (blocks cost derivation)
- cup plastic 10 oz clear pp — canonical has matched invoice lines but no recipeUnit set (blocks cost derivation)
- ground beef fine grnd 73/27 creekstone — latest invoice line can't be converted to lb (derive returned null)
- imported fresh tomato bulk 5x6 fresh — latest invoice line can't be converted to lb (derive returned null)
- ctecocrft paper wax deli — latest invoice line can't be converted to oz (derive returned null)
- can liner 40 x 46 1.5 mil black roll — canonical has matched invoice lines but no recipeUnit set (blocks cost derivation)
- paper roll thermal 3-1/8 x 220 ft bpa/bps free — canonical has matched invoice lines but no recipeUnit set (blocks cost derivation)
- embossed bath tissue 2-ply recycled individually wrapped — latest invoice line can't be converted to cs (derive returned null)
- …and 1 more (see JSON)

## cogs-materialization

### unmapped_weighted

**WARNING (1)**

- Hollywood — MISSING_COST covers 3.0% of revenue ($38,177.26 over 925 rows)

## otter-sales

### orphan_menu_item

**WARNING (8)**

- Hollywood — "Dr. Pepper (20 oz cup)" has $713.98 in sales but no recipe mapping
- Hollywood — "CVT Ice Cream - Vanilla" has $516.00 in sales but no recipe mapping
- Hollywood — "CVT Ice Cream - Chocolate" has $486.00 in sales but no recipe mapping
- Hollywood — "SUPER BOWL BOX" has $288.00 in sales but no recipe mapping
- Hollywood — "Signature Slider Fries and Drink Combo" has $271.92 in sales but no recipe mapping
- Hollywood — "SUPER BOWL BOX [LIMITED TIME ONLY]" has $120.00 in sales but no recipe mapping
- Hollywood — "Viral Dubai Chocolate" has $84.00 in sales but no recipe mapping
- Hollywood — "Hi-C Fruit Punch" has $56.41 in sales but no recipe mapping

## pnl-aggregation

### cogs_pct_sanity

**WARNING (1)**

- Hollywood — 90d COGS% = 14.3% (revenue $719,919.21, cogs $102,938.58) — outside typical 15–65% band

## Appendix: suggested fix order

1. **Structural critical issues first** — cycle_detected, period_bucket_alignment, tax_remitted_exceeds_collected. These break invariants that downstream code relies on.
2. **High-dollar header↔lines and orphan menu items** — both directly distort the numbers users see on the dashboard.
3. **Stale canonical costs + sku ambiguity** — correctness leaks into every recipe, P&L, and COGS read until resolved.
4. **Unit conversion gaps (cross-category)** — each one breaks ALL recipes using that ingredient; fix these before chasing individual recipe drift.
5. **Recipe override drift** — usually downstream of costs being wrong, not the other way round. Often resolves itself after canonical-cost fixes.

_Generated by `pnpm tsx scripts/audit/run.ts` on 2026-04-23. Re-run after any fix to verify — the runner is idempotent except for date-sensitive freshness checks._
