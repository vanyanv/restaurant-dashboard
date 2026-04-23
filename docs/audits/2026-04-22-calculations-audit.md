# Calculations & Invoices Audit — 2026-04-22

Read-only sweep across every calculation domain (invoices, unit conversion, recipe cost, COGS materialization, Otter sales, P&L aggregation, ingredient matching). Every finding is tagged **CRITICAL** (material dollar impact), **WARNING** (unexplained drift or stale-but-live), or **INFO** (rounding noise — aggregated, not listed). No data was mutated.

## Executive summary

| Domain | Critical | Warning | Info |
| --- | ---: | ---: | ---: |
| invoices | 10 | 55 | 0 |
| unit-conversion | 0 | 0 | 0 |
| recipe-cost | 0 | 0 | 0 |
| cogs-materialization | 2 | 1 | 0 |
| otter-sales | 32 | 8 | 0 |
| pnl-aggregation | 0 | 1 | 0 |
| ingredient-matching | 0 | 123 | 0 |
| **Total** | **44** | **188** | **0** |

## invoices

### line_arithmetic

**CRITICAL (3)**

- Sysco Los Angeles, Inc. 945831303 line 2 "Beef Ground Bulk 75/25 CHUB" — 15 × $4.51 = $67.60, got $4,098.22
- Premier Meats & Crystal Bay 2232461 line 1 "GROUND BEEF FINE GRND 73/27 CREEKSTONE" — 8 × $4.60 = $36.80, got $2,242.59
- Individual FoodService H04728-00 line 7 "Syrup Hi-C Fruit Punch Flashin" — 1 × $124.68 = $124.68, got $0.00

### header_vs_lines

**CRITICAL (7)**

- Sysco 945780455 — header $517.50 vs Σlines+tax $507.50 (Δ $10.00)
- Sysco Los Angeles, Inc. 945679552 — header $387.82 vs Σlines+tax $378.87 (Δ $8.95)
- Individual FoodService H12702-00 — header $704.08 vs Σlines+tax $696.33 (Δ $7.75)
- Individual FoodService H10889-00 — header $363.67 vs Σlines+tax $355.92 (Δ $7.75)
- Individual FoodService H12702-00 — header $704.08 vs Σlines+tax $696.33 (Δ $7.75)
- Individual FoodService G69364-00 — header $439.10 vs Σlines+tax $433.15 (Δ $5.95)
- Individual FoodService G53437-00 — header $549.28 vs Σlines+tax $543.33 (Δ $5.95)

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

**WARNING (17)**

- fuel surcharge — canonical has matched invoice lines but no recipeUnit set (blocks cost derivation)
- ketchup vol-pack heinz — canonical has matched invoice lines but no recipeUnit set (blocks cost derivation)
- ketchup heinz 33% fancy — latest invoice line can't be converted to lb (derive returned null)
- sys cls mayonnaise banquet xhv duty — canonical has matched invoice lines but no recipeUnit set (blocks cost derivation)
- sugar packet — canonical has matched invoice lines but no recipeUnit set (blocks cost derivation)
- bleach 6% epa registered — canonical has matched invoice lines but no recipeUnit set (blocks cost derivation)
- hellmann mayonnaise extra heavy — canonical has matched invoice lines but no recipeUnit set (blocks cost derivation)
- syrup pibb xtra — canonical has matched invoice lines but no recipeUnit set (blocks cost derivation)
- cup plastic 10 oz clear pp — canonical has matched invoice lines but no recipeUnit set (blocks cost derivation)
- bag t-shirt white 12x7x22 17mic with warning — canonical has matched invoice lines but no recipeUnit set (blocks cost derivation)
- ground beef fine grnd 73/27 creekstone — latest invoice line can't be converted to lb (derive returned null)
- imported fresh tomato bulk 5x6 fresh — latest invoice line can't be converted to lb (derive returned null)
- ctecocrft paper wax deli — latest invoice line can't be converted to oz (derive returned null)
- can liner 40 x 46 1.5 mil black roll — canonical has matched invoice lines but no recipeUnit set (blocks cost derivation)
- paper roll thermal 3-1/8 x 220 ft bpa/bps free — canonical has matched invoice lines but no recipeUnit set (blocks cost derivation)
- …and 2 more (see JSON)

## cogs-materialization

### stale_vs_asof

**CRITICAL (2)**

- Hollywood 2026-04-22 "Signature Double Patty & Cheese Slider (Chris' or Eddy's Way)" — stored $1.52/unit vs recompute $1.38 (Δ × 59 = $8.44)
- Hollywood 2026-04-22 "2 Triples and Fries" — stored $5.64/unit vs recompute $5.06 (Δ × 2 = $1.15)

### unmapped_weighted

**WARNING (1)**

- Hollywood — MISSING_COST covers 2.1% of revenue ($18,737.37 over 397 rows)

## otter-sales

### summary_vs_orders_gap

**CRITICAL (32)**

- Hollywood 2026-04-11 — Σ orders $10,530.67 vs daily summary $9,661.34 (Δ $869.33)
- Hollywood 2026-04-12 — Σ orders $9,977.41 vs daily summary $9,109.55 (Δ $867.86)
- Hollywood 2026-04-04 — Σ orders $11,860.75 vs daily summary $10,997.75 (Δ $863.00)
- Hollywood 2026-04-13 — Σ orders $9,756.26 vs daily summary $8,956.68 (Δ $799.58)
- Hollywood 2026-03-26 — Σ orders $9,322.18 vs daily summary $8,571.89 (Δ $750.29)
- Hollywood 2026-03-31 — Σ orders $9,469.34 vs daily summary $8,769.57 (Δ $699.77)
- Hollywood 2026-03-28 — Σ orders $12,781.56 vs daily summary $12,082.54 (Δ $699.02)
- Hollywood 2026-03-25 — Σ orders $8,826.93 vs daily summary $8,133.45 (Δ $693.48)
- Hollywood 2026-04-06 — Σ orders $9,023.80 vs daily summary $8,332.51 (Δ $691.29)
- Hollywood 2026-03-29 — Σ orders $13,794.09 vs daily summary $13,104.03 (Δ $690.06)
- Hollywood 2026-04-07 — Σ orders $9,925.42 vs daily summary $9,241.20 (Δ $684.22)
- Hollywood 2026-04-10 — Σ orders $10,008.27 vs daily summary $9,327.95 (Δ $680.32)
- Hollywood 2026-04-20 — Σ orders $9,040.08 vs daily summary $8,383.33 (Δ $656.75)
- Hollywood 2026-04-18 — Σ orders $11,490.30 vs daily summary $10,859.44 (Δ $630.86)
- Hollywood 2026-03-24 — Σ orders $10,024.70 vs daily summary $9,415.61 (Δ $609.09)
- Hollywood 2026-03-27 — Σ orders $10,560.95 vs daily summary $9,958.04 (Δ $602.91)
- Hollywood 2026-04-05 — Σ orders $13,803.71 vs daily summary $13,223.48 (Δ $580.23)
- Hollywood 2026-03-30 — Σ orders $11,423.57 vs daily summary $10,853.03 (Δ $570.54)
- Hollywood 2026-04-08 — Σ orders $10,507.52 vs daily summary $9,951.21 (Δ $556.31)
- Hollywood 2026-04-01 — Σ orders $9,971.09 vs daily summary $9,424.13 (Δ $546.96)
- Hollywood 2026-04-19 — Σ orders $11,381.37 vs daily summary $10,854.74 (Δ $526.63)
- Hollywood 2026-03-23 — Σ orders $9,579.91 vs daily summary $9,061.35 (Δ $518.56)
- Hollywood 2026-04-17 — Σ orders $8,890.26 vs daily summary $8,377.59 (Δ $512.67)
- Hollywood 2026-04-03 — Σ orders $9,777.54 vs daily summary $9,266.54 (Δ $511.00)
- Hollywood 2026-04-09 — Σ orders $8,510.47 vs daily summary $8,124.65 (Δ $385.82)
- …and 7 more

### orphan_menu_item

**WARNING (8)**

- Hollywood — "Dr. Pepper (20 oz cup)" has $713.98 in sales but no recipe mapping
- Hollywood — "CVT Ice Cream - Vanilla" has $516.00 in sales but no recipe mapping
- Hollywood — "CVT Ice Cream - Chocolate" has $486.00 in sales but no recipe mapping
- Hollywood — "SUPER BOWL BOX" has $288.00 in sales but no recipe mapping
- Hollywood — "Signature Slider Fries and Drink Combo" has $271.92 in sales but no recipe mapping
- Hollywood — "SUPER BOWL BOX [LIMITED TIME ONLY]" has $120.00 in sales but no recipe mapping
- Hollywood — "Viral Dubai Chocolate" has $84.00 in sales but no recipe mapping
- Hollywood — "Hi-C Fruit Punch" has $53.42 in sales but no recipe mapping

## pnl-aggregation

### cogs_pct_sanity

**WARNING (1)**

- Hollywood — 90d COGS% = 12.3% (revenue $887,295.28, cogs $108,856.71) — outside typical 15–65% band

## ingredient-matching

### orphan_alias

**WARNING (123)**

- Alias for "Napkin Dispenser 2-Ply 8.5x6.5 White" (store kdt9na) is dead — same product now matches via (vendor, sku). Can silently apply wrong conversion if sku match ever breaks.
- Alias for "LAMB Potato Fry SS 1/4 Stealth" (store kdt9na) is dead — same product now matches via (vendor, sku). Can silently apply wrong conversion if sku match ever breaks.
- Alias for "Greeno Cup PET 20 OZ C&D PET" (store kdt9na) is dead — same product now matches via (vendor, sku). Can silently apply wrong conversion if sku match ever breaks.
- Alias for "CHRSNED Bag Plas Tshirt Logo PTSBCHRISNEDDY" (store kdt9na) is dead — same product now matches via (vendor, sku). Can silently apply wrong conversion if sku match ever breaks.
- Alias for "Keyston Sanitizer Multi Quat Liq" (store kdt9na) is dead — same product now matches via (vendor, sku). Can silently apply wrong conversion if sku match ever breaks.
- Alias for "Packer Onion Sweet Fresh" (store kdt9na) is dead — same product now matches via (vendor, sku). Can silently apply wrong conversion if sku match ever breaks.
- Alias for "Relish Sweet" (store kdt9na) is dead — same product now matches via (vendor, sku). Can silently apply wrong conversion if sku match ever breaks.
- Alias for "Soda Coke Mexican Glass" (store kdt9na) is dead — same product now matches via (vendor, sku). Can silently apply wrong conversion if sku match ever breaks.
- Alias for "Water Crystal Geyser Spring" (store kdt9na) is dead — same product now matches via (vendor, sku). Can silently apply wrong conversion if sku match ever breaks.
- Alias for "Peppers Whole Yellow" (store kdt9na) is dead — same product now matches via (vendor, sku). Can silently apply wrong conversion if sku match ever breaks.
- Alias for "Ketchup Heinz 33% Fancy" (store kdt9na) is dead — same product now matches via (vendor, sku). Can silently apply wrong conversion if sku match ever breaks.
- Alias for "Syrup Lemonade" (store kdt9na) is dead — same product now matches via (vendor, sku). Can silently apply wrong conversion if sku match ever breaks.
- Alias for "Syrup Hi-C Fruit Punch Flashin" (store kdt9na) is dead — same product now matches via (vendor, sku). Can silently apply wrong conversion if sku match ever breaks.
- Alias for "Syrup Coca Cola Zero Sugar" (store kdt9na) is dead — same product now matches via (vendor, sku). Can silently apply wrong conversion if sku match ever breaks.
- Alias for "Ketchup Vol-Pack Heinz" (store kdt9na) is dead — same product now matches via (vendor, sku). Can silently apply wrong conversion if sku match ever breaks.
- …and 108 more (see JSON)

## Appendix: suggested fix order

1. **Structural critical issues first** — cycle_detected, period_bucket_alignment, tax_remitted_exceeds_collected. These break invariants that downstream code relies on.
2. **High-dollar header↔lines and orphan menu items** — both directly distort the numbers users see on the dashboard.
3. **Stale canonical costs + sku ambiguity** — correctness leaks into every recipe, P&L, and COGS read until resolved.
4. **Unit conversion gaps (cross-category)** — each one breaks ALL recipes using that ingredient; fix these before chasing individual recipe drift.
5. **Recipe override drift** — usually downstream of costs being wrong, not the other way round. Often resolves itself after canonical-cost fixes.

_Generated by `pnpm tsx scripts/audit/run.ts` on 2026-04-22. Re-run after any fix to verify — the runner is idempotent except for date-sensitive freshness checks._
